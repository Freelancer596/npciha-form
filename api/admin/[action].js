'use strict';
// All administrator endpoints live in this single function (keeps the project within Vercel's
// free-plan function limit):  /api/admin/<action>
const crypto = require('crypto');
const sb = require('../../lib/sb');
const { MAX_BODY, secHeaders, send, sendError, sameOrigin, readJson, handleError, ipHash } = require('../../lib/http');
const A = require('../../lib/auth');
const { validateEdit, validatePhoto, maskCnic, normCnic } = require('../../lib/validate');
const { syncAll } = require('../../lib/google-sheets');
const { buildWorkbook } = require('../../lib/xlsx');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['pending', 'approved', 'rejected'];
const LEVELS = ['provincial', 'district', 'taluka', 'city', 'member'];
const LIST_COLS = 'id,ref_no,name,cnic,contact,designation,wing,office_level,district_id,taluka_id,taluka_name,province_id,status,created_at';
const FULL_COLS = 'id,ref_no,name,father_name,cnic,dob,religion,education,designation,office_level,office_area,wing,residence_address,office_address,profession,contact,email,photo_path,district_id,taluka_id,taluka_name,province_id,status,status_note,reviewed_by,reviewed_at,created_at,updated_at';
const DENIED = (res, msg) => sendError(res, 403, 'access_denied', msg || 'You do not have permission to do this.');

const EXPORT_MAX = 5000;   // an export never exceeds this; a bigger selection is refused, never cut short
const SCAN_MAX = 20000;    // safety cap when a taluka has to be matched by its typed name
const FILTER_KEYS = ['q', 'name', 'cnic', 'mobile', 'ref', 'province_id', 'district_id', 'taluka_id', 'office_level', 'designation', 'wing', 'status', 'date_from', 'date_to'];
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const LEVEL_LABEL = { provincial: 'Provincial', district: 'District', taluka: 'Taluka', city: 'City', member: 'Member' };
const EXPORT_HEAD = ['Serial No.', 'Application No.', 'Application Date', 'Status', 'Member Name', 'Father Name', 'CNIC', 'Mobile', 'E-mail',
  'Date of Birth', 'Religion', 'Education', 'Designation', 'Wing', 'Office Level', 'Office Area', 'Province', 'District', 'Taluka',
  'Residence Address', 'Office Address', 'Profession', 'Reviewed By', 'Reviewed At', 'Status Note'];
const EXPORT_WIDTHS = [8, 20, 14, 11, 24, 22, 20, 14, 24, 13, 11, 14, 16, 8, 14, 16, 12, 16, 18, 40, 40, 22, 16, 18, 28];

// ---------- helpers ----------
const int = (v, d, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d; };
const txt = (v, max) => String(v == null ? '' : v).normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeSearch = s => txt(s, 60).replace(/[^\p{L}\p{M}\p{N}\s\-\/.']/gu, '').replace(/\s+/g, ' ').trim();
const onlyDigits = s => String(s == null ? '' : s).replace(/\D/g, '');
const idOk = v => /^\d{1,9}$/.test(String(v == null ? '' : v));

// A mobile number typed as 03001234567, 0300-1234567, +923001234567 or 00923001234567 -> 0300... digits.
function mobileNeedle(v) {
  let d = onlyDigits(v);
  if (d.startsWith('0092')) d = '0' + d.slice(4);
  else if (d.startsWith('92') && d.length >= 12) d = '0' + d.slice(2);
  return d;
}

// Comparison key for taluka names typed by people: ignores case, spaces, punctuation, Arabic
// diacritics and a leading "Taluka"/"Tehsil", so "Kandh Kot", "KANDHKOT" and "Taluka Kashmore" match
// the taluka rows "Kandhkot" and "Kashmore".
const normName = s => String(s || '').normalize('NFKD').replace(/[ً-ٰ]/g, '').toLowerCase()
  .replace(/[^a-z0-9؀-ۿ]/g, '')
  .replace(/^(taluka|tehsil|tahsil)/, '');

const ymd = iso => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : '');
const ymdTime = iso => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(',', '') : '');

// Validates the search boxes. Returns an English message for the admin, or null when all is fine.
function checkSearch(q) {
  if (q.q && safeSearch(q.q).length < 2) return 'Type at least 2 characters to search.';
  if (q.name && safeSearch(q.name).length < 2) return 'Type at least 2 letters of the member name.';
  if (q.ref && txt(q.ref, 40).length < 3) return 'Type at least 3 characters of the application number.';
  if (q.cnic && onlyDigits(q.cnic).length < 4) return 'Type at least 4 digits of the CNIC.';
  if (q.mobile && mobileNeedle(q.mobile).length < 7) return 'Type at least 7 digits of the mobile number.';
  return null;
}

// Applies the admin's role scope + every requested filter (all filters are combined with AND).
function memberFilters(admin, q) {
  const f = [];
  if (!A.can(admin, 'all_districts')) f.push(['district_id', 'eq.' + admin.district_id]);
  else if (q.district_id === 'none') f.push(['district_id', 'is.null']);
  else if (idOk(q.district_id)) f.push(['district_id', 'eq.' + q.district_id]);
  if (idOk(q.province_id)) f.push(['province_id', 'eq.' + q.province_id]);
  if (LEVELS.includes(q.office_level)) f.push(['office_level', 'eq.' + q.office_level]);
  const des = txt(q.designation, 100); if (des) f.push(['designation', 'eq.' + des]);
  const wing = txt(q.wing, 50); if (wing) f.push(['wing', 'eq.' + wing]);
  if (STATUSES.includes(q.status)) f.push(['status', 'eq.' + q.status]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.date_from || '')) f.push(['created_at', 'gte.' + q.date_from + 'T00:00:00+05:00']);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.date_to || '')) f.push(['created_at', 'lte.' + q.date_to + 'T23:59:59+05:00']);

  // Search boxes: each box narrows the list further.
  const name = safeSearch(q.name); if (name) f.push(['name', 'ilike.*' + name + '*']);
  const ref = txt(q.ref, 40).replace(/[^\p{L}\p{N}\/\-.]/gu, ''); if (ref) f.push(['ref_no', 'ilike.*' + ref + '*']);
  if (q.mobile) { const m = mobileNeedle(q.mobile); if (m) f.push(['contact', 'ilike.*' + m + '*']); }
  const cn = txt(q.cnic, 20);
  if (cn) {
    // CNIC search is for authorised roles only. For anyone else this box matches nothing.
    if (!A.can(admin, 'cnic_search') || !/^[0-9-]+$/.test(cn)) f.push(['id', 'is.null']);
    else if (onlyDigits(cn).length === 13) f.push(['cnic', 'eq.' + normCnic(cn)]);
    else f.push(['cnic', 'ilike.*' + cn + '*']);
  }

  // Older one-box search (name, application no. or CNIC), kept so existing links keep working.
  const s = safeSearch(q.q);
  if (s) {
    const parts = ['name.ilike.*' + s + '*', 'ref_no.ilike.*' + s + '*'];
    if (A.can(admin, 'cnic_search') && /^[0-9-]{4,15}$/.test(s)) {
      parts.push('cnic.ilike.*' + s + '*');
      const d = onlyDigits(s); if (d.length === 13) parts.push('cnic.eq.' + normCnic(d));
    }
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

async function geo() {
  const [p, d, t] = await Promise.all([
    sb.select('provinces', [['select', 'id,code,name,active'], ['order', 'name.asc'], ['limit', '50']]),
    sb.select('districts', [['select', 'id,code,name,name_ur,province_id,active'], ['order', 'name.asc'], ['limit', '500']]),
    sb.select('talukas', [['select', 'id,district_id,name,name_ur,active'], ['order', 'name.asc'], ['limit', '5000']]),
  ]);
  return { provinces: p.data, districts: d.data, talukas: t.data };
}

// The one search used by the list AND by every export, so an export always matches what is on screen.
// Returns { total, rows } for the page asked for.
async function queryMembers(admin, q, { offset = 0, limit = 25, cols = LIST_COLS } = {}) {
  const filters = memberFilters(admin, q);
  const talukaId = idOk(q.taluka_id) ? Number(q.taluka_id) : null;

  // No taluka chosen: plain query, counted by the database.
  if (talukaId === null) {
    const r = await sb.select('members', [...filters, ['select', cols], ['order', 'created_at.desc'], ['limit', String(limit)], ['offset', String(offset)]], { count: true });
    return { total: r.count || 0, rows: r.data || [] };
  }

  // Taluka chosen. Older members only have the typed taluka name (taluka_id is empty), so a row also
  // matches when its normalised name is the taluka's name inside the same district. Every candidate
  // is read first and then the page is cut, so no record is hidden by the page size.
  const t = await sb.select('talukas', [['select', 'id,name,district_id'], ['id', 'eq.' + talukaId], ['limit', '1']], { single: true });
  const taluka = t.data;
  if (!taluka) return { total: 0, rows: [] };
  const want = normName(taluka.name);
  const sel = [...new Set((cols + ',taluka_id,taluka_name,district_id').split(','))].join(',');
  const pool = [];
  for (let off = 0; pool.length < SCAN_MAX; off += 1000) {
    const page = await sb.select('members', [...filters, ['select', sel], ['order', 'created_at.desc'], ['limit', '1000'], ['offset', String(off)]]);
    const got = page.data || [];
    pool.push(...got);
    if (got.length < 1000) break;
  }
  const hits = pool.filter(m => (m.taluka_id != null)
    ? m.taluka_id === talukaId
    : (want && m.district_id === taluka.district_id && normName(m.taluka_name) === want));
  return { total: hits.length, rows: hits.slice(offset, offset + limit) };
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
  can: { cnic_search: A.can(admin, 'cnic_search'), status: A.can(admin, 'status'), remove: A.can(admin, 'remove'), export: A.can(admin, 'export'), audit: A.can(admin, 'audit'), reassign: A.can(admin, 'reassign'), all_districts: A.can(admin, 'all_districts'), cnic_full: A.can(admin, 'cnic_full'), edit: A.can(admin, 'edit') },
});

H.districts = async (req, res, admin) => {
  const g = await geo();
  if (!A.can(admin, 'all_districts')) { g.districts = g.districts.filter(d => d.id === admin.district_id); g.talukas = g.talukas.filter(t => t.district_id === admin.district_id); }
  return send(res, 200, { ok: true, ...g });
};

H.members = async (req, res, admin) => {
  const bad = checkSearch(req.query);
  if (bad) return sendError(res, 400, 'search_too_short', bad);
  const limit = int(req.query.limit, 25, 1, 100), offset = int(req.query.offset, 0, 0, 1000000);
  const r = await queryMembers(admin, req.query, { offset, limit, cols: LIST_COLS });
  return send(res, 200, { ok: true, total: r.total, limit, offset, members: r.rows.map(m => shapeRow(admin, m)) });
};

// Distinct designations and wings that exist in the admin's scope (for the filter dropdowns).
H.facets = async (req, res, admin) => {
  const r = await sb.select('members', [...memberFilters(admin, {}), ['select', 'designation,wing'], ['limit', String(SCAN_MAX)]]);
  const uniq = k => [...new Set((r.data || []).map(x => x[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return send(res, 200, { ok: true, designations: uniq('designation'), wings: uniq('wing') });
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
    const b = await readJson(req, MAX_BODY.register); // larger limit: the body may carry a new photo
    if ('cnic' in b && !A.can(admin, 'cnic_full')) return DENIED(res, 'You may not change the CNIC.');
    if ('district_id' in b && !A.can(admin, 'reassign')) return DENIED(res, 'Only a Super Admin can change a member\'s district.');

    // Optional new photograph (same JPEG rules as registration). Checked before anything is stored.
    let ph = null;
    if ('photo' in b) {
      ph = validatePhoto(b.photo);
      if (!ph.ok) return sendError(res, 422, 'validation_failed', ph.error, { fields: { photo: ph.error } });
    }
    const { photo: _photo, ...fieldsOnly } = b;
    let patch = {};
    if (!ph || Object.keys(fieldsOnly).length) {
      const v = validateEdit(fieldsOnly);
      if (!v.ok) return sendError(res, 422, 'validation_failed', Object.keys(v.errors).length ? 'Please correct the highlighted information.' : 'Nothing to update.', { fields: v.errors });
      patch = v.patch;
    }

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
    // New photo goes to a NEW random file name (the old file is removed only after the row points to the new one).
    // A new name also avoids stale copies in browser/Google-Sheet caches of the old photo.
    let newPhotoPath = null;
    if (ph) {
      newPhotoPath = 'members/' + crypto.randomUUID() + '.jpg';
      await sb.putObject(newPhotoPath, ph.buffer, 'image/jpeg');
      patch.photo_path = newPhotoPath;
    }
    const dropNew = async () => { if (newPhotoPath) { try { await sb.deleteObject(newPhotoPath); } catch (e2) { console.error('[admin] orphan photo cleanup failed'); } } };
    let out;
    try { out = await sb.update('members', [['id', 'eq.' + m.id]], patch); }
    catch (e) { await dropNew(); if (e.kind === 'db' && e.code === '23505') return sendError(res, 409, 'duplicate_cnic', 'Another member already has this CNIC.'); throw e; }
    if (!out.length) { await dropNew(); return sendError(res, 404, 'not_found', 'Member not found.'); }
    if (newPhotoPath && m.photo_path) { try { await sb.deleteObject(m.photo_path); } catch (e) { console.error('[admin] old photo delete failed'); } }
    const changed = Object.keys(patch).map(k => k === 'photo_path' ? 'photo' : k); // field names only; values (CNIC etc.) are not logged
    await A.audit(req, admin, 'update_member', 'member', m.id, { ref: m.ref_no, fields: changed });
    await syncAll('admin');
    return send(res, 200, { ok: true, updated: changed });
  }

  if (req.method === 'DELETE') {
    if (!A.can(admin, 'remove')) return DENIED(res);
    const b = await readJson(req, MAX_BODY.default);
    if (b.confirm !== 'DELETE') return sendError(res, 400, 'confirmation_required', 'Deleting requires explicit confirmation.');
    await sb.remove('members', [['id', 'eq.' + m.id]]);
    if (m.photo_path) { try { await sb.deleteObject(m.photo_path); } catch (e) { console.error('[admin] photo delete failed for a removed member'); } }
    await A.audit(req, admin, 'delete_member', 'member', m.id, { ref: m.ref_no, cnic: maskCnic(m.cnic), status: m.status });
    await syncAll('admin');
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
  await syncAll('admin');
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

// Rows for Excel, print and PDF. Same columns everywhere; CNIC masked unless the role may see it.
function exportRows(admin, rows, g) {
  const dist = new Map(g.districts.map(d => [d.id, d.name]));
  const tal = new Map(g.talukas.map(t => [t.id, t.name]));
  const prov = new Map(g.provinces.map(p => [p.id, p.name]));
  return rows.map((m, i) => [
    i + 1, m.ref_no, ymd(m.created_at), STATUS_LABEL[m.status] || m.status, m.name, m.father_name || '',
    A.can(admin, 'cnic_full') ? m.cnic : maskCnic(m.cnic), m.contact || '', m.email || '', m.dob || '',
    m.religion || '', m.education || '', m.designation || '', m.wing || '',
    LEVEL_LABEL[m.office_level] || '', m.office_area || '',
    prov.get(m.province_id) || '', m.district_id ? (dist.get(m.district_id) || '') : 'Unassigned',
    m.taluka_id ? (tal.get(m.taluka_id) || '') : (m.taluka_name || ''),
    m.residence_address || '', m.office_address || '', m.profession || '',
    m.reviewed_by || '', ymdTime(m.reviewed_at), m.status_note || '',
  ]);
}

// What was filtered, for the "Filters" sheet. CNIC and mobile values are not written into the file.
function filterSummary(q, g) {
  const out = [];
  const add = (label, v) => { if (v) out.push([label, v]); };
  add('Member name contains', txt(q.name, 100));
  add('Application no. contains', txt(q.ref, 40));
  if (q.cnic) out.push(['CNIC search', 'used (value not written)']);
  if (q.mobile) out.push(['Mobile search', 'used (value not written)']);
  add('Search (old box)', txt(q.q, 60));
  if (idOk(q.province_id)) add('Province', (g.provinces.find(p => String(p.id) === String(q.province_id)) || {}).name);
  if (q.district_id === 'none') add('District', 'Unassigned');
  else if (idOk(q.district_id)) add('District', (g.districts.find(d => String(d.id) === String(q.district_id)) || {}).name);
  if (idOk(q.taluka_id)) add('Taluka', (g.talukas.find(t => String(t.id) === String(q.taluka_id)) || {}).name);
  if (LEVELS.includes(q.office_level)) add('Office level', LEVEL_LABEL[q.office_level]);
  add('Designation', txt(q.designation, 100));
  add('Wing', txt(q.wing, 50));
  if (STATUSES.includes(q.status)) add('Status', STATUS_LABEL[q.status]);
  add('Registered from', q.date_from);
  add('Registered to', q.date_to);
  if (!out.length) out.push(['Filters', 'none (all members in your scope)']);
  return out;
}

H.export = async (req, res, admin) => {
  if (!A.can(admin, 'export')) return DENIED(res, 'You may not export member data.');
  const bad = checkSearch(req.query);
  if (bad) return sendError(res, 400, 'search_too_short', bad);
  const { total, rows } = await queryMembers(admin, req.query, { offset: 0, limit: EXPORT_MAX, cols: FULL_COLS });
  if (total > EXPORT_MAX) return sendError(res, 413, 'too_many_rows', 'This selection has ' + total + ' records. Exports are limited to ' + EXPORT_MAX + '. Narrow the filters and try again.');
  const g = await geo();
  const body = exportRows(admin, rows, g);
  const asJson = req.query.format === 'json';
  await A.audit(req, admin, 'export_members', 'member', null, { count: body.length, format: asJson ? 'json' : 'xlsx', filters: Object.keys(req.query).filter(k => FILTER_KEYS.includes(k)) });
  if (asJson) return send(res, 200, { ok: true, total: body.length, headers: EXPORT_HEAD, rows: body });

  const info = [['Item', 'Value'], ['Exported at (Asia/Karachi)', ymdTime(new Date().toISOString())], ['Exported by', admin.username], ['Records', body.length], ...filterSummary(req.query, g)];
  const buf = buildWorkbook([
    { name: 'Members', rows: [EXPORT_HEAD, ...body], widths: EXPORT_WIDTHS },
    { name: 'Filters', rows: info, widths: [32, 40] },
  ]);
  const stamp = ymd(new Date().toISOString());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NPCIHA-members-${stamp}.xlsx"`);
  res.setHeader('Content-Length', buf.length);
  return res.end(buf);
};

H.audit = async (req, res, admin) => {
  if (!A.can(admin, 'audit')) return DENIED(res);
  const limit = int(req.query.limit, 50, 1, 200), offset = int(req.query.offset, 0, 0, 100000);
  const r = await sb.select('audit_log', [['select', 'id,at,admin_username,action,target_type,target_id,detail'], ['order', 'at.desc'], ['limit', String(limit)], ['offset', String(offset)]], { count: true });
  return send(res, 200, { ok: true, total: r.count, entries: r.data });
};

// Latest Google Sheet sync result (super admin only).
H.sheetstatus = async (req, res, admin) => {
  if (!A.can(admin, 'all_districts')) return DENIED(res);
  const { data } = await sb.select('audit_log', [['action', 'eq.sheet_sync'], ['select', 'at,detail'], ['order', 'at.desc'], ['limit', '1']], { single: true });
  const d = (data && data.detail) || null;
  return send(res, 200, { ok: true, last: data ? { at: data.at, ok: !!(d && d.ok), rows: d && d.rows, via: d && d.via, where: d && d.where, error: d && d.error } : null });
};

// action -> { methods, public?, mutating? }
const ROUTES = {
  login: { methods: ['POST'], pub: true, mutating: true }, logout: { methods: ['POST'], mutating: true },
  me: { methods: ['GET'] }, districts: { methods: ['GET'] }, members: { methods: ['GET'] }, facets: { methods: ['GET'] },
  export: { methods: ['GET'] },
  member: { methods: ['GET', 'PATCH', 'DELETE'], mutating: false }, status: { methods: ['POST'], mutating: true },
  summary: { methods: ['GET'] }, audit: { methods: ['GET'] },
  sheetstatus: { methods: ['GET'] }
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
