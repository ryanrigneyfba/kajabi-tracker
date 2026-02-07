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
function generateSign(path, params, body = '') {
    const sortedKeys = Object.keys(params).sort();
    let baseString = path;
    for (const key of sortedKeys) {
        baseString += key + params[key];
    }
    if (body) baseString += body;

    const hmac = crypto.createHmac('sha256', APP_SECRET);
    hmac.update(baseString);
    return hmac.digest('hex');
}

// Make an API request to TikTok Shop
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

    const response = await fetch(url, options);
    return response.json();
}

// Fetch settlements/payment data
async function fetchSettlements() {
    console.log('Fetching settlements...');

    // Get settlements from the last 90 days
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
        console.log('Settlements API error:', err.message);
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
        console.log('Transactions API error:', err.message);
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
        console.log('Analytics API error:', err.message);
    }

    return null;
}

// Main execution
async function main() {
    console.log('=== TikTok Shop Agency Data Fetcher ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!APP_KEY || !APP_SECRET || !ACCESS_TOKEN) {
        console.error('Missing required environment variables. Ensure TIKTOK_APP_KEY, TIKTOK_APP_SECRET, and TIKTOK_ACCESS_TOKEN are set as GitHub Secrets.');

        // If secrets aren't set yet, just keep existing data
        console.log('Keeping existing agency-data.json unchanged.');
        process.exit(0);
    }

    // Read existing data
    const dataPath = path.join(process.cwd(), 'agency-data.json');
    let existingData = { analytics: {}, payouts: [] };

    try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        existingData = JSON.parse(raw);
    } catch (err) {
        console.log('No existing agency-data.json found, creating new one.');
    }

    // Fetch all data
    const [settlements, transactions, analytics] = await Promise.all([
        fetchSettlements(),
        fetchTransactions(),
        fetchAnalytics(),
    ]);

    // Update payouts if API returned data
    let payouts = existingData.payouts || [];

    if (settlements && settlements.length > 0) {
        console.log(`Got ${settlements.length} settlements from API`);

        // Merge with existing, deduplicate
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
        console.log('No new settlements from API, keeping existing payouts.');
    }

    // Update analytics if API returned data
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
    };

    fs.writeFileSync(dataPath, JSON.stringify(updatedData, null, 2) + '\n');
    console.log(`Updated agency-data.json with ${payouts.length} payouts`);
    console.log('=== Done ===');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(0); // Don't fail the action, keep existing data
});
