'use strict';
const crypto = require('crypto');
const sb = require('../lib/sb');
const { MAX_BODY, secHeaders, send, sendError, sameOrigin, readJson, handleError } = require('../lib/http');
const { hashPassword, passwordPolicy, rateLimit, audit } = require('../lib/auth');

// Creates (or resets the password of) an administrator. Disabled unless SETUP_TOKEN is set in the
// server environment. Remove SETUP_TOKEN from Vercel once the accounts exist.
module.exports = async (req, res) => {
  secHeaders(res);
  try {
    const want = process.env.SETUP_TOKEN || '';
    if (want.length < 20) return sendError(res, 404, 'disabled', 'Setup is disabled.');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    if (!sameOrigin(req, { required: true })) return sendError(res, 403, 'forbidden', 'Request not allowed.');
    if (!(await rateLimit(req, 'setup', 3600, 8))) return sendError(res, 429, 'rate_limited', 'Too many attempts. Try again later.');

    const b = await readJson(req, MAX_BODY.default);
    const a = crypto.createHash('sha256').update(String(b.token || '')).digest();
    const z = crypto.createHash('sha256').update(want).digest();
    if (!crypto.timingSafeEqual(a, z)) return sendError(res, 403, 'forbidden', 'Invalid setup token.');

    const username = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return sendError(res, 422, 'validation_failed', 'Username: 3-40 characters, lowercase letters, digits, . _ -');
    const pwErr = passwordPolicy(b.password); if (pwErr) return sendError(res, 422, 'validation_failed', pwErr);
    const role = String(b.role || 'super_admin');
    if (!['super_admin', 'district_admin', 'data_entry'].includes(role)) return sendError(res, 422, 'validation_failed', 'Invalid role.');

    let district_id = null;
    if (role !== 'super_admin') {
      const code = String(b.district_code || '').trim().toLowerCase();
      const d = await sb.select('districts', [['code', 'eq.' + code], ['select', 'id'], ['limit', '1']], { single: true });
      if (!d.data) return sendError(res, 422, 'validation_failed', 'District code not found. Use the code from the districts table (e.g. hyderabad).');
      district_id = d.data.id;
    }
    const full_name = String(b.full_name || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 100) || null;
    const password_hash = await hashPassword(b.password);

    const existing = await sb.select('admins', [['username', 'eq.' + username], ['select', 'id'], ['limit', '1']], { single: true });
    let id;
    if (existing.data) {
      id = existing.data.id;
      await sb.update('admins', [['id', 'eq.' + id]], { password_hash, role, district_id, full_name, active: true, failed_attempts: 0, locked_until: null });
      await sb.remove('admin_sessions', [['admin_id', 'eq.' + id]]);   // sign the account out everywhere
    } else {
      const out = await sb.insert('admins', { username, password_hash, role, district_id, full_name });
      id = out[0].id;
    }
    await audit(req, { id, username }, existing.data ? 'admin_password_reset' : 'admin_created', 'admin', id, { role, district_id });
    return send(res, 200, { ok: true, message: (existing.data ? 'Administrator updated: ' : 'Administrator created: ') + username });
  } catch (e) { return handleError(res, e, 'setup'); }
};
