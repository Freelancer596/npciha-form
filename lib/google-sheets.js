'use strict';
// Server-only Google Sheets sync. The service-account key must exist only in Vercel env vars.
const crypto = require('crypto');

let cachedToken = null;
let cachedUntil = 0;

const HEADERS = [
  'Reference No', 'Application Date', 'Name', 'Father Name', 'CNIC', 'Date of Birth',
  'Religion', 'Education', 'Designation', 'Wing', 'Residence Address', 'Office Address',
  'Profession', 'Contact', 'Email', 'Province', 'District', 'Taluka', 'Status',
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
    signal: AbortSignal.timeout(9000),
    headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('google_sheets_http_' + response.status);
  return data;
}

const MAX_ROWS = 20000;
const cap = v => v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : 'Pending';
function karachiDate(iso) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(iso));
  const g = t => p.find(x => x.type === t).value;
  return +g('day') + '-' + +g('month') + '-' + g('year');
}
// Phone as 0300-1234567 so Google Sheets keeps it as text and shows the leading 0.
function phone(v) {
  const d = String(v || '').replace(/\D/g, '');
  return /^03\d{9}$/.test(d) ? d.slice(0, 4) + '-' + d.slice(4) : String(v || '');
}

// Reads EVERY member from the database and returns sheet rows with real names
// (province / district / taluka), never ids. Throws if the names cannot be read,
// so the sheet is never overwritten with ids or blanks by mistake.
async function loadSheetRows() {
  const sb = require('./sb');
  const list = async (table, cols) => (await sb.select(table, [['select', cols], ['limit', '5000']])).data || [];
  const [provinces, districts, talukas] = await Promise.all([list('provinces', 'id,name'), list('districts', 'id,name,province_id'), list('talukas', 'id,name')]);
  const pn = new Map(provinces.map(x => [x.id, x.name]));
  const dn = new Map(districts.map(x => [x.id, x.name]));
  const dp = new Map(districts.map(x => [x.id, x.province_id]));
  const tn = new Map(talukas.map(x => [x.id, x.name]));

  const members = [];
  for (let off = 0; members.length < MAX_ROWS; off += 1000) {
    const r = await sb.select('members', [['select', 'ref_no,created_at,name,father_name,cnic,dob,religion,education,designation,office_level,office_area,wing,residence_address,office_address,profession,contact,email,province_id,district_id,taluka_id,taluka_name,status'], ['order', 'created_at.asc,id.asc'], ['limit', '1000'], ['offset', String(off)]]);
    members.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  const rows = members.slice(0, MAX_ROWS).map(m => [
    m.ref_no || '', m.created_at ? karachiDate(m.created_at) : '', m.name || '', m.father_name || '', m.cnic || '', m.dob || '',
    m.religion || '', m.education || '', m.designation || '', m.wing || '', m.residence_address || '', m.office_address || '',
    m.profession || '', phone(m.contact), m.email || '',
    pn.get(m.province_id) || pn.get(dp.get(m.district_id)) || '',
    dn.get(m.district_id) || '',
    m.taluka_name || tn.get(m.taluka_id) || '',
    cap(m.status), '', capLevel(m.office_level), m.office_area || ''
  ]);
  return { headers: HEADERS, rows };
}

function isConfigured() {
  const hasApi = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim() && (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  return !!(hasApi || (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim());
}

// Direct Sheets API: write everything from A1 (header + all rows), then clear whatever is left below
// (removed members). The sheet is never empty while it is being refreshed.
async function replaceViaSheetsApi(rows, spreadsheetId, account) {
  if (!account.client_email || !account.private_key) throw new Error('google_service_account_invalid');
  const tab = (process.env.GOOGLE_SHEETS_TAB_NAME || 'Applications').trim() || 'Applications';
  const token = await accessToken(account);
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
  const q = "'" + tab.replace(/'/g, "''") + "'";
  const all = [HEADERS, ...rows], CHUNK = 4000;
  for (let i = 0; i < all.length; i += CHUNK) {
    await sheetsRequest(base + '/values/' + encodeURIComponent(q + '!A' + (i + 1)) + '?valueInputOption=RAW', token, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: all.slice(i, i + CHUNK) })
    });
  }
  await sheetsRequest(base + '/values/' + encodeURIComponent(q + '!A' + (all.length + 1) + ':V') + ':clear', token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  return { replaced: true, rows: rows.length, via: 'sheets_api' };
}

// Apps Script web app (docs/google-apps-script.gs, "replace" mode): the script rewrites the whole tab.
async function replaceViaWebhook(url, secret, rows) {
  if (!/^https:\/\/script\.google\.com\//.test(url)) throw new Error('google_webhook_url_invalid');
  const response = await fetch(url, {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(9000),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, mode: 'replace', headers: HEADERS, rows })
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch (e) { /* non-JSON answer = Google error/login page */ }
  if (!response.ok || !data.ok) throw new Error(webhookFailure(response.status, text, data));
  if (data.mode !== 'replace') throw new Error('google_script_is_old_paste_the_new_apps_script_and_redeploy');
  return { replaced: true, rows: rows.length, via: 'webhook' };
}

// Rewrites the WHOLE Google Sheet from the database: every row re-checked, full names, current status.
// Tries the direct Sheets API (service account) first, then the Apps Script webhook.
async function replaceAll() {
  if (!isConfigured()) return { skipped: true };
  const { rows } = await loadSheetRows();
  const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
  const accountText = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const webhookUrl = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
  let firstError = null;
  if (spreadsheetId && accountText) {
    try {
      let account;
      try { account = JSON.parse(accountText); } catch (e) { throw new Error('google_service_account_not_valid_json'); }
      return await replaceViaSheetsApi(rows, spreadsheetId, account);
    } catch (e) {
      firstError = e;
      if (!webhookUrl) throw e;
      console.error('[sheets] direct API failed (' + (e && e.message ? e.message : 'unknown') + '), trying webhook');
    }
  }
  const secret = (process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim();
  try { return await replaceViaWebhook(webhookUrl, secret, rows); }
  catch (e) { if (firstError) e.message += ' (direct_api: ' + firstError.message + ')'; throw e; }
}

// Never lets a Sheets problem break the real action (registration, approve, edit, delete).
async function syncAll(where) {
  try { return await replaceAll(); }
  catch (e) { console.error('[' + where + '] Google Sheets sync failed:', e && e.message ? e.message : 'unknown_error'); return { failed: true }; }
}

module.exports = { replaceAll, syncAll, loadSheetRows, isConfigured, HEADERS, capLevel };
