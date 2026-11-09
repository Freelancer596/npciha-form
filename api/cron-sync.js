'use strict';
// Daily safety net: rewrites the Google Sheet from the database so a missed sync heals itself.
// Called by Vercel Cron (vercel.json) with "Authorization: Bearer <CRON_SECRET>". Anything else gets 404.
const crypto = require('crypto');
const { secHeaders, send, sendError, handleError } = require('../lib/http');
const { syncNow } = require('../lib/google-sheets');

const h = x => crypto.createHash('sha256').update(String(x)).digest();

module.exports = async (req, res) => {
  secHeaders(res);
  try {
    const need = (process.env.CRON_SECRET || '').trim();
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (req.method !== 'GET' || need.length < 24 || !m || !crypto.timingSafeEqual(h(m[1].trim()), h(need))) {
      return sendError(res, 404, 'not_found', 'Not found.');
    }
    let r;
    try { r = await syncNow('daily'); }
    catch (e) { console.error('[cron-sync] failed:', e && e.message ? e.message : 'unknown_error'); return send(res, 502, { ok: false, error: 'sync_failed' }); }
    if (r && r.skipped) return send(res, 200, { ok: true, skipped: true });
    return send(res, 200, { ok: true, rows: r.rows, via: r.via });
  } catch (e) { return handleError(res, e, 'cron-sync'); }
};
