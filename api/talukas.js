'use strict';
const sb = require('../lib/sb');
const { secHeaders, send, sendError, handleError } = require('../lib/http');
const { toId } = require('../lib/location');

// Public, read-only: VERIFIED and active talukas of one district. GET /api/talukas?district_id=5
module.exports = async (req, res) => {
  secHeaders(res);
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    const did = toId(new URL(req.url, 'http://x').searchParams.get('district_id'));
    if (!did || Number.isNaN(did)) return sendError(res, 422, 'validation_failed', 'Invalid district.');
    const r = await sb.select('talukas', [['select', 'id,name'], ['district_id', 'eq.' + did], ['active', 'eq.true'], ['verified', 'eq.true'], ['order', 'name.asc'], ['limit', '500']]);
    return send(res, 200, { ok: true, items: r.data || [] });
  } catch (e) { return handleError(res, e, 'talukas'); }
};
