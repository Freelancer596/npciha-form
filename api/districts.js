'use strict';
const sb = require('../lib/sb');
const { secHeaders, send, sendError, handleError } = require('../lib/http');
const { toId } = require('../lib/location');

// Public, read-only: active districts of one province. GET /api/districts?province_id=1
module.exports = async (req, res) => {
  secHeaders(res);
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    const pid = toId(new URL(req.url, 'http://x').searchParams.get('province_id'));
    if (!pid || Number.isNaN(pid)) return sendError(res, 422, 'validation_failed', 'Invalid province.');
    const r = await sb.select('districts', [['select', 'id,code,name'], ['province_id', 'eq.' + pid], ['active', 'eq.true'], ['order', 'name.asc'], ['limit', '500']]);
    return send(res, 200, { ok: true, items: r.data || [] });
  } catch (e) { return handleError(res, e, 'districts'); }
};
