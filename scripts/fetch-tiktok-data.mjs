/**
 * TikTok Shop Partner API - Auto-fetch Agency Data
 *
 * Runs via GitHub Actions to automatically fetch financial data
 * from TikTok Shop Partner Center and update agency-data.json.
 *
 * Strategy:
 * - V2 API: Fetch statements with correct params (shop_cipher, query params)
 * - V1 API: Fetch creator settlements (legacy, still works)
 * - Existing data: Always preserved; new data merges with existing records
 *
 * Required GitHub Secrets:
 * - TIKTOK_APP_KEY: Your TikTok Shop app key
 * - TIKTOK_APP_SECRET: Your TikTok Shop app secret
 * - TIKTOK_ACCESS_TOKEN: OAuth access token
 *
 * Optional GitHub Secrets:
 * - TIKTOK_SHOP_CIPHER: Shop cipher for v2 finance API (auto-discovered if not set)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const APP_KEY = process.env.TIKTOK_APP_KEY;
const APP_SECRET = process.env.TIKTOK_APP_SECRET;
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const SHOP_CIPHER = process.env.TIKTOK_SHOP_CIPHER || '';

const API_BASE = 'https://open-api.tiktokglobalshop.com';
const API_VERSION = '202309';

// ───────────────────────────────────────────────────────
// API Signature & Request helpers
// ───────────────────────────────────────────────────────

function generateSign(apiPath, params, body = '') {
    const sortedKeys = Object.keys(params).sort();
    let baseString = apiPath;
    for (const key of sortedKeys) {
        baseString += key + params[key];
    }
    if (body) baseString += body;

    const hmac = crypto.createHmac('sha256', APP_SECRET);
    hmac.update(baseString);
    return hmac.digest('hex');
}

async function apiRequest(endpoint, queryParams = {}, bodyData = null) {
    const timestamp = Math.floor(Date.now() / 1000);

    const baseParams = {
        app_key: APP_KEY,
        timestamp: String(timestamp),
        version: API_VERSION,
    };

    const allParams = { ...baseParams, ...queryParams };
    const bodyStr = bodyData ? JSON.stringify(bodyData) : '';
    const sign = generateSign(endpoint, allParams, bodyStr);
    allParams.sign = sign;
    allParams.access_token = ACCESS_TOKEN;

    const queryString = Object.entries(allParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const url = `${API_BASE}${endpoint}?${queryString}`;

    const options = {
        method: bodyData ? 'POST' : 'GET',
        headers: {
            'Content-Type': 'application/json',
            'x-tts-access-token': ACCESS_TOKEN,
        },
    };

    if (bodyData) {
        options.body = bodyStr;
    }

    console.log(`  → ${options.method} ${endpoint}`);
    try {
        const response = await fetch(url, options);
        const json = await response.json();
        if (json.code && json.code !== 0) {
            console.log(`  ⚠ API response code ${json.code}: ${json.message || ''}`);
        }
        return json;
    } catch (err) {
        console.log(`  ✗ Request failed: ${err.message}`);
        return { code: -1, message: err.message };
    }
}

// ───────────────────────────────────────────────────────
// Step 1: Discover shop_cipher from authorized shops
// ───────────────────────────────────────────────────────

async function getShopCipher() {
    if (SHOP_CIPHER) {
        console.log(`Using TIKTOK_SHOP_CIPHER from env: ${SHOP_CIPHER.substring(0, 8)}...`);
        return SHOP_CIPHER;
    }

    console.log('Discovering shop_cipher from authorized shops...');

    // Try v2 endpoint
    try {
        const result = await apiRequest('/authorization/202309/shops', {
            page_size: '100',
        });

        if (result.data && result.data.shops && result.data.shops.length > 0) {
            const shop = result.data.shops[0];
            const cipher = shop.cipher || shop.shop_cipher || '';
            if (cipher) {
                console.log(`  Found shop cipher: ${cipher.substring(0, 8)}... (shop: ${shop.shop_name || shop.shop_id || 'unknown'})`);
                return cipher;
            }
        }
    } catch (err) {
        console.log('  Authorized shops v2 error:', err.message);
    }

    // Try alternate endpoint paths
    const altPaths = [
        '/api/shop/get_authorized',
        '/authorization/202309/shops/get',
    ];

    for (const altPath of altPaths) {
        try {
            const result = await apiRequest(altPath);
            if (result.data) {
                const shops = result.data.shops || result.data.shop_list || [];
                if (shops.length > 0) {
                    const cipher = shops[0].cipher || shops[0].shop_cipher || '';
                    if (cipher) {
                        console.log(`  Found shop cipher from ${altPath}: ${cipher.substring(0, 8)}...`);
                        return cipher;
                    }
                }
            }
        } catch (err) {
            console.log(`  ${altPath} error:`, err.message);
        }
    }

    console.log('  Could not discover shop_cipher automatically.');
    console.log('  Set TIKTOK_SHOP_CIPHER in GitHub Secrets for v2 finance API access.');
    return null;
}

// ───────────────────────────────────────────────────────
// Step 2: V2 Finance API — Get Statements
// Uses correct params: shop_cipher, statement_time_ge/lt, page_size
// GET request with query parameters (NOT POST with body)
// ───────────────────────────────────────────────────────

async function fetchStatements(shopCipher) {
    if (!shopCipher) {
        console.log('Skipping v2 statements (no shop_cipher available).');
        return null;
    }

    console.log('Fetching v2 statements...');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    let allStatements = [];
    let pageToken = null;
    let page = 0;

    do {
        page++;
        const queryParams = {
            shop_cipher: shopCipher,
            statement_time_ge: String(Math.floor(ninetyDaysAgo.getTime() / 1000)),
            statement_time_lt: String(Math.floor(now.getTime() / 1000)),
            page_size: '100',
            sort_order: 'DESC',
        };

        if (pageToken) {
            queryParams.page_token = pageToken;
        }

        try {
            // GET request — no body data
            const result = await apiRequest('/finance/202309/statements', queryParams);

            if (result.data) {
                const stmts = result.data.statements || result.data.statement_list || [];
                console.log(`  Page ${page}: got ${stmts.length} statements`);

                for (const s of stmts) {
                    allStatements.push({
                        statement_id: s.id || s.statement_id || '',
                        date: s.statement_time
                            ? new Date(s.statement_time * 1000).toISOString().split('T')[0]
                            : (s.settle_time ? new Date(s.settle_time * 1000).toISOString().split('T')[0] : ''),
                        settlement_amount: parseFloat(s.settlement_amount || s.revenue_amount || s.amount || 0),
                        amount_paid: parseFloat(s.payout_amount || s.paid_amount || s.settlement_amount || s.amount || 0),
                        type: s.statement_type || s.type || 'statement',
                        currency: s.currency || 'USD',
                    });
                }

                // Handle pagination
                pageToken = result.data.next_page_token || result.data.page_token || null;
                if (stmts.length < 100) pageToken = null; // Last page
            } else {
                pageToken = null;
            }
        } catch (err) {
            console.log(`  Statements page ${page} error:`, err.message);
            pageToken = null;
        }
    } while (pageToken && page < 20); // Safety limit

    // Deduplicate
    const seen = new Set();
    allStatements = allStatements.filter(s => {
        const key = s.statement_id || `${s.date}-${s.amount_paid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(`  Total unique v2 statements: ${allStatements.length}`);
    return allStatements.length > 0 ? allStatements : null;
}

// ───────────────────────────────────────────────────────
// Step 3: V1 Legacy — Fetch creator settlements
// These are the small creator service payouts ($7-$90)
// ───────────────────────────────────────────────────────

async function fetchSettlements() {
    console.log('Fetching v1 settlements (creator payouts)...');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    try {
        const result = await apiRequest('/api/finance/settlements/search', {}, {
            request_time_from: Math.floor(ninetyDaysAgo.getTime() / 1000),
            request_time_to: Math.floor(now.getTime() / 1000),
            page_size: 100,
        });

        if (result.data && result.data.settlement_list) {
            return result.data.settlement_list.map(s => ({
                payment_id: s.id || s.settlement_id || '',
                date: new Date(s.settle_time * 1000).toISOString().split('T')[0],
                settlement_amount: parseFloat(s.settlement_amount || s.revenue || 0),
                amount_paid: parseFloat(s.payout_amount || s.settlement_amount || 0),
            }));
        }
    } catch (err) {
        console.log('  Settlements API error:', err.message);
    }

    return null;
}

// ───────────────────────────────────────────────────────
// Step 4: Analytics
// ───────────────────────────────────────────────────────

async function fetchAnalytics() {
    console.log('Fetching analytics...');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    try {
        const result = await apiRequest('/api/data/overview', {
            start_date: thirtyDaysAgo.toISOString().split('T')[0],
            end_date: now.toISOString().split('T')[0],
        });

        if (result.data) {
            return {
                affiliate_gmv: parseFloat(result.data.gmv || result.data.affiliate_gmv || 0),
                est_commission: parseFloat(result.data.commission || result.data.est_commission || 0),
                orders: parseInt(result.data.orders || result.data.order_count || 0),
                gmv_refund: parseFloat(result.data.refund_gmv || result.data.gmv_refund || 0),
            };
        }
    } catch (err) {
        console.log('  Analytics API error:', err.message);
    }

    return null;
}

// ───────────────────────────────────────────────────────
// Main execution
// ───────────────────────────────────────────────────────

async function main() {
    console.log('=== TikTok Shop Agency Data Fetcher ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!APP_KEY || !APP_SECRET || !ACCESS_TOKEN) {
        console.error('Missing required environment variables.');
        console.log('Ensure TIKTOK_APP_KEY, TIKTOK_APP_SECRET, and TIKTOK_ACCESS_TOKEN are set as GitHub Secrets.');
        console.log('Keeping existing agency-data.json unchanged.');
        process.exit(0);
    }

    // Read existing data (always preserved as baseline)
    const dataPath = path.join(process.cwd(), 'agency-data.json');
    let existingData = { analytics: {}, payouts: [], distribution_payouts: [] };

    try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        existingData = JSON.parse(raw);
        console.log(`Loaded existing data: ${(existingData.payouts || []).length} creator payouts, ${(existingData.distribution_payouts || []).length} distribution payouts`);
    } catch (err) {
        console.log('No existing agency-data.json found, creating new one.');
    }

    // Discover shop cipher for v2 API
    const shopCipher = await getShopCipher();

    // Fetch all data in parallel
    const [settlements, analytics, v2Statements] = await Promise.all([
        fetchSettlements(),
        fetchAnalytics(),
        fetchStatements(shopCipher),
    ]);

    // ── Update creator payouts (v1 settlements) ──
    let payouts = existingData.payouts || [];

    if (settlements && settlements.length > 0) {
        console.log(`Got ${settlements.length} creator settlements from v1 API`);
        const allPayouts = [...settlements, ...payouts];
        const seen = new Set();
        payouts = allPayouts.filter(p => {
            const key = p.payment_id || `${p.date}-${p.amount_paid}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        payouts.sort((a, b) => b.date.localeCompare(a.date));
    } else {
        console.log('No new creator settlements, keeping existing.');
    }

    // ── Update distribution payouts ──
    // Existing distribution_payouts are ALWAYS preserved (seeded from Partner Center)
    // V2 API statements merge as new entries if any come back
    let distPayouts = existingData.distribution_payouts || [];

    if (v2Statements && v2Statements.length > 0) {
        console.log(`Got ${v2Statements.length} statements from v2 API — merging with existing`);
        distPayouts = [...v2Statements, ...distPayouts];
    }

    // Deduplicate distribution payouts
    if (distPayouts.length > 0) {
        const seen = new Set();
        distPayouts = distPayouts.filter(p => {
            const key = p.statement_id || `${p.date}-${p.amount_paid}-${p.type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        distPayouts.sort((a, b) => b.date.localeCompare(a.date));
    }

    // ── Update analytics ──
    let analyticsData = existingData.analytics || {};

    if (analytics) {
        console.log('Got analytics data');
        analyticsData = {
            ...analyticsData,
            ...analytics,
            last_updated: new Date().toISOString().split('T')[0],
        };
    } else {
        console.log('No new analytics, keeping existing.');
        analyticsData.last_updated = new Date().toISOString().split('T')[0];
    }

    // Write updated data
    const updatedData = {
        analytics: analyticsData,
        payouts: payouts,
        distribution_payouts: distPayouts,
    };

    fs.writeFileSync(dataPath, JSON.stringify(updatedData, null, 2) + '\n');

    const totalDist = distPayouts.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
    console.log(`\n=== Updated agency-data.json ===`);
    console.log(`  Creator payouts: ${payouts.length}`);
    console.log(`  Distribution payouts: ${distPayouts.length} ($${totalDist.toFixed(2)})`);
    console.log('=== Done ===');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(0); // Don't fail the action, keep existing data
});
