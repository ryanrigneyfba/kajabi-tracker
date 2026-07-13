#!/usr/bin/env node
// Local Whop payment fetcher — mirrors .github/workflows/fetch-whop-payments.yml
// Usage: WHOP_API_KEY=... node scripts/fetch-whop-local.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.WHOP_API_KEY;
if (!KEY) { console.error('ERROR: set WHOP_API_KEY'); process.exit(1); }

const BASE = 'https://api.whop.com/api/v5/company/payments';
const PER = 50;
const headers = { Authorization: `Bearer ${KEY}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}?per=${PER}&page=${page}`, { headers });
    if (res.ok) return res.json();
    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    throw new Error(`page ${page} -> HTTP ${res.status}`);
  }
  throw new Error(`page ${page} failed after retries`);
}

const first = await getPage(1);
const totalPages = first.pagination?.total_pages ?? 1;
const totalCount = first.pagination?.total_count ?? 0;
console.log(`API reports ${totalCount} payments across ${totalPages} pages`);

let fresh = [...(first.data || [])];
for (let p = 2; p <= totalPages; p++) {
  const json = await getPage(p);
  fresh.push(...(json.data || []));
  if (p % 10 === 0 || p === totalPages) console.log(`  fetched page ${p}/${totalPages} (${fresh.length} records)`);
  await sleep(120);
}
console.log(`Fresh fetched: ${fresh.length}`);

// Merge with existing (accumulate, fresh wins on ID conflict)
let existing = [];
if (existsSync('whop-payments.json')) {
  existing = JSON.parse(readFileSync('whop-payments.json', 'utf8'));
  console.log(`Existing on disk: ${existing.length}`);
}
const byId = new Map();
for (const p of existing) byId.set(p.id, p);
for (const p of fresh) byId.set(p.id, p); // fresh overrides
const merged = [...byId.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

// Safety: never shrink >10%
if (existing.length && merged.length < existing.length * 0.9) {
  console.error(`ABORT: merged ${merged.length} < 90% of existing ${existing.length}`);
  process.exit(1);
}

writeFileSync('whop-payments.json', JSON.stringify(merged, null, 2));
const paid = merged.filter((p) => p.status === 'paid' && p.final_amount > 0);
const revenue = paid.reduce((s, p) => s + p.final_amount, 0);
const newest = Math.max(...paid.map((p) => p.paid_at || p.created_at));
console.log(`\n=== Done ===`);
console.log(`Total: ${merged.length} | Paid w/revenue: ${paid.length} | Revenue: $${revenue.toFixed(2)}`);
console.log(`Newest paid: ${new Date(newest * 1000).toISOString()}`);
