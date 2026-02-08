/**
 * TikTok Shop Partner Center — Agency Data Fetcher
 *
 * Runs via GitHub Actions to automatically fetch financial data
 * from TikTok Shop Partner Center's internal API and update agency-data.json.
 *
 * Uses the same internal endpoints as the Partner Center web UI.
 * Authentication is via session cookies stored as a GitHub Secret.
 *
 * Required GitHub Secrets:
 *   TIKTOK_SESSION_COOKIE  — Full cookie header string from an authenticated
 *                            Partner Center browser session.
 *
 * To get the cookie string:
 *   1. Log in to partner.us.tiktokshop.com
 *   2. Open DevTools (F12) → Network tab
 *   3. Reload the page
 *   4. Click any request to partner.us.tiktokshop.com
 *   5. In "Request Headers", copy the full "Cookie:" value
 *   6. Paste into GitHub repo → Settings → Secrets → TIKTOK_SESSION_COOKIE
 *
 * When cookies expire the script detects the auth failure and
 * optionally opens a GitHub Issue to remind you to refresh them.
 */

import fs from 'fs';
import path from 'path';

const SESSION_COOKIE = process.env.TIKTOK_SESSION_COOKIE || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_REPO = process.env.GITHUB_REPOSITORY || '';
const BASE_URL = 'https://partner.us.tiktokshop.com';

// Partner IDs (Stay Viral)
const DIST_PARTNER_ID = '8650986195390075694';
const CREATOR_PARTNER_ID = '8647379727644267307';

// ────────────────────────────────────────
// API helpers
// ────────────────────────────────────────

async function apiRequest(endpoint, params = {}) {
  const qs = new URLSearchParams({ user_language: 'en', ...params }).toString();
  const url = `${BASE_URL}${endpoint}?${qs}`;

  console.log(`  → GET ${endpoint} (page ${params.page || 1})`);

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': SESSION_COOKIE,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${BASE_URL}/affiliate-finance/payment-bills?market=100`,
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = await resp.json();

  // Detect auth failures
  if (json.code === 10000 || json.code === 10001 || json.code === 401 ||
      json.message?.toLowerCase().includes('login') ||
      json.message?.toLowerCase().includes('auth') ||
      json.message?.toLowerCase().includes('session')) {
    throw new Error(`AUTH_EXPIRED: ${json.message || 'Session cookie expired'} (code ${json.code})`);
  }

  return json;
}

// ────────────────────────────────────────
// Fetch all pages of payouts
// ────────────────────────────────────────

async function fetchAllPayouts(partnerId, label) {
  console.log(`\nFetching ${label} payouts...`);
  const allPayouts = [];
  let page = 1;
  let totalCount = 0;

  do {
    const data = await apiRequest('/api/v1/affiliate/partner/payout/search', {
      page_size: '20',
      page: String(page),
      partner_id: partnerId,
      aid: '359713',
    });

    if (data.code !== 0 || !data.data?.payout_info) {
      if (page === 1) {
        console.log(`  ⚠ No payout data returned (code: ${data.code}, msg: ${data.message || 'none'})`);
      }
      break;
    }

    totalCount = data.data.total_count;
    allPayouts.push(...data.data.payout_info);
    console.log(`  Page ${page}: ${data.data.payout_info.length} records (${allPayouts.length}/${totalCount})`);
    page++;
  } while (allPayouts.length < totalCount && page <= 100);

  console.log(`  Total ${label}: ${allPayouts.length} records`);
  return allPayouts;
}

// ────────────────────────────────────────
// Format raw payouts
// ────────────────────────────────────────

function formatPayout(raw) {
  const d = new Date(parseInt(raw.payment_time));
  return {
    date: d.toISOString().split('T')[0],
    settlement_amount: parseFloat(raw.amount),
    amount_paid: parseFloat(raw.payment_amount),
  };
}

function formatDistPayouts(rawList) {
  return rawList.map(r => ({
    statement_id: r.id,
    ...formatPayout(r),
    type: 'PRODUCT_DISTRIBUTION',
    currency: 'USD',
  }));
}

function formatCreatorPayouts(rawList) {
  return rawList.map(r => ({
    payment_id: r.id,
    ...formatPayout(r),
  }));
}

// ────────────────────────────────────────
// GitHub Issue for expired cookies
// ────────────────────────────────────────

async function createExpiryIssue(errorMsg) {
  if (!GH_TOKEN || !GH_REPO) {
    console.log('  Cannot create GitHub Issue (no token or repo info).');
    return;
  }

  // Check if an open issue already exists
  try {
    const searchResp = await fetch(
      `https://api.github.com/repos/${GH_REPO}/issues?labels=cookie-expired&state=open`,
      { headers: { Authorization: `token ${GH_TOKEN}` } }
    );
    const openIssues = await searchResp.json();
    if (Array.isArray(openIssues) && openIssues.length > 0) {
      console.log('  Cookie-expiry issue already open, skipping.');
      return;
    }
  } catch (_) { /* ignore */ }

  // Create new issue
  try {
    await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '🔑 TikTok session cookie expired — refresh needed',
        body: [
          '## Cookie Refresh Required',
          '',
          `The automated agency data refresh failed because the TikTok session cookie has expired.`,
          '',
          `**Error:** \`${errorMsg}\``,
          '',
          '### How to fix',
          '1. Log in to [partner.us.tiktokshop.com](https://partner.us.tiktokshop.com)',
          '2. Open DevTools (F12) → **Network** tab',
          '3. Reload the page',
          '4. Click any request to `partner.us.tiktokshop.com`',
          '5. In **Request Headers**, copy the full `Cookie:` value',
          '6. Go to this repo → **Settings** → **Secrets and variables** → **Actions**',
          '7. Update the `TIKTOK_SESSION_COOKIE` secret with the new cookie value',
          '',
          'The next scheduled run (every 6h) will pick up the new cookie automatically.',
          '',
          '_This issue was created automatically by the agency data refresh workflow._',
        ].join('\n'),
        labels: ['cookie-expired'],
      }),
    });
    console.log('  Created GitHub Issue for cookie refresh.');
  } catch (e) {
    console.log('  Failed to create issue:', e.message);
  }
}

// ────────────────────────────────────────
// Main
// ────────────────────────────────────────

async function main() {
  console.log('=== TikTok Agency Data Fetcher (Internal API) ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  if (!SESSION_COOKIE) {
    console.error('TIKTOK_SESSION_COOKIE not set.');
    console.log('Add your Partner Center session cookie as a GitHub Secret.');
    console.log('See script header for instructions.');
    console.log('Keeping existing agency-data.json unchanged.');
    process.exit(0);
  }

  // Load existing data
  const dataPath = path.join(process.cwd(), 'agency-data.json');
  let existingData = { analytics: {}, payouts: [], distribution_payouts: [] };

  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    existingData = JSON.parse(raw);
    console.log(`Loaded existing: ${(existingData.distribution_payouts || []).length} dist, ${(existingData.payouts || []).length} creator payouts`);
  } catch (err) {
    console.log('No existing agency-data.json, creating new.');
  }

  try {
    // Fetch distribution payouts (the big ones)
    const rawDist = await fetchAllPayouts(DIST_PARTNER_ID, 'distribution');
    const distPayouts = formatDistPayouts(rawDist);

    // Fetch creator service payouts (smaller ones)
    const rawCreator = await fetchAllPayouts(CREATOR_PARTNER_ID, 'creator');
    const creatorPayouts = formatCreatorPayouts(rawCreator);

    // Sort by date descending
    distPayouts.sort((a, b) => b.date.localeCompare(a.date));
    creatorPayouts.sort((a, b) => b.date.localeCompare(a.date));

    // Build updated data
    const today = new Date().toISOString().split('T')[0];
    const totalDist = distPayouts.reduce((s, p) => s + p.settlement_amount, 0);
    const totalCreator = creatorPayouts.reduce((s, p) => s + p.settlement_amount, 0);

    const updatedData = {
      analytics: {
        ...(existingData.analytics || {}),
        last_updated: today,
      },
      payouts: creatorPayouts,
      distribution_payouts: distPayouts,
    };

    fs.writeFileSync(dataPath, JSON.stringify(updatedData, null, 2) + '\n');

    console.log(`\n=== Updated agency-data.json ===`);
    console.log(`  Distribution payouts: ${distPayouts.length} ($${totalDist.toLocaleString()})`);
    console.log(`  Creator payouts:      ${creatorPayouts.length} ($${totalCreator.toLocaleString()})`);
    console.log(`  Latest distribution:  ${distPayouts[0]?.date || 'n/a'}`);
    console.log(`  Latest creator:       ${creatorPayouts[0]?.date || 'n/a'}`);
    console.log('=== Done ===');

  } catch (err) {
    if (err.message.startsWith('AUTH_EXPIRED')) {
      console.error('\n❌ Session cookie has expired!');
      console.error(err.message);
      console.log('\nCreating GitHub Issue to remind you to refresh...');
      await createExpiryIssue(err.message);
    } else {
      console.error('\n❌ Unexpected error:', err.message);
    }

    console.log('Keeping existing agency-data.json unchanged.');
    process.exit(0); // Don't fail the workflow
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(0);
});
