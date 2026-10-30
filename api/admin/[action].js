'use strict';
// All administrator endpoints live in this single function (keeps the project within Vercel's
// free-plan function limit):  /api/admin/<action>
const sb = require('../../lib/sb');
const { MAX_BODY, secHeaders, send, sendError, sameOrigin, readJson, handleError, ipHash } = require('../../lib/http');
const A = require('../../lib/auth');
const { validateEdit, maskCnic, normCnic } = require('../../lib/validate');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['pending', 'approved', 'rejected'];
const LIST_COLS = 'id,ref_no,name,cnic,contact,district_id,taluka_id,status,created_at';
const FULL_COLS = 'id,ref_no,name,father_name,cnic,dob,religion,education,designation,office_level,office_area,wing,residence_address,office_address,profession,contact,email,photo_path,district_id,taluka_id,status,status_note,reviewed_by,reviewed_at,created_at,updated_at';
const EXPORT_MAX = 20000;
const DENIED = (res, msg) => sendError(res, 403, 'access_denied', msg || 'You do not have permission to do this.');

// ---------- helpers ----------
const int = (v, d, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d; };
const safeSearch = s => String(s || '').normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s\-\/.']/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);

// Applies the admin's role scope + the requested filters. Returns [[k,v],...] for PostgREST.
function memberFilters(admin, q) {
  const f = [];
  if (!A.can(admin, 'all_districts')) f.push(['district_id', 'eq.' + admin.district_id]);
  else if (q.district_id === 'none') f.push(['district_id', 'is.null']);
  else if (/^\d+$/.test(q.district_id || '')) f.push(['district_id', 'eq.' + q.district_id]);
  if (/^\d+$/.test(q.taluka_id || '')) f.push(['taluka_id', 'eq.' + q.taluka_id]);
  if (STATUSES.includes(q.status)) f.push(['status', 'eq.' + q.status]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.date_from || '')) f.push(['created_at', 'gte.' + q.date_from + 'T00:00:00+05:00']);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.date_to || '')) f.push(['created_at', 'lte.' + q.date_to + 'T23:59:59+05:00']);
  const s = safeSearch(q.q);
  if (s) {
    const parts = ['name.ilike.*' + s + '*', 'ref_no.ilike.*' + s + '*'];
    // CNIC search is allowed for authorised roles only
    if (A.can(admin, 'cnic_search') && /^[0-9-]{4,15}$/.test(s)) parts.push('cnic.ilike.*' + s + '*');
    f.push(['or', '(' + parts.join(',') + ')']);
  }
  return f;
}

const shapeRow = (admin, m) => Object.assign({}, m, { cnic: A.can(admin, 'cnic_full') ? m.cnic : maskCnic(m.cnic) });

async function loadMember(admin, id) {
  const q = [['id', 'eq.' + id], ['select', FULL_COLS], ['limit', '1']];
  if (!A.can(admin, 'all_districts')) q.splice(1, 0, ['district_id', 'eq.' + admin.district_id]);
  return (await sb.select('members', q, { single: true })).data;
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function geo() {
  const [d, t] = await Promise.all([
    sb.select('districts', [['select', 'id,code,name,name_ur,active'], ['order', 'name.asc'], ['limit', '500']]),
    sb.select('talukas', [['select', 'id,district_id,name,name_ur,active'], ['order', 'name.asc'], ['limit', '5000']]),
  ]);
  return { districts: d.data, talukas: t.data };
}

// ---------- handlers ----------
const H = {};

H.login = async (req, res) => {
  if (!(await A.rateLimit(req, 'login', 900, 12))) { res.setHeader('Retry-After', '900'); return sendError(res, 429, 'rate_limited', 'Too many login attempts. Please wait 15 minutes.'); }
  const b = await readJson(req, MAX_BODY.default);
  const username = String(b.username || '').trim().toLowerCase().slice(0, 40);
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const generic = () => sendError(res, 401, 'invalid_credentials', 'Invalid username or password, or the account is temporarily locked.');
  if (!username || !password) return generic();

  const { data: a } = await sb.select('admins', [['username', 'eq.' + username], ['select', 'id,username,full_name,role,district_id,active,password_hash,failed_attempts,locked_until'], ['limit', '1']], { single: true });
  const locked = a && a.locked_until && new Date(a.locked_until) > new Date();
  const ok = await A.verifyPassword(password, a ? a.password_hash : A.DUMMY);
  if (!a || !a.active || locked || !ok) {
    if (a && a.active && !locked) {
      const fails = (a.failed_attempts || 0) + 1;
      const patch = fails >= A.MAX_FAILS ? { failed_attempts: 0, locked_until: new Date(Date.now() + A.LOCK_MINUTES * 60000).toISOString() } : { failed_attempts: fails };
      await sb.update('admins', [['id', 'eq.' + a.id]], patch);
    }
    await A.audit(req, a ? { id: a.id, username: a.username } : null, 'login_failed', 'admin', a ? a.id : null, { known_user: !!a, locked: !!locked });
    return generic();
  }
  await sb.update('admins', [['id', 'eq.' + a.id]], { failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() });
  const s = await A.createSession(req, a.id);
  res.setHeader('Set-Cookie', s.cookie);
  await A.audit(req, a, 'login', 'admin', a.id);
  return send(res, 200, { ok: true, user: { username: a.username, full_name: a.full_name, role: a.role, district_id: a.district_id } });
};

H.logout = async (req, res, admin) => {
  await A.destroySession(admin.tokenHash);
  res.setHeader('Set-Cookie', A.clearCookie());
  await A.audit(req, admin, 'logout', 'admin', admin.id);
  return send(res, 200, { ok: true });
};

H.me = async (req, res, admin) => send(res, 200, {
  ok: true, user: { username: admin.username, full_name: admin.full_name, role: admin.role, district_id: admin.district_id },
  can: { cnic_search: A.can(admin, 'cnic_search'), status: A.can(admin, 'status'), remove: A.can(admin, 'remove'), export: A.can(admin, 'export'), audit: A.can(admin, 'audit'), reassign: A.can(admin, 'reassign'), all_districts: A.can(admin, 'all_districts'), cnic_full: A.can(admin, 'cnic_full') },
});

H.districts = async (req, res, admin) => {
  const g = await geo();
  if (!A.can(admin, 'all_districts')) { g.districts = g.districts.filter(d => d.id === admin.district_id); g.talukas = g.talukas.filter(t => t.district_id === admin.district_id); }
  return send(res, 200, { ok: true, ...g });
};

H.members = async (req, res, admin) => {
  const limit = int(req.query.limit, 25, 1, 100), offset = int(req.query.offset, 0, 0, 1000000);
  const q = [...memberFilters(admin, req.query), ['select', LIST_COLS], ['order', 'created_at.desc'], ['limit', String(limit)], ['offset', String(offset)]];
  const r = await sb.select('members', q, { count: true });
  return send(res, 200, { ok: true, total: r.count, limit, offset, members: r.data.map(m => shapeRow(admin, m)) });
};

H.member = async (req, res, admin) => {
  const id = String(req.query.id || '');
  if (!UUID.test(id)) return sendError(res, 400, 'bad_request', 'Invalid member id.');
  const m = await loadMember(admin, id);
  if (!m) return sendError(res, 404, 'not_found', 'Member not found.');

  if (req.method === 'GET') {
    let photo = null;
    if (m.photo_path) { const buf = await sb.getObject(m.photo_path); if (buf) photo = 'data:image/jpeg;base64,' + buf.toString('base64'); }
    await A.audit(req, admin, 'view_member', 'member', m.id, { ref: m.ref_no });
    const { photo_path, ...rest } = shapeRow(admin, m);
    return send(res, 200, { ok: true, member: rest, photo });
  }

  if (req.method === 'PATCH') {
    if (!A.can(admin, 'edit')) return DENIED(res);
    const b = await readJson(req, MAX_BODY.default);
    if ('cnic' in b && !A.can(admin, 'cnic_full')) return DENIED(res, 'You may not change the CNIC.');
    if ('district_id' in b && !A.can(admin, 'reassign')) return DENIED(res, 'Only a Super Admin can change a member\'s district.');
    const v = validateEdit(b);
    if (!v.ok) return sendError(res, 422, 'validation_failed', Object.keys(v.errors).length ? 'Please correct the highlighted information.' : 'Nothing to update.', { fields: v.errors });
    const patch = v.patch;

    const finalDistrict = 'district_id' in patch ? patch.district_id : m.district_id;
    if ('district_id' in patch && patch.district_id !== null) {
      const d = await sb.select('districts', [['id', 'eq.' + patch.district_id], ['select', 'id'], ['limit', '1']], { single: true });
      if (!d.data) return sendError(res, 422, 'validation_failed', 'District not found.', { fields: { district_id: 'District not found.' } });
    }
    if ('district_id' in patch && patch.district_id !== m.district_id && !('taluka_id' in patch)) patch.taluka_id = null;
    if (patch.taluka_id) {
      const t = await sb.select('talukas', [['id', 'eq.' + patch.taluka_id], ['district_id', 'eq.' + (finalDistrict === null ? -1 : finalDistrict)], ['select', 'id'], ['limit', '1']], { single: true });
      if (!t.data) return sendError(res, 422, 'validation_failed', 'That taluka does not belong to the member\'s district.', { fields: { taluka_id: 'Taluka does not belong to the district.' } });
    }
    let out;
    try { out = await sb.update('members', [['id', 'eq.' + m.id]], patch); }
    catch (e) { if (e.kind === 'db' && e.code === '23505') return sendError(res, 409, 'duplicate_cnic', 'Another member already has this CNIC.'); throw e; }
    if (!out.length) return sendError(res, 404, 'not_found', 'Member not found.');
    const changed = Object.keys(patch); // field names only; values (CNIC etc.) are not logged
    await A.audit(req, admin, 'update_member', 'member', m.id, { ref: m.ref_no, fields: changed });
    return send(res, 200, { ok: true, updated: changed });
  }

  if (req.method === 'DELETE') {
    if (!A.can(admin, 'remove')) return DENIED(res);
    const b = await readJson(req, MAX_BODY.default);
    if (b.confirm !== 'DELETE') return sendError(res, 400, 'confirmation_required', 'Deleting requires explicit confirmation.');
    await sb.remove('members', [['id', 'eq.' + m.id]]);
    if (m.photo_path) { try { await sb.deleteObject(m.photo_path); } catch (e) { console.error('[admin] photo delete failed for a removed member'); } }
    await A.audit(req, admin, 'delete_member', 'member', m.id, { ref: m.ref_no, cnic: maskCnic(m.cnic), status: m.status });
    return send(res, 200, { ok: true });
  }
  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
};

H.status = async (req, res, admin) => {
  if (!A.can(admin, 'status')) return DENIED(res, 'You may not approve or reject registrations.');
  const b = await readJson(req, MAX_BODY.default);
  const id = String(b.id || '');
  if (!UUID.test(id) || !STATUSES.includes(b.status)) return sendError(res, 400, 'bad_request', 'Invalid request.');
  const m = await loadMember(admin, id);
  if (!m) return sendError(res, 404, 'not_found', 'Member not found.');
  const note = String(b.note || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 300) || null;
  await sb.update('members', [['id', 'eq.' + m.id]], { status: b.status, status_note: note, reviewed_by: admin.username, reviewed_at: new Date().toISOString() });
  await A.audit(req, admin, 'set_status', 'member', m.id, { ref: m.ref_no, from: m.status, to: b.status });
  return send(res, 200, { ok: true, status: b.status });
};

H.summary = async (req, res, admin) => {
  const rows = await sb.rpc('admin_summary', { p_district_id: A.can(admin, 'all_districts') ? null : admin.district_id });
  const g = await geo();
  const names = new Map(g.districts.map(d => [d.id, d.name]));
  const by = new Map(); const totals = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    const k = r.district_id === null ? 'none' : r.district_id;
    if (!by.has(k)) by.set(k, { district_id: r.district_id, district: r.district_id === null ? 'Unassigned' : (names.get(r.district_id) || 'Unknown'), pending: 0, approved: 0, rejected: 0, total: 0 });
    const o = by.get(k); const n = Number(r.n); o[r.status] += n; o.total += n; totals[r.status] += n; totals.total += n;
  }
  return send(res, 200, { ok: true, totals, districts: [...by.values()].sort((a, b) => b.total - a.total) });
};

H.audit = async (req, res, admin) => {
  if (!A.can(admin, 'audit')) return DENIED(res);
  const limit = int(req.query.limit, 50, 1, 200), offset = int(req.query.offset, 0, 0, 100000);
  const r = await sb.select('audit_log', [['select', 'id,at,admin_username,action,target_type,target_id,detail'], ['order', 'at.desc'], ['limit', String(limit)], ['offset', String(offset)]], { count: true });
  return send(res, 200, { ok: true, total: r.count, entries: r.data });
};

H.export = async (req, res, admin) => {
  if (!A.can(admin, 'export')) return DENIED(res, 'You may not export records.');
  const g = await geo();
  const dn = new Map(g.districts.map(d => [d.id, d.name])), tn = new Map(g.talukas.map(t => [t.id, t.name]));
  const filters = memberFilters(admin, req.query);
  const rows = []; let off = 0;
  while (rows.length < EXPORT_MAX) {
    const r = await sb.select('members', [...filters, ['select', FULL_COLS.replace('photo_path,', '')], ['order', 'created_at.asc'], ['limit', '1000'], ['offset', String(off)]]);
    rows.push(...r.data); if (r.data.length < 1000) break; off += 1000;
  }
  const head = ['Reference No', 'Name', 'Father Name', 'CNIC', 'Date of Birth', 'Religion', 'Education', 'Designation', 'Office Level', 'Office Area', 'Wing', 'Residence Address', 'Office Address', 'Profession', 'Contact', 'Email', 'District', 'Taluka', 'Status', 'Registered'];
  const lines = [head.join(',')];
  for (const m of rows.slice(0, EXPORT_MAX)) {
    lines.push([m.ref_no, m.name, m.father_name, shapeRow(admin, m).cnic, m.dob, m.religion, m.education, m.designation, m.office_level, m.office_area, m.wing, m.residence_address, m.office_address, m.profession, m.contact, m.email, dn.get(m.district_id) || '', tn.get(m.taluka_id) || '', m.status, m.created_at].map(csvCell).join(','));
  }
  await A.audit(req, admin, 'export_csv', 'members', null, { rows: Math.min(rows.length, EXPORT_MAX), filters: Object.fromEntries(['district_id', 'taluka_id', 'status', 'date_from', 'date_to'].filter(k => req.query[k]).map(k => [k, req.query[k]])) });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="npciha-members.csv"');
  res.end('\uFEFF' + lines.join('\r\n') + '\r\n');
};

// Sends existing members to the Google Sheet in batches (direct Sheets API first, Apps Script webhook as fallback).
// Refs already in column A are skipped, so pressing the button twice never creates duplicates.
H.sheetsync = async (req, res, admin) => {
  if (!A.can(admin, 'export') || !A.can(admin, 'cnic_full') || !A.can(admin, 'all_districts')) return DENIED(res, 'You may not send records to Google Sheets.');
  const gs = require('../../lib/google-sheets');
  let directOk = false;
  try { directOk = !!gs.directConfig(); } catch (e) { return sendError(res, 409, 'sheets_not_configured', 'GOOGLE_SERVICE_ACCOUNT_JSON in Vercel is not valid (' + String(e.message).slice(0, 50) + ').'); }
  if (!directOk && (!(process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim() || !(process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim())) {
    return sendError(res, 409, 'sheets_not_configured', 'Google Sheet connection is not set up yet (service account JSON + sheet ID, or webhook URL + secret, missing in Vercel).');
  }
  const body = await readJson(req, 2000).catch(() => ({}));
  const offset = int(body && body.offset, 0, 0, 1000000), BATCH = 80;
  const r = await sb.select('members', [['select', 'ref_no,created_at,name,father_name,cnic,dob,religion,education,designation,office_level,office_area,wing,residence_address,office_address,profession,contact,email,province_id,district_id,taluka_name,status'], ['order', 'created_at.asc'], ['limit', String(BATCH)], ['offset', String(offset)]]);
  const fmtDate = iso => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(iso)); const g = t => p.find(x => x.type === t).value; return +g('day') + '-' + +g('month') + '-' + g('year'); };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Pending';
  const pn = new Map(), dn = new Map();
  try { (await sb.select('provinces', [['select', 'id,name'], ['limit', '50']])).data.forEach(x => pn.set(x.id, x.name)); } catch (e) { /* ids are used instead */ }
  try { (await sb.select('districts', [['select', 'id,name'], ['limit', '500']])).data.forEach(x => dn.set(x.id, x.name)); } catch (e) { /* ids are used instead */ }
  const rows = r.data.map(m => [m.ref_no || '', fmtDate(m.created_at), m.name || '', m.father_name || '', m.cnic || '', m.dob || '', m.religion || '', m.education || '', m.designation || '', m.wing || '', m.residence_address || '', m.office_address || '', m.profession || '', m.contact || '', m.email || '', pn.get(m.province_id) || m.province_id || '', dn.get(m.district_id) || m.district_id || '', m.taluka_name || '', cap(m.status), '', require('../../lib/google-sheets').capLevel(m.office_level), m.office_area || '']);
  let out = { added: 0, skipped: 0 };
  if (rows.length) {
    try { out = await gs.appendBatch(rows); }
    catch (e) {
      const m = String((e && e.message) || e), who = e && e.serviceAccount ? ' Share the sheet (Editor) with ' + e.serviceAccount + '.' : '';
      const hint = /http_40[34]/.test(m) ? 'Google refused access to the sheet.' + who : /http_404/.test(m) ? 'Sheet or tab not found. Check the sheet ID and tab name in Vercel.' : 'Google Sheet did not accept the data.';
      return sendError(res, 502, 'sheets_failed', hint + ' (' + m.slice(0, 90) + ')');
    }
  }
  const done = r.data.length < BATCH;
  if (done) await A.audit(req, admin, 'sheets_sync', 'members', null, { total_sent: offset + r.data.length });
  return send(res, 200, { ok: true, sent: r.data.length, added: out.added, skipped: out.skipped, next_offset: offset + r.data.length, done });
};

// action -> { methods, public?, mutating? }
const ROUTES = {
  login: { methods: ['POST'], pub: true, mutating: true }, logout: { methods: ['POST'], mutating: true },
  me: { methods: ['GET'] }, districts: { methods: ['GET'] }, members: { methods: ['GET'] },
  member: { methods: ['GET', 'PATCH', 'DELETE'], mutating: false }, status: { methods: ['POST'], mutating: true },
  summary: { methods: ['GET'] }, audit: { methods: ['GET'] }, export: { methods: ['GET'] }, sheetsync: { methods: ['POST'], mutating: true },
};

module.exports = async (req, res) => {
  secHeaders(res);
  try {
    const name = String((req.query && req.query.action) || '');
    const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
    if (!route) return sendError(res, 404, 'not_found', 'Not found.');
    if (!route.methods.includes(req.method)) { res.setHeader('Allow', route.methods.join(', ')); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    const changes = req.method !== 'GET';
    if (changes && !sameOrigin(req, { required: true })) return sendError(res, 403, 'forbidden', 'Request not allowed.');
    if (req.headers['x-requested-with'] !== 'npciha') return sendError(res, 403, 'forbidden', 'Request not allowed.');

    if (route.pub) return await H[name](req, res, null);
    const admin = await A.currentAdmin(req);
    if (!admin) { res.setHeader('Set-Cookie', A.clearCookie()); return sendError(res, 401, 'unauthenticated', 'Please sign in.'); }
    return await H[name](req, res, admin);
  } catch (e) { return handleError(res, e, 'admin'); }
};
