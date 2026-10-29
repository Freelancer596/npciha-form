'use strict';
// Server-only Google Sheets sync. The service-account key must exist only in Vercel env vars.
const crypto = require('crypto');

let cachedToken = null;
let cachedUntil = 0;

const HEADERS = [
  'Reference No', 'Application Date', 'Name', 'Father Name', 'CNIC', 'Date of Birth',
  'Religion', 'Education', 'Designation', 'Wing', 'Residence Address', 'Office Address',
  'Profession', 'Contact', 'Email', 'Province ID', 'District ID', 'Taluka', 'Status',
  'Image / Photo', 'Office Level', 'Office Area'   // photo column stays empty; level/area let the chairman filter office-bearers
];

const capLevel = v => v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '';

// Short, secret-free reason that shows up in the Vercel log.
function webhookFailure(status, text, data) {
  if (data && data.error) return 'google_webhook_failed_' + status + '_' + data.error;       // e.g. bad_secret
  if (/^\s*</.test(text || '')) return 'google_webhook_html_page_' + status + '_check_deploy_access_Anyone_and_exec_url';
  return 'google_webhook_failed_' + status + '_not_json';
}

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

async function accessToken(serviceAccount) {
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const claim = b64url({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const unsigned = header + '.' + claim;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + '.' + signer.sign(serviceAccount.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('google_token_failed');
  cachedToken = data.access_token;
  cachedUntil = Date.now() + Math.max(60, (Number(data.expires_in) || 3600) - 120) * 1000;
  return cachedToken;
}

async function sheetsRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('google_sheets_http_' + response.status);
  return data;
}

async function appendViaWebhook(url, secret, member, location) {
  const row = [
    member.ref || '', member.date || '', member.name || '', member.father || '',
    member.cnic || '', member.dob || '', member.religion || '', member.education || '',
    member.designation || '', member.wing || '', member.res || '', member.off || '',
    member.prof || '', member.contact || '', member.email || '',
    location.province_id || '', location.district_id || '', location.taluka_name || '', 'Pending',
    '', capLevel(member.office_level), member.office_area || ''
  ];
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, headers: HEADERS, row })
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch (e) { /* non-JSON answer = Google error/login page */ }
  if (!response.ok || !data.ok) throw new Error(webhookFailure(response.status, text, data));
  return { appended: true, via: 'webhook' };
}

async function appendBatchViaWebhook(rows) {
  const url = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
  const secret = (process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim();
  if (!url || !secret) throw new Error('google_webhook_not_configured');
  if (!/^https:\/\/script\.google\.com\//.test(url)) throw new Error('google_webhook_url_invalid');
  const response = await fetch(url, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, headers: HEADERS, rows })
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!response.ok || !data.ok) throw new Error('google_webhook_failed_' + response.status + (data.error ? '_' + data.error : ''));
  return { added: Number(data.added) || 0, skipped: Number(data.skipped) || 0 };
}

async function appendViaSheetsApi(member, location, spreadsheetId, account) {
  if (!account.client_email || !account.private_key) throw new Error('google_service_account_invalid');
  const tab = (process.env.GOOGLE_SHEETS_TAB_NAME || 'Applications').trim() || 'Applications';
  const token = await accessToken(account);
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
  const quotedTab = "'" + tab.replace(/'/g, "''") + "'";
  const range = quotedTab + '!A:V';

  const headerRange = quotedTab + '!A1:V1';
  const current = await sheetsRequest(base + '/values/' + encodeURIComponent(headerRange), token);
  if (!current.values || !current.values.length || !current.values[0].length) {
    await sheetsRequest(base + '/values/' + encodeURIComponent(headerRange) + '?valueInputOption=RAW', token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [HEADERS] })
    });
  }

  const values = [[
    member.ref || '', member.date || '', member.name || '', member.father || '',
    member.cnic || '', member.dob || '', member.religion || '', member.education || '',
    member.designation || '', member.wing || '', member.res || '', member.off || '',
    member.prof || '', member.contact || '', member.email || '',
    location.province_id || '', location.district_id || '', location.taluka_name || '', 'Pending',
    '', capLevel(member.office_level), member.office_area || ''
  ]];
  await sheetsRequest(base + '/values/' + encodeURIComponent(range) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return { appended: true, via: 'sheets_api' };
}

// Tries the direct Sheets API (service account) first, then the Apps Script webhook.
// A broken service-account value must never block the webhook fallback.
async function appendRegistration(member, location) {
  const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
  const accountText = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const webhookUrl = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
  let firstError = null;

  if (spreadsheetId && accountText) {
    try {
      let account;
      try { account = JSON.parse(accountText); } catch (e) { throw new Error('google_service_account_not_valid_json'); }
      return await appendViaSheetsApi(member, location, spreadsheetId, account);
    } catch (e) {
      firstError = e;
      if (!webhookUrl) throw e;
      console.error('[sheets] direct API failed (' + (e && e.message ? e.message : 'unknown') + '), trying webhook');
    }
  }

  if (webhookUrl) {
    const secret = (process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim();
    if (!/^https:\/\/script\.google\.com\//.test(webhookUrl)) throw new Error('google_webhook_url_invalid');
    try { return await appendViaWebhook(webhookUrl, secret, member, location); }
    catch (e) { if (firstError) e.message += ' (direct_api: ' + firstError.message + ')'; throw e; }
  }
  return { skipped: true };
}

module.exports = { appendRegistration, appendBatchViaWebhook, HEADERS, capLevel };
