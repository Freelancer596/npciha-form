'use strict';
const crypto = require('crypto');

const MAX_BODY = { register: 600 * 1024, default: 64 * 1024 };

function secHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function sendError(res, status, code, message, extra) {
  send(res, status, Object.assign({ ok: false, error: code, message }, extra || {}));
}

function clientIp(req) {
  const xr = req.headers['x-real-ip'];
  if (xr) return String(xr).trim();
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function appSecret() {
  const s = process.env.APP_SECRET || '';
  if (s.length < 24) { const e = new Error('config'); e.kind = 'config'; throw e; }
  return s;
}

function ipHash(req) {
  return crypto.createHmac('sha256', appSecret()).update(clientIp(req)).digest('hex').slice(0, 32);
}

// Same-origin check for state-changing requests (CSRF defence-in-depth; cookies are also SameSite=Strict).
function sameOrigin(req, { required }) {
  const origin = req.headers.origin;
  if (!origin) return !required;
  let host;
  try { host = new URL(origin).host; } catch (e) { return false; }
  const want = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host === want;
}

async function readJson(req, limit) {
  const len = parseInt(req.headers['content-length'] || '0', 10);
  if (len > limit) { const e = new Error('too_large'); e.kind = 'too_large'; throw e; }
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw;
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) { const e = new Error('too_large'); e.kind = 'too_large'; throw e; } chunks.push(c); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { const er = new Error('bad_json'); er.kind = 'bad_json'; throw er; }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Map any thrown error to a safe, generic response (no internals exposed).
function handleError(res, e, ctx) {
  if (e && e.kind === 'too_large') return sendError(res, 413, 'too_large', 'The submitted data is too large.');
  if (e && e.kind === 'bad_json') return sendError(res, 400, 'bad_request', 'The request could not be read.');
  if (e && e.kind === 'config') {
    console.error('[' + ctx + '] server configuration incomplete');
    return sendError(res, 503, 'not_configured', 'The service is not configured yet. Please contact the administrator.');
  }
  if (e && (e.kind === 'network' || e.kind === 'db')) {
    console.error('[' + ctx + '] database error kind=' + e.kind + ' status=' + (e.status || '-') + ' code=' + (e.code || '-'));
    return sendError(res, 503, 'database_unavailable', 'The database is temporarily unavailable. Nothing was lost on your device; please try again shortly.');
  }
  console.error('[' + ctx + '] unexpected error: ' + (e && e.name));
  return sendError(res, 500, 'server_error', 'Something went wrong. Please try again.');
}

module.exports = { MAX_BODY, secHeaders, send, sendError, clientIp, ipHash, sameOrigin, readJson, parseCookies, handleError };
