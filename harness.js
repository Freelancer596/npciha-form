'use strict';
// Runs the REAL api/*.js handlers behind a small Vercel-style adapter, plus the static site (with the
// same security headers as vercel.json), pointed at the in-memory mock Supabase.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const HEADERS = vj.headers[0].headers;
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain', '.js': 'text/javascript', '.css': 'text/css' };

function start({ mockUrl, port = 0 }) {
  process.env.SUPABASE_URL = mockUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = require('./mock-supabase').KEY;
  process.env.APP_SECRET = 'test-app-secret-test-app-secret-1234';
  process.env.SETUP_TOKEN = 'test-setup-token-0123456789';
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    HEADERS.forEach(h => res.setHeader(h.key, h.value));
    if (u.pathname.startsWith('/api/')) {
      const parts = u.pathname.slice(5).split('/').filter(Boolean);
      let file, query = Object.fromEntries(u.searchParams);
      if (parts[0] === 'admin' && parts.length === 2) { file = path.join(ROOT, 'api/admin/[action].js'); query.action = parts[1]; }
      else if (parts.length === 1 && fs.existsSync(path.join(ROOT, 'api', parts[0] + '.js'))) file = path.join(ROOT, 'api', parts[0] + '.js');
      if (!file) { res.statusCode = 404; return res.end('{"ok":false,"error":"not_found"}'); }
      req.query = query;
      const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) { const c = []; for await (const d of req) c.push(d); const raw = Buffer.concat(c).toString(); try { req.body = JSON.parse(raw); } catch (e) { req.body = raw; } }
      return require(file)(req, res);
    }
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (!path.extname(p)) p += '.html';
    const f = path.join(ROOT, 'public', path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
    if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}
module.exports = { start };
