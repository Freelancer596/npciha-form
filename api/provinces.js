'use strict';
const sb = require('../lib/sb');
const { secHeaders, send, sendError, handleError } = require('../lib/http');

// Public, read-only: active provinces only.
module.exports = async (req, res) => {
  secHeaders(res);
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    const r = await sb.select('provinces', [['select', 'id,code,name'], ['active', 'eq.true'], ['order', 'name.asc']]);
    return send(res, 200, { ok: true, items: r.data || [] });
  } catch (e) { return handleError(res, e, 'provinces'); }
};
