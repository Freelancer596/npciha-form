'use strict';
// Private CSV feed of all registrations for Google Sheets:  =IMPORTDATA("https://<site>/api/sheet-feed?key=<token>")
// Protected by SHEET_FEED_TOKEN (Vercel env var). Without the right key it answers 404 like any unknown page.
const crypto = require('crypto');
const sb = require('../lib/sb');
const { secHeaders, sendError, handleError } = require('../lib/http');
const { HEADERS } = require('../lib/google-sheets');

const MAX_ROWS = 20000;
const h = x => crypto.createHash('sha256').update(String(x)).digest();

// CSV cell: quote, double inner quotes, and neutralise spreadsheet formulas (=,+,-,@) in user-typed text.
function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^\+?\d[\d\- ]*$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
// Phone as 0300-1234567 so Google Sheets keeps it as text (a plain 0300… would lose the leading 0).
function phone(v) {
  const d = String(v || '').replace(/\D/g, '');
  return /^03\d{9}$/.test(d) ? d.slice(0, 4) + '-' + d.slice(4) : String(v || '');
}
function karachiDate(iso) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(iso));
  const g = t => p.find(x => x.type === t).value;
  return +g('day') + '-' + +g('month') + '-' + g('year');
}

module.exports = async (req, res) => {
  secHeaders(res);
  try {
    const need = (process.env.SHEET_FEED_TOKEN || '').trim();
    const given = String((req.query && req.query.key) || '').trim();
    if (req.method !== 'GET' || need.length < 24 || !given || !crypto.timingSafeEqual(h(given), h(need))) {
      return sendError(res, 404, 'not_found', 'Not found.');
    }
    const dn = new Map();
    try { (await sb.select('districts', [['select', 'id,name'], ['limit', '500']])).data.forEach(d => dn.set(d.id, d.name)); } catch (e) { /* ids are used instead */ }

    const rows = [];
    let off = 0;
    while (rows.length < MAX_ROWS) {
      const r = await sb.select('members', [['select', 'ref_no,created_at,name,father_name,cnic,dob,religion,education,designation,office_level,office_area,wing,residence_address,office_address,profession,contact,email,province_id,district_id,taluka_name,status'], ['order', 'created_at.asc'], ['limit', '1000'], ['offset', String(off)]]);
      rows.push(...r.data);
      if (r.data.length < 1000) break;
      off += 1000;
    }
    const head = HEADERS.map((x, i) => i === 16 ? 'District' : i === 15 ? 'Province ID' : x);
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Pending';
    // header=0 -> data rows only (use when the sheet already has its own header row 1)
    const lines = String((req.query && req.query.header) || '') === '0' ? [] : [head.map(cell).join(',')];
    for (const m of rows) {
      lines.push([m.ref_no, karachiDate(m.created_at), m.name, m.father_name, m.cnic, m.dob, m.religion, m.education, m.designation, m.wing,
        m.residence_address, m.office_address, m.profession, phone(m.contact), m.email, m.province_id, dn.get(m.district_id) || m.district_id, m.taluka_name, cap(m.status), '', m.office_level, m.office_area].map(cell).join(','));
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end(lines.join('\r\n') + '\r\n');
  } catch (e) { return handleError(res, e, 'sheet-feed'); }
};
