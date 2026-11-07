'use strict';
// Shows ONE member photo, for the Google Sheet:  =IMAGE("https://<site>/api/photo?p=members/<uuid>.jpg")
// The storage bucket stays private. The file name is a random UUID (not guessable, nothing can be listed),
// and only that exact "members/<uuid>.jpg" shape is accepted, so no other file or folder can be requested.
const sb = require('../lib/sb');
const { secHeaders, sendError, handleError } = require('../lib/http');

const PHOTO_PATH = /^members\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;

module.exports = async (req, res) => {
  secHeaders(res);
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    const p = String((req.query && req.query.p) || '');
    if (!PHOTO_PATH.test(p)) return sendError(res, 404, 'not_found', 'Not found.');
    const buf = await sb.getObject(p);
    if (!buf) return sendError(res, 404, 'not_found', 'Not found.');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch (e) { return handleError(res, e, 'photo'); }
};
