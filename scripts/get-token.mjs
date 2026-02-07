/**
 * TikTok Shop OAuth Token Setup - ONE TIME ONLY
 *
 * Run this script locally to get your initial access token.
 * Then add the token to GitHub Secrets.
 *
 * Steps:
 * 1. Go to: https://services.us.tiktokshop.com/open/authorize?service_id=7584563551361271565
 * 2. Authorize the app
 * 3. Copy the 'code' from the redirect URL
 * 4. Run: node scripts/get-token.mjs YOUR_AUTH_CODE
 * 5. Copy the access_token and add it as TIKTOK_ACCESS_TOKEN in GitHub Secrets
 *
 * Your App Key: 6ichv6m7rqve2
 * Your Service ID: 7584563551361271565
 */

const APP_KEY = '6ichv6m7rqve2';
// Set your app secret here or via environment variable
const APP_SECRET = process.env.TIKTOK_APP_SECRET || 'YOUR_APP_SECRET_HERE';
const AUTH_CODE = process.argv[2];

if (!AUTH_CODE) {
    console.log('');
    console.log('=== TikTok Shop OAuth Token Setup ===');
    console.log('');
    console.log('Step 1: Open this URL in your browser:');
    console.log('');
    console.log('  https://services.us.tiktokshop.com/open/authorize?service_id=7584563551361271565');
    console.log('');
    console.log('Step 2: Authorize the app. You will be redirected to a URL containing a "code" parameter.');
    console.log('');
    console.log('Step 3: Run this script again with the auth code:');
    console.log('');
    console.log('  TIKTOK_APP_SECRET=your_secret node scripts/get-token.mjs YOUR_AUTH_CODE');
    console.log('');
    console.log('Step 4: Copy the access_token and add these GitHub Secrets:');
    console.log('  - TIKTOK_APP_KEY: 6ichv6m7rqve2');
    console.log('  - TIKTOK_APP_SECRET: (your app secret)');
    console.log('  - TIKTOK_ACCESS_TOKEN: (the token from step 3)');
    console.log('');
    process.exit(0);
}

async function getToken() {
    console.log('Exchanging auth code for access token...');

    const url = 'https://auth.tiktok-shops.com/api/v2/token/get';
    const params = new URLSearchParams({
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        auth_code: AUTH_CODE,
        grant_type: 'authorized_code',
    });

    try {
        const response = await fetch(`${url}?${params}`);
        const data = await response.json();

        if (data.data && data.data.access_token) {
            console.log('');
            console.log('=== SUCCESS! ===');
            console.log('');
            console.log('Access Token:', data.data.access_token);
            console.log('Refresh Token:', data.data.refresh_token);
            console.log('Expires in:', data.data.access_token_expire_in, 'seconds');
            console.log('');
            console.log('Now add these as GitHub Secrets in your kajabi-tracker repo:');
            console.log('  Settings > Secrets and variables > Actions > New repository secret');
            console.log('');
            console.log('  TIKTOK_APP_KEY = 6ichv6m7rqve2');
            console.log('  TIKTOK_APP_SECRET = (your app secret)');
            console.log('  TIKTOK_ACCESS_TOKEN = ' + data.data.access_token);
            console.log('');
        } else {
            console.error('Error:', JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error('Request failed:', err.message);
    }
}

getToken();
