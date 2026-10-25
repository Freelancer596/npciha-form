'use strict';
const crypto = require('crypto');
const sb = require('./sb');
const { ipHash, parseCookies } = require('./http');

const COOKIE = '__Host-npciha_sid';
const SESSION_HOURS = Math.min(Math.max(parseInt(process.env.ADMIN_SESSION_HOURS || '8', 10) || 8, 1), 24);
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

// ---------- Password hashing: scrypt with random salt ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function scrypt(pw, salt) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (e, k) => e ? rej(e) : res(k)));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const k = await scrypt(pw, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), k.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(h, 'base64');
    const got = await new Promise((res, rej) => crypto.scrypt(pw, Buffer.from(s, 'base64'), want.length, { N: +N, r: +r, p: +p }, (e, k) => e ? rej(e) : res(k)));
    return crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}
// used so unknown usernames cost the same time as known ones
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

function passwordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Password is too weak.';
  return null;
}

// ---------- Sessions ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(req, adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  await sb.insert('admin_sessions', { token_hash: sha(token), admin_id: adminId, expires_at: expires, ip_hash: ipHash(req) });
  const cookie = `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
  return { cookie };
}
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

async function currentAdmin(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t || t.length < 20 || t.length > 100) return null;
  const { data: s } = await sb.select('admin_sessions', [['token_hash', 'eq.' + sha(t)], ['expires_at', 'gt.' + new Date().toISOString()], ['select', 'admin_id,expires_at'], ['limit', '1']], { single: true });
  if (!s) return null;
  const { data: a } = await sb.select('admins', [['id', 'eq.' + s.admin_id], ['select', 'id,username,full_name,role,district_id,active'], ['limit', '1']], { single: true });
  if (!a || !a.active) return null;
  a.tokenHash = sha(t);
  return a;
}
async function destroySession(tokenHash) { await sb.remove('admin_sessions', [['token_hash', 'eq.' + tokenHash]]); }

// ---------- Rate limiting (database-backed so it works across serverless instances) ----------
async function rateLimit(req, bucket, windowSeconds, max) {
  const key = bucket + ':' + ipHash(req);
  const ok = await sb.rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  return ok === true;
}

// ---------- Audit log (never put full CNIC / secrets in detail) ----------
async function audit(req, admin, action, targetType, targetId, detail) {
  try {
    await sb.insert('audit_log', {
      admin_id: admin ? admin.id : null, admin_username: admin ? admin.username : null,
      action, target_type: targetType || null, target_id: targetId ? String(targetId) : null,
      detail: detail || null, ip_hash: req ? ipHash(req) : null,
    });
  } catch (e) { console.error('[audit] could not write audit entry (' + action + ')'); }
}

// ---------- Role-based access control ----------
const PERMS = {
  super_admin:    { all_districts: true,  cnic_full: true,  cnic_search: true,  edit: true, status: true,  remove: true,  export: true,  audit: true,  reassign: true  },
  district_admin: { all_districts: false, cnic_full: true,  cnic_search: true,  edit: true, status: true,  remove: false, export: true,  audit: false, reassign: false },
  data_entry:     { all_districts: false, cnic_full: false, cnic_search: false, edit: true, status: false, remove: false, export: false, audit: false, reassign: false },
};
const can = (admin, p) => !!(admin && PERMS[admin.role] && PERMS[admin.role][p]);

module.exports = { COOKIE, hashPassword, verifyPassword, DUMMY, passwordPolicy, createSession, clearCookie, currentAdmin, destroySession, rateLimit, audit, can, PERMS, MAX_FAILS, LOCK_MINUTES, sha };
