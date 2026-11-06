'use strict';
// Private CSV feed of all registrations for Google Sheets:  =IMPORTDATA("https://<site>/api/sheet-feed?key=<token>")
// Protected by SHEET_FEED_TOKEN (Vercel env var). Without the right key it answers 404 like any unknown page.
const crypto = require('crypto');
const { secHeaders, sendError, handleError } = require('../lib/http');
const { loadSheetRows } = require('../lib/google-sheets');

const h = x => crypto.createHash('sha256').update(String(x)).digest();

// CSV cell: quote, double inner quotes, and neutralise spreadsheet formulas (=,+,-,@) in user-typed text.
function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^\+?\d[\d\- ]*$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
module.exports = async (req, res) => {
  secHeaders(res);
  try {
    const need = (process.env.SHEET_FEED_TOKEN || '').trim();
    const given = String((req.query && req.query.key) || '').trim();
    if (req.method !== 'GET' || need.length < 24 || !given || !crypto.timingSafeEqual(h(given), h(need))) {
      return sendError(res, 404, 'not_found', 'Not found.');
    }
    const { headers, rows } = await loadSheetRows();
    // header=0 -> data rows only (use when the sheet already has its own header row 1)
    const lines = String((req.query && req.query.header) || '') === '0' ? [] : [headers.map(cell).join(',')];
    for (const row of rows) lines.push(row.map(cell).join(','));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end(lines.join('\r\n') + '\r\n');
  } catch (e) { return handleError(res, e, 'sheet-feed'); }
};
