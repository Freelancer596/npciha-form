'use strict';
// In-memory MOCK of the Supabase REST + Storage calls used by this app (for offline tests only).
// It is NOT Supabase and does not run the SQL files; it emulates the behaviour the API code relies on.
const http = require('http');
const crypto = require('crypto');

const KEY = 'test-service-role-key';
const state = { t: {}, files: new Map(), seq: 0, rate: new Map(), fail: null };
function reset() {
  state.t = { provinces: [{ id: 1, code: 'sindh', name: 'Sindh', active: true }], districts: [], talukas: [], members: [], admins: [], admin_sessions: [], audit_log: [] };
  state.files.clear(); state.seq = 0; state.rate.clear(); state.fail = null;
  const names = ['Hyderabad', 'Sukkur', 'Larkana'];
  names.forEach((n, i) => state.t.districts.push({ id: i + 1, province_id: 1, code: n.toLowerCase(), name: n, name_ur: null, active: true }));
  state.t.districts.push({ id: 4, province_id: 1, code: 'karachi-central', name: 'Karachi Central', name_ur: null, active: true }); // no talukas (towns, not talukas)
  state.t.talukas.push(
    { id: 1, district_id: 1, name: 'Latifabad', name_ur: null, active: true, verified: true, source: 'test' },
    { id: 2, district_id: 1, name: 'Qasimabad', name_ur: null, active: true, verified: true, source: 'test' },
    { id: 3, district_id: 2, name: 'Rohri', name_ur: null, active: true, verified: true, source: 'test' },
    { id: 4, district_id: 1, name: 'Unverifiedtown', name_ur: null, active: true, verified: false, source: 'test' });
}
reset();

const UNIQUE = { members: [['cnic', 'members_cnic_key'], ['ref_no', 'members_ref_no_key'], ['submission_token', 'members_submission_token_key']], admins: [['username', 'admins_username_key']], districts: [['code', 'districts_code_key']] };
const CHECKS = {
  members: r => (/^[0-9]{5}-[0-9]{7}-[0-9]$/.test(r.cnic) && /^03[0-9]{9}$/.test(r.contact) && ['pending', 'approved', 'rejected'].includes(r.status)) || 'members_check',
};
const cmp = (row, k, op, val) => {
  const a = row[k];
  if (op === 'is') return val === 'null' ? a === null || a === undefined : a !== null;
  if (op === 'eq') return String(a) === val;
  if (op === 'neq') return String(a) !== val;
  if (op === 'in') return val.replace(/[()]/g, '').split(',').includes(String(a));
  if (op === 'ilike') { const re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'); return a != null && re.test(String(a)); }
  const A = (k.endsWith('_at')) ? new Date(a).getTime() : a, B = (k.endsWith('_at')) ? new Date(val).getTime() : val;
  if (op === 'gt') return A > B; if (op === 'gte') return A >= B; if (op === 'lt') return A < B; if (op === 'lte') return A <= B;
  throw new Error('mock: unsupported op ' + op);
};
const splitTop = s => { const o = []; let d = 0, c = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
function matcher(params) {
  const conds = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (k === 'or') { const parts = splitTop(v.slice(1, -1)).map(p => { const [c, op, ...rest] = p.split('.'); return [c, op, rest.join('.')]; }); conds.push(r => parts.some(([c, op, val]) => cmp(r, c, op, val))); continue; }
    const i = v.indexOf('.'); const op = v.slice(0, i), val = v.slice(i + 1);
    conds.push(r => cmp(r, k, op, val));
  }
  return r => conds.every(f => f(r));
}
const pick = (r, sel) => { if (!sel) return r; const cols = sel.split(','); const o = {}; cols.forEach(c => { o[c] = r[c] === undefined ? null : r[c]; }); return o; };
function defaults(table, r) {
  const now = new Date().toISOString();
  if (table === 'members') {
    r.id = r.id || crypto.randomUUID();
    if (!r.ref_no) { state.seq++; r.ref_no = 'NPCIHA/' + new Date().getFullYear() + '/' + String(state.seq).padStart(6, '0'); }
    const given = { ...r }; // caller's values must win over these defaults
    Object.assign(r, { status: 'pending', created_at: now, updated_at: now, district_id: null, taluka_id: null, taluka_name: null, province_id: null, status_note: null, reviewed_by: null, reviewed_at: null }, given);
  }
  if (table === 'admins') Object.assign(r, { id: r.id || crypto.randomUUID(), active: true, failed_attempts: 0, locked_until: null, last_login_at: null, created_at: now }, r);
  if (table === 'admin_sessions') r.created_at = now;
  if (table === 'audit_log') { r.id = state.t.audit_log.length + 1; r.at = now; }
  return r;
}
function dbErr(res, status, code, message) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code, message })); }
function body(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__reset') { reset(); res.end('ok'); return; }
  if (u.pathname === '/__fail') { state.fail = u.searchParams.get('mode') || null; res.end('ok'); return; }
  if (u.pathname === '/__dump') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ t: state.t, files: [...state.files.keys()] })); return; }
  if (req.headers.apikey !== KEY) return dbErr(res, 401, 'PGRST301', 'Invalid API key');
  if (state.fail === 'all') return dbErr(res, 500, 'XX000', 'mock outage');
  const raw = await body(req);

  // ---- storage ----
  let m;
  if (u.pathname === '/storage/v1/bucket/member-photos') { res.end('{}'); return; }
  if ((m = /^\/storage\/v1\/object\/(?:authenticated\/)?member-photos\/(.+)$/.exec(u.pathname))) {
    const p = decodeURIComponent(m[1]);
    if (req.method === 'POST') { if (state.fail === 'storage') return dbErr(res, 500, 'x', 'mock storage down'); if (state.files.has(p)) return dbErr(res, 409, 'Duplicate', 'exists'); state.files.set(p, raw); res.end('{}'); return; }
    if (req.method === 'GET') { if (!state.files.has(p)) return dbErr(res, 404, 'not_found', 'nf'); res.setHeader('Content-Type', 'image/jpeg'); res.end(state.files.get(p)); return; }
    if (req.method === 'DELETE') { state.files.delete(p); res.end('{}'); return; }
  }

  // ---- rpc ----
  if ((m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname))) {
    const a = JSON.parse(raw.toString() || '{}'); res.setHeader('Content-Type', 'application/json');
    if (m[1] === 'rate_limit_hit') {
      const e = state.rate.get(a.p_key); const now = Date.now();
      if (!e || now - e.start > a.p_window_seconds * 1000) state.rate.set(a.p_key, { start: now, hits: 1 }); else e.hits++;
      res.end(JSON.stringify(state.rate.get(a.p_key).hits <= a.p_max)); return;
    }
    if (m[1] === 'admin_summary') {
      const g = new Map();
      state.t.members.filter(r => a.p_district_id == null || r.district_id === a.p_district_id).forEach(r => { const k = r.district_id + '|' + r.status; g.set(k, (g.get(k) || 0) + 1); });
      res.end(JSON.stringify([...g].map(([k, n]) => { const [d, s] = k.split('|'); return { district_id: d === 'null' ? null : +d, status: s, n }; }))); return;
    }
    return dbErr(res, 404, 'PGRST202', 'no such function');
  }

  // ---- tables ----
  if ((m = /^\/rest\/v1\/(\w+)$/.exec(u.pathname)) && state.t[m[1]]) {
    const table = m[1], rows = state.t[table], params = [...u.searchParams.entries()];
    const sel = u.searchParams.get('select');
    res.setHeader('Content-Type', 'application/json');
    if (state.fail === 'insert' && req.method === 'POST' && table === 'members') return dbErr(res, 500, 'XX000', 'mock insert failure');
    if (req.method === 'GET') {
      let out = rows.filter(matcher(params));
      const total = out.length;
      const ord = u.searchParams.get('order');
      if (ord) { const [c, d] = ord.split('.'); out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (d === 'desc' ? -1 : 1)); }
      const off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 1000);
      out = out.slice(off, off + lim);
      res.setHeader('Content-Range', `${off}-${off + out.length - 1}/${total}`);
      res.end(JSON.stringify(out.map(r => pick(r, sel)))); return;
    }
    if (req.method === 'POST') {
      const inc = JSON.parse(raw.toString()); const list = Array.isArray(inc) ? inc : [inc]; const made = [];
      for (const r0 of list) {
        const r = defaults(table, { ...r0 });
        for (const [col, name] of (UNIQUE[table] || [])) if (r[col] != null && rows.some(x => x[col] === r[col])) return dbErr(res, 409, '23505', `duplicate key value violates unique constraint "${name}"`);
        if (CHECKS[table]) { const ok = CHECKS[table](r); if (ok !== true) return dbErr(res, 400, '23514', `violates check constraint "${ok}"`); }
        made.push(r);
      }
      rows.push(...made); res.writeHead(201); res.end(JSON.stringify(made.map(r => pick(r, sel)))); return;
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(raw.toString()); const hit = rows.filter(matcher(params));
      for (const r of hit) {
        const next = { ...r, ...patch, updated_at: new Date().toISOString() };
        for (const [col, name] of (UNIQUE[table] || [])) if (patch[col] != null && rows.some(x => x !== r && x[col] === next[col])) return dbErr(res, 409, '23505', `duplicate key value violates unique constraint "${name}"`);
        Object.assign(r, next);
      }
      res.end(JSON.stringify(hit.map(r => pick(r, sel)))); return;
    }
    if (req.method === 'DELETE') {
      const hit = rows.filter(matcher(params)); state.t[table] = rows.filter(r => !hit.includes(r));
      res.end(JSON.stringify(hit.map(r => pick(r, sel)))); return;
    }
  }
  dbErr(res, 404, 'PGRST205', 'not found');
});

module.exports = { server, KEY, state };
