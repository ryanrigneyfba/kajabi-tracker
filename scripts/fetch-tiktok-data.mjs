/**
 * TikTok Shop Partner API - Auto-fetch Agency Data
 *
 * This script runs via GitHub Actions to automatically fetch
 * financial data from TikTok Shop Partner Center and update
 * agency-data.json in the repository.
 *
 * Required GitHub Secrets:
 * - TIKTOK_APP_KEY: Your TikTok Shop app key
 * - TIKTOK_APP_SECRET: Your TikTok Shop app secret
 * - TIKTOK_ACCESS_TOKEN: OAuth access token (obtained via setup script)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const APP_KEY = process.env.TIKTOK_APP_KEY;
const APP_SECRET = process.env.TIKTOK_APP_SECRET;
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

const API_BASE = 'https://open-api.tiktokglobalshop.com';
const API_VERSION = '202309';

// Generate HMAC-SHA256 signature for TikTok Shop API
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

// Make an API request to TikTok Shop (supports both v1 and v2 endpoints)
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
    const response = await fetch(url, options);
    return response.json();
}

// ═══════════════════════════════════════════════════════
// V2 Finance API: Get Statements (includes distribution payouts)
// Endpoint: /finance/202309/statements
// This is the primary v2 endpoint for all financial statements
// including Product Distribution Service payouts
// ═══════════════════════════════════════════════════════
async function fetchStatements() {
    console.log('Fetching v2 statements (distribution payouts)...');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Try multiple statement types that could contain distribution payouts
    const statementTypes = [
        'PRODUCT_DISTRIBUTION',
        'AFFILIATE',
        'COMMISSION',
        'SETTLE',
        null // no filter - get all
    ];

    let allStatements = [];

    for (const stmtType of statementTypes) {
        try {
            const bodyData = {
                page_size: 100,
                sort_order: 'DESC',
            };

            // Try with date range in body
            bodyData.statement_time = {
                start_time: Math.floor(ninetyDaysAgo.getTime() / 1000),
                end_time: Math.floor(now.getTime() / 1000),
            };

            if (stmtType) {
                bodyData.statement_type = stmtType;
            }

            const result = await apiRequest('/finance/202309/statements', {}, bodyData);

            if (result.data && (result.data.statements || result.data.statement_list)) {
                const stmts = result.data.statements || result.data.statement_list || [];
                console.log(`  Got ${stmts.length} statements (type: ${stmtType || 'all'})`);

                for (const s of stmts) {
                    allStatements.push({
                        statement_id: s.id || s.statement_id || '',
                        date: s.statement_time
                            ? new Date(s.statement_time * 1000).toISOString().split('T')[0]
                            : (s.settle_time ? new Date(s.settle_time * 1000).toISOString().split('T')[0] : ''),
                        settlement_amount: parseFloat(s.settlement_amount || s.revenue_amount || s.amount || 0),
                        amount_paid: parseFloat(s.payout_amount || s.paid_amount || s.settlement_amount || s.amount || 0),
                        type: s.statement_type || s.type || stmtType || 'unknown',
                        currency: s.currency || 'USD',
                    });
                }

                // If we got results with no filter, no need to try type filters
                if (!stmtType && stmts.length > 0) break;
            }
        } catch (err) {
            console.log(`  Statements (type: ${stmtType || 'all'}) error:`, err.message);
        }
    }

    // Also try the v2 endpoint with query params instead of body
    if (allStatements.length === 0) {
        try {
            const result = await apiRequest('/finance/202309/statements', {
                page_size: '100',
                start_time: String(Math.floor(ninetyDaysAgo.getTime() / 1000)),
                end_time: String(Math.floor(now.getTime() / 1000)),
            });

            if (result.data && (result.data.statements || result.data.statement_list)) {
                const stmts = result.data.statements || result.data.statement_list || [];
                console.log(`  Got ${stmts.length} statements (query params)`);
                for (const s of stmts) {
                    allStatements.push({
                        statement_id: s.id || s.statement_id || '',
                        date: s.statement_time
                            ? new Date(s.statement_time * 1000).toISOString().split('T')[0]
                            : '',
                        settlement_amount: parseFloat(s.settlement_amount || s.revenue_amount || s.amount || 0),
                        amount_paid: parseFloat(s.payout_amount || s.paid_amount || s.settlement_amount || s.amount || 0),
                        type: s.statement_type || s.type || 'unknown',
                        currency: s.currency || 'USD',
                    });
                }
            }
        } catch (err) {
            console.log('  Statements (query params) error:', err.message);
        }
    }

    // Deduplicate
    const seen = new Set();
    allStatements = allStatements.filter(s => {
        const key = s.statement_id || `${s.date}-${s.amount_paid}-${s.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return allStatements.length > 0 ? allStatements : null;
}

// ═══════════════════════════════════════════════════════
// V2 Finance API: Get Payments
// Try to get actual payout/payment records
// ═══════════════════════════════════════════════════════
async function fetchPayments() {
    console.log('Fetching v2 payments...');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const endpoints = [
        '/finance/202309/payments',
        '/finance/202309/payouts',
        '/finance/202309/withdrawals',
    ];

    for (const endpoint of endpoints) {
        try {
            const result = await apiRequest(endpoint, {
                page_size: '100',
                start_time: String(Math.floor(ninetyDaysAgo.getTime() / 1000)),
                end_time: String(Math.floor(now.getTime() / 1000)),
            });

            if (result.data && !result.code) {
                const payments = result.data.payments || result.data.payment_list ||
                    result.data.payouts || result.data.payout_list ||
                    result.data.withdrawals || result.data.withdrawal_list || [];

                if (payments.length > 0) {
                    console.log(`  Got ${payments.length} payments from ${endpoint}`);
                    return payments.map(p => ({
                        payment_id: p.id || p.payment_id || p.payout_id || '',
                        date: p.payment_time
                            ? new Date(p.payment_time * 1000).toISOString().split('T')[0]
                            : (p.create_time ? new Date(p.create_time * 1000).toISOString().split('T')[0] : ''),
                        amount: parseFloat(p.amount || p.payout_amount || p.payment_amount || 0),
                        status: p.status || '',
                        type: p.type || p.payment_type || 'distribution',
                        currency: p.currency || 'USD',
                    }));
                }
            }
        } catch (err) {
            console.log(`  ${endpoint} error:`, err.message);
        }
    }

    return null;
}

// ═══════════════════════════════════════════════════════
// V1 Legacy: Fetch settlements/payment data (creator payouts)
// ═══════════════════════════════════════════════════════
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

// Fetch transactions data
async function fetchTransactions() {
    console.log('Fetching transactions...');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    try {
        const result = await apiRequest('/api/finance/transactions/search', {}, {
            request_time_from: Math.floor(ninetyDaysAgo.getTime() / 1000),
            request_time_to: Math.floor(now.getTime() / 1000),
            page_size: 100,
            transaction_type: 'SETTLE',
        });

        if (result.data && result.data.transaction_list) {
            return result.data.transaction_list;
        }
    } catch (err) {
        console.log('  Transactions API error:', err.message);
    }

    return null;
}

// Fetch partner analytics data
async function fetchAnalytics() {
    console.log('Fetching analytics...');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    // Try the data overview / analytics endpoint
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

// Main execution
async function main() {
    console.log('=== TikTok Shop Agency Data Fetcher ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!APP_KEY || !APP_SECRET || !ACCESS_TOKEN) {
        console.error('Missing required environment variables. Ensure TIKTOK_APP_KEY, TIKTOK_APP_SECRET, and TIKTOK_ACCESS_TOKEN are set as GitHub Secrets.');
        console.log('Keeping existing agency-data.json unchanged.');
        process.exit(0);
    }

    // Read existing data
    const dataPath = path.join(process.cwd(), 'agency-data.json');
    let existingData = { analytics: {}, payouts: [], distribution_payouts: [] };

    try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        existingData = JSON.parse(raw);
    } catch (err) {
        console.log('No existing agency-data.json found, creating new one.');
    }

    // Fetch all data in parallel
    const [settlements, transactions, analytics, v2Statements, v2Payments] = await Promise.all([
        fetchSettlements(),
        fetchTransactions(),
        fetchAnalytics(),
        fetchStatements(),
        fetchPayments(),
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
        console.log('No new creator settlements from v1 API, keeping existing.');
    }

    // ── Update distribution payouts (v2 statements + payments) ──
    let distPayouts = existingData.distribution_payouts || [];

    // Merge v2 statements
    if (v2Statements && v2Statements.length > 0) {
        console.log(`Got ${v2Statements.length} distribution statements from v2 API`);
        const newDistPayouts = v2Statements.map(s => ({
            statement_id: s.statement_id,
            date: s.date,
            settlement_amount: s.settlement_amount,
            amount_paid: s.amount_paid,
            type: s.type,
            currency: s.currency,
        }));
        distPayouts = [...newDistPayouts, ...distPayouts];
    }

    // Merge v2 payments
    if (v2Payments && v2Payments.length > 0) {
        console.log(`Got ${v2Payments.length} payments from v2 API`);
        const newPaymentPayouts = v2Payments.map(p => ({
            statement_id: p.payment_id,
            date: p.date,
            settlement_amount: p.amount,
            amount_paid: p.amount,
            type: p.type || 'payment',
            currency: p.currency,
        }));
        distPayouts = [...newPaymentPayouts, ...distPayouts];
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
        console.log('Got analytics data from API');
        analyticsData = {
            ...analyticsData,
            ...analytics,
            last_updated: new Date().toISOString().split('T')[0],
        };
    } else {
        console.log('No new analytics from API, keeping existing.');
        analyticsData.last_updated = new Date().toISOString().split('T')[0];
    }

    // Write updated data
    const updatedData = {
        analytics: analyticsData,
        payouts: payouts,
        distribution_payouts: distPayouts,
    };

    fs.writeFileSync(dataPath, JSON.stringify(updatedData, null, 2) + '\n');
    console.log(`\nUpdated agency-data.json:`);
    console.log(`  - ${payouts.length} creator payouts`);
    console.log(`  - ${distPayouts.length} distribution payouts`);
    console.log('=== Done ===');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(0); // Don't fail the action, keep existing data
});
