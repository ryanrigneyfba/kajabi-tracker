/**
 * Scrape Partner Center analytics using Playwright.
 *
 * Navigates to the TikTok Partner Center Data Overview page,
 * waits for metrics to render, and extracts:
 *   - Affiliate GMV
 *   - Est. commission
 *   - Orders
 *   - GMV (refund)
 *
 * Prints JSON to stdout on success, JSON error to stderr on failure.
 *
 * Requires: TIKTOK_SESSION_COOKIE environment variable.
 */

import { chromium } from 'playwright';

const TARGET_URL = 'https://partner.us.tiktokshop.com/compass/data-overview';
const COOKIE_DOMAIN = '.tiktokshop.com';
const LOAD_TIMEOUT = 45_000; // 45 seconds

async function main() {
  const cookieString = process.env.TIKTOK_SESSION_COOKIE;
  if (!cookieString) {
    fail('TIKTOK_SESSION_COOKIE not set');
  }

  const cookies = parseCookieString(cookieString);
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    await context.addCookies(cookies);

    const page = await context.newPage();
    console.error('Navigating to Partner Center Data Overview...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });

    // The analytics dashboard renders inside an iframe.
    // Wait for any frame on the page to contain "Affiliate GMV".
    console.error('Waiting for metrics to render...');
    const frame = await waitForMetricsFrame(page);
    if (!frame) {
      fail('Timed out waiting for metrics to appear on page');
    }

    // Give the frame an extra moment to finish painting numbers
    await page.waitForTimeout(3000);

    // Extract key metrics from the frame
    const metrics = await extractMetrics(frame);

    // Validate
    const missing = [];
    if (metrics.affiliate_gmv === null) missing.push('affiliate_gmv');
    if (metrics.est_commission === null) missing.push('est_commission');
    if (metrics.orders === null) missing.push('orders');
    if (metrics.gmv_refund === null) missing.push('gmv_refund');

    if (missing.length > 0) {
      fail(`Could not extract metrics: ${missing.join(', ')}. Page text sample: ${(await frame.textContent('body')).substring(0, 300)}`);
    }

    // Print result to stdout
    console.log(JSON.stringify(metrics));
    await browser.close();
    process.exit(0);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    fail(`Unexpected error: ${err.message}`);
  }
}

// ââââââââââââââââââââââââââââââââââââââââââ
// Helpers
// ââââââââââââââââââââââââââââââââââââââââââ

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

/**
 * Parse an HTTP cookie header string into Playwright cookie objects.
 * "name1=value1; name2=value2" â [{name, value, domain, path}, ...]
 */
function parseCookieString(raw) {
  return raw
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return null;
      return {
        name: pair.slice(0, eqIdx).trim(),
        value: pair.slice(eqIdx + 1).trim(),
        domain: COOKIE_DOMAIN,
        path: '/',
      };
    })
    .filter(Boolean);
}

/**
 * Wait (up to LOAD_TIMEOUT) for any frame to contain "Affiliate GMV".
 * Returns the matching Frame, or null on timeout.
 */
async function waitForMetricsFrame(page) {
  const deadline = Date.now() + LOAD_TIMEOUT;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const text = await frame.textContent('body', { timeout: 2000 });
        if (text && text.includes('Affiliate GMV')) {
          return frame;
        }
      } catch {
        // frame not ready yet
      }
    }
    await page.waitForTimeout(1500);
  }
  return null;
}

/**
 * Extract the four Key Metrics from a Playwright Frame.
 */
async function extractMetrics(frame) {
  const text = await frame.textContent('body');

  return {
    affiliate_gmv: extractDollarAfter(text, /Affiliate\s+GMV/),
    est_commission: extractDollarAfter(text, /Est\.\s*commission/),
    orders: extractIntAfter(text, /\bOrders\b/),
    gmv_refund: extractDollarAfter(text, /GMV\s*\(\s*refund\s*\)/),
  };
}

/**
 * Find a label in the text, then grab the first $-prefixed number after it.
 * Returns a float or null.
 */
function extractDollarAfter(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  // Grab the chunk after the label (up to 200 chars should cover the value)
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
  const val = after.match(/\$([\d,]+\.?\d*)/);
  return val ? parseFloat(val[1].replace(/,/g, '')) : null;
}

/**
 * Find a label, then grab the first plain integer (with possible commas) after it.
 * Returns an integer or null.
 */
function extractIntAfter(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
  // Match a standalone number (with commas), not preceded by $
  const val = after.match(/(?<!\$)([\d,]{1,20})(?=\s|$|[^.\d])/);
  return val ? parseInt(val[1].replace(/,/g, ''), 10) : null;
}

main().catch((err) => {
  fail(`Fatal: ${err.message}`);
});
