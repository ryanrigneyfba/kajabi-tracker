/**
 * TikTok Partner Center → GitHub Agency Data Refresh
 *
 * Run this as a bookmarklet while logged into partner.us.tiktokshop.com
 *
 * Bookmarklet (paste into browser bookmark URL):
 * javascript:void(fetch('https://ryanrigneyfba.github.io/kajabi-tracker/scripts/refresh-agency-data.js').then(r=>r.text()).then(s=>eval(s)))
 */
(async function refreshAgencyData() {
  const REPO = 'ryanrigneyfba/kajabi-tracker';
  const FILE_PATH = 'agency-data.json';
  const DIST_PARTNER_ID = '8650986195390075694';
  const CREATOR_PARTNER_ID = '8647379727644267307';

  // Check we're on the right domain
  if (!location.hostname.includes('tiktokshop.com')) {
    alert('Please run this on partner.us.tiktokshop.com');
    return;
  }

  // Get GitHub PAT
  let token = localStorage.getItem('gh_pat_agency');
  if (!token) {
    token = prompt('Enter your GitHub Personal Access Token (stored locally for future use):');
    if (!token) return;
    localStorage.setItem('gh_pat_agency', token);
  }

  const status = (msg) => {
    console.log('[Agency Refresh]', msg);
    document.title = msg;
  };

  try {
    // 1. Fetch all distribution payouts
    status('Fetching distribution payouts...');
    const distPayouts = [];
    let page = 1;
    let total = 0;
    do {
      const resp = await fetch(
        `/api/v1/affiliate/partner/payout/search?page_size=20&page=${page}&user_language=en&partner_id=${DIST_PARTNER_ID}&aid=359713`,
        { credentials: 'include' }
      );
      const data = await resp.json();
      if (data.code !== 0 || !data.data?.payout_info) break;
      total = data.data.total_count;
      distPayouts.push(...data.data.payout_info);
      page++;
    } while (distPayouts.length < total);

    status(`Fetched ${distPayouts.length} distribution payouts`);

    // 2. Fetch creator service payouts
    status('Fetching creator service payouts...');
    const creatorPayouts = [];
    page = 1;
    total = 0;
    do {
      const resp = await fetch(
        `/api/v1/affiliate/partner/payout/search?page_size=20&page=${page}&user_language=en&partner_id=${CREATOR_PARTNER_ID}&aid=359713`,
        { credentials: 'include' }
      );
      const data = await resp.json();
      if (data.code !== 0 || !data.data?.payout_info) break;
      total = data.data.total_count;
      creatorPayouts.push(...data.data.payout_info);
      page++;
    } while (creatorPayouts.length < total);

    status(`Fetched ${creatorPayouts.length} creator payouts`);

    // 3. Format data
    const formatPayout = (r) => {
      const d = new Date(parseInt(r.payment_time));
      return {
        date: d.toISOString().split('T')[0],
        settlement_amount: parseFloat(r.amount),
        amount_paid: parseFloat(r.payment_amount)
      };
    };

    const formattedDist = distPayouts.map(r => ({
      statement_id: r.id,
      ...formatPayout(r),
      type: 'PRODUCT_DISTRIBUTION',
      currency: 'USD'
    }));

    const formattedCreator = creatorPayouts.map(r => ({
      payment_id: r.id,
      ...formatPayout(r)
    }));

    const today = new Date().toISOString().split('T')[0];
    const agencyData = {
      analytics: {
        last_updated: today,
        affiliate_gmv: 486223.22,
        est_commission: 41184.76,
        orders: 23077,
        gmv_refund: 13266.62
      },
      payouts: formattedCreator,
      distribution_payouts: formattedDist
    };

    const content = JSON.stringify(agencyData, null, 2);

    // 4. Get current file SHA from GitHub
    status('Getting current file from GitHub...');
    const ghResp = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: { 'Authorization': `token ${token}` }
    });
    const ghData = await ghResp.json();
    const sha = ghData.sha;

    // 5. Update file on GitHub
    status('Pushing update to GitHub...');
    const updateResp = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Update agency data - ${formattedDist.length} dist payouts, ${formattedCreator.length} creator payouts (${today})`,
        content: btoa(unescape(encodeURIComponent(content))),
        sha: sha
      })
    });

    if (updateResp.ok) {
      const totalDist = formattedDist.reduce((s, p) => s + p.settlement_amount, 0);
      status('✅ Updated!');
      alert(
        `Agency data updated successfully!\n\n` +
        `Distribution payouts: ${formattedDist.length} ($${totalDist.toLocaleString()})\n` +
        `Creator payouts: ${formattedCreator.length}\n` +
        `Latest: ${formattedDist[0]?.date}\n\n` +
        `Changes will appear on your tracker in ~2 minutes.`
      );
    } else {
      const err = await updateResp.json();
      throw new Error(err.message || 'GitHub API error');
    }
  } catch (e) {
    status('❌ Error');
    alert('Error: ' + e.message + '\n\nIf token expired, run: localStorage.removeItem("gh_pat_agency") in console and try again.');
  }
})();
