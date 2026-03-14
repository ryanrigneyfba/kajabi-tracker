# TikTok Automation

## How It Works
GitHub Actions runs every 6 hours to fetch TikTok Shop agency data using internal Partner Center API endpoints.

## Architecture
```
GitHub Actions (cron: every 6h)
  → scripts/fetch-tiktok-data.mjs
    → TikTok Partner Center internal API
      → GET /api/v1/affiliate/partner/payout/search
    → Writes to agency-data.json
    → Auto-commits to repo
```

## Authentication
- Uses `TIKTOK_SESSION_COOKIE` GitHub Secret
- Session cookies are httpOnly — must be copied manually from browser DevTools
- Cookies expire every few days to weeks
- When expired, workflow auto-creates a GitHub Issue with refresh instructions

## Cookie Refresh Steps
1. Log in to [partner.us.tiktokshop.com](https://partner.us.tiktokshop.com)
2. Open DevTools (F12) → Network tab → reload page
3. Click any request → Headers → copy full `Cookie:` value
4. Go to repo Settings → Secrets → Actions
5. Update `TIKTOK_SESSION_COOKIE` with new value

## Fallback: Browser Bookmarklet
If cookies are expired and you need data NOW:
```javascript
javascript:void(fetch('https://ryanrigneyfba.github.io/kajabi-tracker/scripts/refresh-agency-data.js').then(r=>r.text()).then(s=>eval(s)))
```
- Requires GitHub PAT in localStorage (prompted on first use)
- Pushes data directly to repo via GitHub API

## Files
- `.github/workflows/update-agency-data.yml` — workflow definition
- `scripts/fetch-tiktok-data.mjs` — fetch script
- `scripts/refresh-agency-data.js` — browser bookmarklet fallback
- `agency-data.json` — output data

## Limitations
- No public API for TikTok CAP accounts
- Cannot automate login (bot detection)
- Cookie refresh is manual

## Related
- [[TikTok Agency Revenue]]
- [[Whop Automation]]

#automation #tiktok #systems
