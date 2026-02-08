# TikTok Agency Data Automation — Progress Notes

## Current Status (Feb 8, 2026)
**Automation is BUILT and DEPLOYED.** One setup step remains: adding the session cookie as a GitHub Secret.

---

## What's Been Done

### 1. Fetch Script Rewritten (commit `0de0da4`)
- **File:** `scripts/fetch-tiktok-data.mjs`
- Replaced the old TikTok Open API approach (app_key, app_secret, access_token) which NEVER WORKED because:
  - This is a CAP (Creator Agency Partner) account
  - The US Partner Center does NOT expose Open API credentials for CAP accounts
  - There is no "Developing" tab in the US Partner Center
- New approach uses the **internal Partner Center API** — the same endpoints the web UI calls:
  - `GET /api/v1/affiliate/partner/payout/search`
  - Distribution partner ID: `8650986195390075694`
  - Creator service partner ID: `8647379727644267307`
  - Pagination: 20 records per page, auto-paginated
- Authentication: session cookie from the `TIKTOK_SESSION_COOKIE` GitHub Secret
- **Cookie expiry detection:** If cookies expire, auto-creates a GitHub Issue with refresh instructions
- Existing data preserved if API fails

### 2. Workflow Updated (commit `eb81bce`)
- **File:** `.github/workflows/update-agency-data.yml`
- Runs every 6 hours via cron (`0 */6 * * *`) + manual trigger
- Uses `TIKTOK_SESSION_COOKIE` secret (replaces old app_key/secret/token)
- Added `issues: write` permission so expired-cookie alerts can create Issues
- Passes `GITHUB_TOKEN` to script for Issue creation
- No npm dependencies needed (Node 20 has native `fetch`)

### 3. Bookmarklet Also Available (commit `b6f3bd0`)
- **File:** `scripts/refresh-agency-data.js`
- One-click data refresh from the browser when logged into Partner Center
- Run as bookmarklet: `javascript:void(fetch('https://ryanrigneyfba.github.io/kajabi-tracker/scripts/refresh-agency-data.js').then(r=>r.text()).then(s=>eval(s)))`
- Fetches all payouts and pushes directly to GitHub via API
- Requires a GitHub PAT stored in localStorage (prompted on first use)
- Use this as a FALLBACK when session cookies expire

### 4. Previous Tracker Improvements
- **15% manager deduction** on agency payouts (commit `3d04073`)
- **Double dollar sign bug** fixed (commit `8547bd9`)
- **327 distribution payout records** populated ($161,475.74 total)
- Business Dashboard shows Info Profit, Agency Profit (with manager cut), and Combined Profit

---

## REMAINING SETUP: Add Session Cookie

### What you need to do (ONE TIME, ~30 seconds):

1. Log in to [partner.us.tiktokshop.com](https://partner.us.tiktokshop.com)
2. Open Chrome DevTools: **F12** (or right-click → Inspect)
3. Go to the **Network** tab
4. Reload the page (F5)
5. Click any request to `partner.us.tiktokshop.com` in the list
6. In the **Headers** panel, scroll to **Request Headers**
7. Find the `Cookie:` header and copy its ENTIRE value
8. Go to [GitHub repo Settings → Secrets → Actions](https://github.com/ryanrigneyfba/kajabi-tracker/settings/secrets/actions)
9. Click **New repository secret**
10. Name: `TIKTOK_SESSION_COOKIE`
11. Value: paste the cookie string
12. Click **Add secret**

### After adding the secret:
- Go to [Actions](https://github.com/ryanrigneyfba/kajabi-tracker/actions)
- Click "Update Agency Data from TikTok Shop"
- Click "Run workflow" to trigger a manual test
- Check the run logs to verify it fetches data successfully

### When cookies expire:
- The workflow will auto-create a GitHub Issue titled "🔑 TikTok session cookie expired"
- Repeat steps 1-12 above to refresh the cookie
- TikTok sessions typically last days to weeks

---

## Key API Details

| Item | Value |
|------|-------|
| Distribution Partner ID | `8650986195390075694` |
| Creator Partner ID | `8647379727644267307` |
| API Endpoint | `/api/v1/affiliate/partner/payout/search` |
| Page Size | 20 |
| Aid Parameter | `359713` |
| Auth Method | Session cookies (httpOnly) |
| Response Format | `{ code: 0, data: { total_count: N, payout_info: [...] } }` |
| Payment fields | `id`, `payment_time` (unix ms), `amount`, `payment_amount`, `currency` |

## Data File Structure (`agency-data.json`)
```json
{
  "analytics": { "last_updated": "YYYY-MM-DD", ... },
  "payouts": [{ "payment_id", "date", "settlement_amount", "amount_paid" }],
  "distribution_payouts": [{ "statement_id", "date", "settlement_amount", "amount_paid", "type", "currency" }]
}
```

## Why Full Zero-Touch Isn't Possible
- TikTok Partner Center has NO public API credentials for CAP accounts
- The internal API authenticates via httpOnly session cookies
- These cookies CANNOT be extracted programmatically (browser security)
- Sessions expire, requiring periodic manual refresh
- TikTok has bot detection preventing automated login via Playwright/Puppeteer
- **Best achievable:** GitHub Actions runs autonomously until cookies expire, then auto-alerts you to refresh
