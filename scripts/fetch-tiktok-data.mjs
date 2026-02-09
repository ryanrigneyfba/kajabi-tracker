/**
 * TikTok Shop â Agency Data & Affiliate Analytics Fetcher
 *
 * Runs via GitHub Actions to automatically fetch financial data
 * from TikTok Shop Partner Center + Affiliate Center and update agency-data.json.
 *
 * Uses the same internal endpoints as the Partner Center and Affiliate Center web UIs.
 * Authentication is via session cookies stored as GitHub Secrets.
 *
 * Required GitHub Secrets:
 *   TIKTOK_SESSION_COOKIE     â Cookie from partner.us.tiktokshop.com (agency payouts)
 *   TIKTOK_AFFILIATE_COOKIE   â Cookie from affiliate-us.tiktok.com (GMV/commission/orders)
 *
 * To get each cookie string:
 *   1. Log in to the respective site (partner center or affiliate center)
 *   2. Open DevTools (F12) â Network tab
 *   3. Reload the page
 *   4. Click any request to that domain
 *   5. In "Request Headers", copy the full "Cookie:" value
 *   6. Paste into GitHub repo â Settings â Secrets â the corresponding secret
 *
 * When cookies expire the script detects the auth failure and
 * optionally opens a GitHub Issue to remind you to refresh them.
 */

import fs from 'fs';
import path from 'path';

const SESSION_COOKIE = process.env.TIKTOK_SESSION_COOKIE || '';
const AFFILIATE_COOKIE = process.env.TIKTOK_AFFILIATE_COOKIE || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_REPO = process.env.GITHUB_REPOSITORY || '';
const BASE_URL = 'https://partner.us.tiktokshop.com';
const AFFILIATE_URL = 'https://affiliate-us.tiktok.com';

// Partner IDs (Stay Viral)
const DIST_PARTNER_ID = '8650986195390075694';
const CREATOR_PARTNER_ID = '8647379727644267307';

// ââââââââââââââââââââââââââââââââââââââââ
// API helpers
// ââââââââââââââââââââââââââââââââââââââââ

async function apiRequest(endpoint, params = {}) {
  const qs = new URLSearchParams({ user_language: 'en', ...params }).toString();
  const url = `${BASE_URL}${endpoint}?${qs}`;

  console.log(`  â GET ${endpoint} (page ${params.page || 1})`);

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

  // Detect auth failures (16201010 = unauthenticated on Partner Center)
  if (json.code === 10000 || json.code === 10001 || json.code === 401 ||
      json.code === 16201010 ||
      json.message?.toLowerCase().includes('login') ||
      json.message?.toLowerCase().includes('auth') ||
      json.message?.toLowerCase().includes('session')) {
    throw new Error(`AUTH_EXPIRED: ${json.message || 'Session cookie expired'} (code ${json.code})`);
  }

  return json;
}

// ââââââââââââââââââââââââââââââââââââââââ
// Fetch all pages of payouts
// ââââââââââââââââââââââââââââââââââââââââ

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
        console.log(`  â  No payout data returned (code: ${data.code}, msg: ${data.message || 'none'})`);
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

// ââââââââââââââââââââââââââââââââââââââââ
// Format raw payouts
// ââââââââââââââââââââââââââââââââââââââââ

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

// ââââââââââââââââââââââââââââââââââââââââ
// Fetch affiliate analytics (GMV, commission, orders)
// ââââââââââââââââââââââââââââââââââââââââ

async function fetchAffiliateAnalytics() {
  if (!AFFILIATE_COOKIE) {
    console.log('\nâ  TIKTOK_AFFILIATE_COOKIE not set â skipping affiliate analytics.');
    console.log('  Add your Affiliate Center cookie to populate GMV/commission/orders.');
    return null;
  }

  console.log('\nFetching affiliate analytics (last 28 days)...');

  // Build time range: last 28 days ending yesterday, PST timezone
  const now = new Date();
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 28);

  const startTs = Math.floor(start.getTime() / 1000);
  const endTs = Math.floor(end.getTime() / 1000);

  const body = {
    params: [{
      time_descriptor: {
        timezone_offset: -28800, // PST
        start_time: startTs,
        end_time: endTs,
        granularity_type: 1, // aggregated
      },
      // metric_types: 1=GMV, 2=items_sold, 3=refunded_gmv, 12=est_commission
      metric_types: [1, 2, 3, 12],
    }],
  };

  const qs = new URLSearchParams({
    aid: '4331',
    app_name: 'i18n_ecom_alliance',
    shop_region: 'US',
  }).toString();

  const url = `${AFFILIATE_URL}/api/v1/oec/affiliate/compass/transaction/core_performance/get?${qs}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Cookie': AFFILIATE_COOKIE,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${AFFILIATE_URL}/insights/transaction-analysis?shop_region=US`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();

    if (json.code !== 0) {
      if (json.message?.toLowerCase().includes('login') ||
          json.message?.toLowerCase().includes('auth') ||
          json.code === 10000 || json.code === 10001) {
        console.log('  â  Affiliate cookie expired â skipping analytics.');
        return null;
      }
      console.log(`  â  Affiliate API error (code ${json.code}): ${json.message}`);
      return null;
    }

    const metrics = json.data?.segments?.[0]?.time_split_metrics_list?.[0]?.metrics;
    if (!metrics) {
      console.log('  â  No metrics in response');
      return null;
    }

    const result = {
      affiliate_gmv: parseFloat(metrics.affiliate_gmv?.amount || '0'),
      est_commission: parseFloat(metrics.estimated_commission?.amount || '0'),
      orders: parseInt(metrics.affiliate_items_sold_cnt?.value || '0', 10),
      gmv_refund: parseFloat(metrics.affiliate_refunded_gmv?.amount || '0'),
    };

    console.log(`  GMV: $${result.affiliate_gmv.toLocaleString()}`);
    console.log(`  Commission: $${result.est_commission.toLocaleString()}`);
    console.log(`  Orders: ${result.orders}`);
    console.log(`  Refunds: $${result.gmv_refund.toLocaleString()}`);

    return result;
  } catch (err) {
    console.log(`  â  Affiliate analytics fetch failed: ${err.message}`);
    return null;
  }
}

// ââââââââââââââââââââââââââââââââââââââââ
// GitHub Issue for expired cookies
// ââââââââââââââââââââââââââââââââââââââââ

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
        title: 'ð TikTok session cookie expired â refresh needed',
        body: [
          '## Cookie Refresh Required',
          '',
          `The automated agency data refresh failed because the TikTok session cookie has expired.`,
          '',
          `**Error:** \`${errorMsg}\``,
          '',
          '### How to fix',
          '1. Log in to [partner.us.tiktokshop.com](https://partner.us.tiktokshop.com)',
          '2. Open DevTools (F12) â **Network** tab',
          '3. Reload the page',
          '4. Click any request to `partner.us.tiktokshop.com`',
          '5. In **Request Headers**, copy the full `Cookie:` value',
          '6. Go to this repo â **Settings** â **Secrets and variables** â **Actions**',
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

// ââââââââââââââââââââââââââââââââââââââââ
// Main
// ââââââââââââââââââââââââââââââââââââââââ

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

    // Guard: never overwrite existing data with empty results
    const existingDistCount = (existingData.distribution_payouts || []).length;
    const existingCreatorCount = (existingData.payouts || []).length;

    if (distPayouts.length === 0 && creatorPayouts.length === 0 &&
        (existingDistCount > 0 || existingCreatorCount > 0)) {
      console.log(`\nâ  API returned 0 records but existing data has ${existingDistCount} dist + ${existingCreatorCount} creator payouts.`);
      console.log('  Preserving existing agency-data.json unchanged.');
      console.log('  This likely means the session cookie is invalid or the API is temporarily unavailable.');
      process.exit(0);
    }

    // Fetch affiliate analytics (GMV, commission, orders) â independent of payouts
    const affiliateMetrics = await fetchAffiliateAnalytics();

    // Build updated data
    const today = new Date().toISOString().split('T')[0];
    const totalDist = distPayouts.reduce((s, p) => s + p.settlement_amount, 0);
    const totalCreator = creatorPayouts.reduce((s, p) => s + p.settlement_amount, 0);

    const updatedData = {
      analytics: {
        ...(existingData.analytics || {}),
        ...(affiliateMetrics || {}),
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
      console.error('\nâ Session cookie has expired!');
      console.error(err.message);
      console.log('\nCreating GitHub Issue to remind you to refresh...');
      await createExpiryIssue(err.message);
    } else {
      console.error('\nâ Unexpected error:', err.message);
    }

    console.log('Keeping existing agency-data.json unchanged.');
    process.exit(0); // Don't fail the workflow
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(0);
});
