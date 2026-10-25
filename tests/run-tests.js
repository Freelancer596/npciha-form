'use strict';
// Offline test suite. Runs the real API handlers against an IN-MEMORY MOCK of Supabase.
// A pass here proves the application logic; it does NOT prove the SQL files or RLS on a real Postgres.
const fs = require('fs'), path = require('path');
const { server: mock, state } = require('./mock-supabase');
const { start } = require('./harness');

const FX = n => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
const results = []; let BASE, MOCK;
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond }); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   <-- ' + (extra || ''))); };

async function call(method, p, { body, cookie, admin = false, origin, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (admin) h['X-Requested-With'] = 'npciha';
  if (method !== 'GET') h.Origin = origin || BASE;
  const r = await fetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* not json */ }
  return { s: r.status, j, text, h: r.headers, cookie: (r.headers.getSetCookie && r.headers.getSetCookie()[0]) || '' };
}
let tokN = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++tokN).padStart(12, '0')}`;
const form = (o = {}) => ({ name: 'Test Member', father: 'Test Father', cnic: '42101-1234567-1', dob: '1990-05-17', religion: 'Islam', education: 'BA', designation: 'Member', wing: 'HRC', res: 'House 1, Dummy Road, Hyderabad', off: '', prof: 'Teacher', contact: '0300-1234567', email: 'dummy@example.com', photo: FX('photo.jpg'), token: uuid(), province_id: 1, district_id: 1, taluka_id: 1, ...o });
const dump = async () => (await fetch(MOCK + '/__dump')).json();
const mockCmd = p => fetch(MOCK + p);
const login = async (u, pw) => { const r = await call('POST', '/api/admin/login', { body: { username: u, password: pw }, admin: true }); return { r, cookie: r.cookie.split(';')[0] }; };
const PW = 'Dummy-Passw0rd-123';
const setup = (o) => call('POST', '/api/setup', { body: { token: process.env.SETUP_TOKEN, password: PW, ...o } });

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  MOCK = 'http://127.0.0.1:' + mock.address().port;
  const web = await start({ mockUrl: MOCK }); BASE = 'http://127.0.0.1:' + web.address().port;
  console.log('--- NPCIHA offline tests (API logic vs MOCK Supabase) ---\n');

  // ========== health / config ==========
  let r = await call('GET', '/api/health');
  ok('health: reports ok when config + db + bucket reachable (mock)', r.s === 200 && r.j.ok && r.j.districts_loaded);
  ok('health: output contains no key or URL', !r.text.includes('test-service-role-key') && !r.text.includes('127.0.0.1:' + mock.address().port));
  const savedUrl = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
  r = await call('POST', '/api/register', { body: form() });
  ok('missing configuration -> clear 503 "not_configured", no internals', r.s === 503 && r.j.error === 'not_configured' && !/SUPABASE/.test(r.text));
  r = await call('GET', '/api/health'); ok('health: flags missing config', r.s === 503 && r.j.config.SUPABASE_URL === false);
  process.env.SUPABASE_URL = savedUrl;

  // ========== registration ==========
  const good = form(); r = await call('POST', '/api/register', { body: good });
  ok('valid registration -> 201 with reference number', r.s === 201 && r.j.ok && /^NPCIHA\/\d{4}\/\d{6}$/.test(r.j.ref), JSON.stringify(r.j));
  const ref1 = r.j.ref; let d = await dump();
  ok('valid registration saved in database (1 row, status pending)', d.t.members.length === 1 && d.t.members[0].status === 'pending' && d.t.members[0].ref_no === ref1);
  ok('contact normalised to 03XXXXXXXXX; CNIC stored in dashed format', d.t.members[0].contact === '03001234567' && d.t.members[0].cnic === '42101-1234567-1');
  ok('photo stored in private bucket path, not in a DB column as base64', d.files.length === 1 && d.t.members[0].photo_path === d.files[0] && !JSON.stringify(d.t.members[0]).includes('base64'));
  ok('response does not leak storage path / ids', !/photo_path|members\//.test(r.text));
  ok('response date uses d-m-yyyy (same as original form)', /^\d{1,2}-\d{1,2}-\d{4}$/.test(r.j.date));

  r = await call('POST', '/api/register', { body: form({ cnic: '42101-1234567-1' }) });
  ok('duplicate CNIC rejected (409) and nothing saved', r.s === 409 && r.j.error === 'duplicate_cnic');
  r = await call('POST', '/api/register', { body: form({ cnic: '4210112345671' }) });
  ok('duplicate CNIC typed without dashes also rejected', r.s === 409);
  d = await dump(); ok('after duplicates: still 1 member and 1 photo (no orphan files)', d.t.members.length === 1 && d.files.length === 1);

  r = await call('POST', '/api/register', { body: good });
  ok('retry with same submission token is idempotent (200, same ref, no new row)', r.s === 200 && r.j.duplicate_submission && r.j.ref === ref1);
  const tk = uuid(); const bodyP = form({ cnic: '42101-7654321-3', token: tk });
  const par = await Promise.all([call('POST', '/api/register', { body: bodyP }), call('POST', '/api/register', { body: bodyP })]);
  d = await dump();
  ok('simultaneous double-click creates exactly one record', d.t.members.filter(m => m.cnic === '42101-7654321-3').length === 1 && par.every(x => x.s === 200 || x.s === 201), par.map(x => x.s).join(','));
  ok('simultaneous double-click leaves no orphan photo', d.files.length === d.t.members.length, d.files.length + ' files / ' + d.t.members.length + ' rows');

  const bad = async (label, patch, field) => { const before = (await dump()).t.members.length; const x = await call('POST', '/api/register', { body: form(patch) }); const after = (await dump()).t.members.length; ok('invalid ' + label + ' rejected (422) and not saved', x.s === 422 && (!field || (x.j.fields && x.j.fields[field])) && before === after, x.s + ' ' + x.text.slice(0, 120)); };
  await bad('name (digits)', { name: '12345' }, 'name');
  await bad('name (empty)', { name: ' ' }, 'name');
  await bad('father name', { father: '<script>' }, 'father');
  await bad('CNIC (short)', { cnic: '42101-123' }, 'cnic');
  await bad('phone', { contact: '12345' }, 'contact');
  await bad('email', { email: 'not-an-email' }, 'email');
  await bad('future date of birth', { dob: '2999-01-01' }, 'dob');
  await bad('impossible date', { dob: '2020-02-31' }, 'dob');
  await bad('religion value', { religion: 'Pastafarian' }, 'religion');
  await bad('wing value', { wing: 'XYZ' }, 'wing');
  await bad('missing designation', { designation: '' }, 'designation');
  await bad('overlong address', { res: 'x'.repeat(300) }, 'res');
  await bad('submission token', { token: 'abc' }, 'token');
  await bad('missing photo', { photo: '' }, 'photo');
  await bad('photo: oversize JPEG (387 KB > 350 KB)', { photo: FX('mid.jpg') }, 'photo');
  await bad('photo: PNG data URI', { photo: FX('photo.jpg').replace('image/jpeg', 'image/png') }, 'photo');
  await bad('photo: PNG bytes labelled as JPEG', { photo: 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/photo.png')).toString('base64') }, 'photo');
  await bad('photo: text labelled as JPEG', { photo: 'data:image/jpeg;base64,' + Buffer.from('hello world '.repeat(80)).toString('base64') }, 'photo');
  r = await call('POST', '/api/register', { body: { ...form(), photo: FX('big.jpg') } });
  ok('request body over 600 KB rejected (413)', r.s === 413);
  r = await call('POST', '/api/register', { body: form({ name: 'Ayesha <b>Bibi</b>' }) });
  ok('HTML in name rejected, never stored', r.s === 422);
  r = await call('GET', '/api/register'); ok('GET /api/register -> 405', r.s === 405);
  r = await call('POST', '/api/register', { body: form(), origin: 'https://evil.example' }); ok('cross-site Origin refused (403)', r.s === 403);
  r = await call('POST', '/api/register', { body: 'not json' , headers: {} }); ok('malformed request -> 4xx not 500', r.s >= 400 && r.s < 500, r.s);

  // database failures
  let before = await dump();
  await mockCmd('/__fail?mode=insert'); r = await call('POST', '/api/register', { body: form({ cnic: '42101-1111111-1' }) });
  d = await dump(); await mockCmd('/__fail?mode=');
  ok('DB insert failure -> 503 with clear message, nothing reported as saved', r.s === 503 && r.j.ok === false && /try again/i.test(r.j.message));
  ok('DB insert failure leaves no orphan photo and no row', d.files.length === before.files.length && d.t.members.length === before.t.members.length);
  await mockCmd('/__fail?mode=storage'); r = await call('POST', '/api/register', { body: form({ cnic: '42101-2222222-1' }) });
  d = await dump(); await mockCmd('/__fail?mode=');
  ok('storage failure -> 503, no member row without photo', r.s === 503 && d.t.members.length === before.t.members.length);
  await mockCmd('/__fail?mode=all'); r = await call('POST', '/api/register', { body: form({ cnic: '42101-3333333-1' }) });
  await mockCmd('/__fail?mode=');
  ok('total database outage -> 503 "database_unavailable"; response hides internals', r.s === 503 && r.j.error === 'database_unavailable' && !/mock|XX000|supabase/i.test(r.text));
  r = await call('POST', '/api/register', { body: form({ cnic: '42101-4444444-1' }) });
  ok('service recovers after outage (registration works again)', r.s === 201);

  // ========== admin setup ==========
  r = await call('POST', '/api/setup', { body: { token: 'wrong-token-wrong-token', username: 'boss', password: PW } });
  ok('setup: wrong token rejected (403)', r.s === 403);
  r = await setup({ username: 'boss', password: 'short' }); ok('setup: weak password rejected', r.s === 422);
  r = await setup({ username: 'boss', role: 'super_admin' }); ok('setup: super admin created', r.s === 200 && r.j.ok, r.text);
  r = await setup({ username: 'hyd.admin', role: 'district_admin', district_code: 'hyderabad' }); ok('setup: district admin created', r.s === 200, r.text);
  r = await setup({ username: 'hyd.entry', role: 'data_entry', district_code: 'hyderabad' }); ok('setup: data entry operator created', r.s === 200, r.text);
  r = await setup({ username: 'skr.admin', role: 'district_admin', district_code: 'sukkur' }); ok('setup: second district admin created', r.s === 200);
  r = await setup({ username: 'nodistrict', role: 'district_admin', district_code: 'atlantis' }); ok('setup: unknown district rejected', r.s === 422);
  d = await dump(); const hashes = d.t.admins.map(a => a.password_hash);
  ok('passwords stored only as salted scrypt hashes (no plaintext)', hashes.every(h => h.startsWith('scrypt$')) && !JSON.stringify(d.t.admins).includes(PW) && new Set(hashes).size === hashes.length);
  const tkn = process.env.SETUP_TOKEN; delete process.env.SETUP_TOKEN;
  r = await call('POST', '/api/setup', { body: { token: tkn, username: 'x', password: PW } }); ok('setup: disabled (404) when SETUP_TOKEN is not set', r.s === 404);
  process.env.SETUP_TOKEN = tkn;

  // ========== unauthenticated access ==========
  for (const [m, p] of [['GET', '/api/admin/members'], ['GET', '/api/admin/summary'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/export'], ['GET', '/api/admin/districts'], ['GET', '/api/admin/me'], ['GET', '/api/admin/member?id=' + d.t.members[0].id]]) {
    r = await call(m, p, { admin: true });
    ok(`unauthenticated ${m} ${p.split('?')[0]} -> 401, no data`, r.s === 401 && !/Test Member|42101/.test(r.text));
  }
  r = await call('POST', '/api/admin/status', { body: { id: d.t.members[0].id, status: 'approved' }, admin: true }); ok('unauthenticated approve -> 401', r.s === 401);
  r = await call('DELETE', '/api/admin/member?id=' + d.t.members[0].id, { body: { confirm: 'DELETE' }, admin: true }); ok('unauthenticated delete -> 401', r.s === 401);
  r = await call('PATCH', '/api/admin/member?id=' + d.t.members[0].id, { body: { name: 'Hacked' }, admin: true }); ok('unauthenticated edit -> 401', r.s === 401);
  r = await call('GET', '/api/admin/members'); ok('request without X-Requested-With header refused (403)', r.s === 403);
  r = await call('GET', '/api/admin/../admin/nonexistent', { admin: true }); ok('unknown admin action -> 404', r.s === 404);
  r = await call('GET', '/api/admin/constructor', { admin: true }); ok('prototype-style action name -> 404', r.s === 404);
  r = await call('GET', '/members.json'); ok('no public data file is served', r.s === 404);
  r = await call('GET', '/sql/001_schema.sql'); ok('SQL / lib / api sources are not served as static files', r.s === 404);
  r = await call('GET', '/lib/sb.js'); ok('server library not downloadable', r.s === 404);

  // ========== login / session ==========
  let L = await login('boss', 'wrong-password-123'); ok('login: wrong password -> 401 generic', L.r.s === 401 && L.r.j.error === 'invalid_credentials');
  L = await login('nobody', PW); ok('login: unknown user -> same 401 message', L.r.s === 401 && L.r.j.message === (await login('boss', 'xxxxxxxxxxxx1')).r.j.message);
  const SA = await login('boss', PW); ok('login: correct credentials -> 200', SA.r.s === 200 && SA.r.j.user.role === 'super_admin');
  const ck = SA.r.cookie;
  ok('cookie flags: __Host- prefix, HttpOnly, Secure, SameSite=Strict, Path=/, no Domain', /^__Host-npciha_sid=/.test(ck) && /HttpOnly/.test(ck) && /Secure/.test(ck) && /SameSite=Strict/.test(ck) && /Path=\//.test(ck) && !/Domain=/i.test(ck));
  ok('login response contains no password hash / token in body', !/scrypt|token|password/i.test(SA.r.text));
  d = await dump(); ok('session token stored only as SHA-256 hash', d.t.admin_sessions.length >= 1 && d.t.admin_sessions.every(s => /^[0-9a-f]{64}$/.test(s.token_hash)) && !JSON.stringify(d.t.admin_sessions).includes(SA.cookie.split('=')[1]));
  r = await call('GET', '/api/admin/me', { admin: true, cookie: SA.cookie }); ok('session resumes via /me', r.s === 200 && r.j.user.username === 'boss' && r.j.can.remove === true);
  r = await call('GET', '/api/admin/me', { admin: true, cookie: '__Host-npciha_sid=' + 'a'.repeat(43) }); ok('forged session cookie -> 401', r.s === 401);
  r = await call('POST', '/api/admin/logout', { body: {}, admin: true, cookie: (await login('boss', PW)).cookie });
  ok('logout works and clears cookie', r.s === 200 && /Max-Age=0/.test(r.cookie));
  const tmp = await login('boss', PW); await call('POST', '/api/admin/logout', { body: {}, admin: true, cookie: tmp.cookie });
  r = await call('GET', '/api/admin/me', { admin: true, cookie: tmp.cookie }); ok('session cannot be reused after logout (revoked server-side)', r.s === 401);
  const exp = await login('boss', PW); (await dump()); await fetch(MOCK + '/__reset'); // reset removes sessions; re-seed below
  r = await call('POST', '/api/admin/login', { body: { username: 'boss', password: PW }, admin: true, origin: 'https://evil.example' });
  ok('login from foreign Origin refused (CSRF defence)', r.s === 403);

  // re-seed after the reset used for the expiry test (fresh DB, fresh rate counters)
  await setup({ username: 'boss', role: 'super_admin' }); await setup({ username: 'hyd.admin', role: 'district_admin', district_code: 'hyderabad' });
  await setup({ username: 'hyd.entry', role: 'data_entry', district_code: 'hyderabad' }); await setup({ username: 'skr.admin', role: 'district_admin', district_code: 'sukkur' });
  const regs = [];
  for (const [n, c] of [['Ali Raza', '42101-1111111-1'], ['Sana Gul', '42101-2222222-2'], ['Dilip Kumar', '42101-3333333-3'], ['Mary John', '42101-4444444-4']]) { const x = await call('POST', '/api/register', { body: form({ name: n, cnic: c, designation: n === 'Mary John' ? '=1+1' : 'Member' }) }); regs.push(x.j.ref); }
  // Admin scenarios start from records with NO district yet (like records created before the location feature).
  state.t.members.forEach(m => { m.district_id = null; m.taluka_id = null; });
  const S = await login('boss', PW);
  await login('boss', 'definitely-wrong-pass');
  const HA = await login('hyd.admin', PW), DE = await login('hyd.entry', PW), SK = await login('skr.admin', PW);
  ok('all four roles can sign in', [S, HA, DE, SK].every(x => x.r.s === 200));

  // session expiry
  const all = state.t.admin_sessions.map(s => s.expires_at); state.t.admin_sessions.forEach(s => { s.expires_at = new Date(Date.now() - 1000).toISOString(); });
  r = await call('GET', '/api/admin/me', { admin: true, cookie: S.cookie }); ok('expired sessions are rejected (server-side expiry)', r.s === 401);
  state.t.admin_sessions.forEach((s, i) => { s.expires_at = all[i]; });

  // ========== member access & persistence ==========
  r = await call('GET', '/api/admin/members', { admin: true, cookie: S.cookie });
  ok('super admin lists all members (persisted, newest first)', r.s === 200 && r.j.total === 4 && r.j.members[0].name === 'Mary John');
  ok('list shows full CNIC to super admin; no photo/path in list', r.j.members[0].cnic === '42101-4444444-4' && !/photo/.test(r.text));
  const ids = Object.fromEntries(r.j.members.map(m => [m.name, m.id]));
  r = await call('GET', '/api/admin/members', { admin: true, cookie: S.cookie }); ok('record still available on a fresh request ("after refresh")', r.j.total === 4);

  // ---- assign districts / talukas ----
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { district_id: 1, taluka_id: 1 }, admin: true, cookie: S.cookie }); ok('super admin assigns district + taluka', r.s === 200, r.text);
  await call('PATCH', '/api/admin/member?id=' + ids['Sana Gul'], { body: { district_id: 1, taluka_id: 2 }, admin: true, cookie: S.cookie });
  await call('PATCH', '/api/admin/member?id=' + ids['Dilip Kumar'], { body: { district_id: 2, taluka_id: 3 }, admin: true, cookie: S.cookie });
  r = await call('PATCH', '/api/admin/member?id=' + ids['Mary John'], { body: { district_id: 2, taluka_id: 1 }, admin: true, cookie: S.cookie }); ok('taluka from another district rejected (422)', r.s === 422);
  r = await call('GET', '/api/admin/members?district_id=1', { admin: true, cookie: S.cookie }); ok('district filter (Hyderabad) -> 2 members', r.j.total === 2 && r.j.members.every(m => m.district_id === 1));
  r = await call('GET', '/api/admin/members?district_id=1&taluka_id=2', { admin: true, cookie: S.cookie }); ok('taluka filter (Qasimabad) -> Sana Gul only', r.j.total === 1 && r.j.members[0].name === 'Sana Gul');
  r = await call('GET', '/api/admin/members?district_id=none', { admin: true, cookie: S.cookie }); ok('unassigned filter -> Mary John', r.j.total === 1 && r.j.members[0].name === 'Mary John');
  r = await call('GET', '/api/admin/members?q=ali', { admin: true, cookie: S.cookie }); ok('search by name', r.j.total === 1 && r.j.members[0].name === 'Ali Raza');
  r = await call('GET', '/api/admin/members?q=' + encodeURIComponent(regs[1]), { admin: true, cookie: S.cookie }); ok('search by membership number', r.j.total === 1 && r.j.members[0].name === 'Sana Gul');
  r = await call('GET', '/api/admin/members?q=42101-3333333-3', { admin: true, cookie: S.cookie }); ok('search by CNIC works for super admin', r.j.total === 1 && r.j.members[0].name === 'Dilip Kumar');
  r = await call('GET', '/api/admin/members?q=' + encodeURIComponent("x'),name.ilike.(*"), { admin: true, cookie: S.cookie }); ok('filter-injection attempt in search is neutralised (no error, no leak)', r.s === 200 && r.j.total === 0);
  r = await call('GET', '/api/admin/members?status=approved', { admin: true, cookie: S.cookie }); ok('status filter works (none approved yet)', r.j.total === 0);
  const today = new Date().toISOString().slice(0, 10);
  r = await call('GET', `/api/admin/members?date_from=${today}&date_to=${today}`, { admin: true, cookie: S.cookie }); ok('registration-date filter works', r.j.total === 4);

  // ---- role scoping ----
  r = await call('GET', '/api/admin/members', { admin: true, cookie: HA.cookie }); ok('district admin sees only own district (Hyderabad)', r.j.total === 2 && r.j.members.every(m => m.district_id === 1));
  r = await call('GET', '/api/admin/members?district_id=2', { admin: true, cookie: HA.cookie }); ok('district admin cannot widen scope with ?district_id', r.j.total === 2 && r.j.members.every(m => m.district_id === 1));
  r = await call('GET', '/api/admin/member?id=' + ids['Dilip Kumar'], { admin: true, cookie: HA.cookie }); ok("district admin cannot open another district's member by id (404)", r.s === 404);
  r = await call('PATCH', '/api/admin/member?id=' + ids['Dilip Kumar'], { body: { name: 'Hacked Name' }, admin: true, cookie: HA.cookie }); ok("district admin cannot edit another district's member", r.s === 404);
  r = await call('POST', '/api/admin/status', { body: { id: ids['Dilip Kumar'], status: 'approved' }, admin: true, cookie: HA.cookie }); ok("district admin cannot approve another district's member", r.s === 404);
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { district_id: 2 }, admin: true, cookie: HA.cookie }); ok('district admin cannot move a member to another district (403)', r.s === 403);
  r = await call('GET', '/api/admin/members', { admin: true, cookie: DE.cookie }); ok('data entry sees masked CNIC', r.s === 200 && r.j.members.every(m => /^\d{5}-\*{7}-\d$/.test(m.cnic)) && !/42101-\d{7}/.test(r.text));
  r = await call('GET', '/api/admin/members?q=1111111', { admin: true, cookie: DE.cookie }); ok('data entry cannot search by CNIC', r.j.total === 0);
  r = await call('GET', '/api/admin/member?id=' + ids['Ali Raza'], { admin: true, cookie: DE.cookie }); ok('data entry detail has masked CNIC but includes photo for form', r.j.member.cnic.includes('*') && r.j.photo && r.j.photo.startsWith('data:image/jpeg;base64,'));
  r = await call('POST', '/api/admin/status', { body: { id: ids['Ali Raza'], status: 'approved' }, admin: true, cookie: DE.cookie }); ok('data entry cannot approve (403)', r.s === 403);
  r = await call('GET', '/api/admin/export', { admin: true, cookie: DE.cookie }); ok('data entry cannot export (403)', r.s === 403);
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { cnic: '42101-9999999-9' }, admin: true, cookie: DE.cookie }); ok('data entry cannot change CNIC (403)', r.s === 403);
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { prof: 'Engineer' }, admin: true, cookie: DE.cookie }); ok('data entry can correct ordinary fields', r.s === 200);
  r = await call('GET', '/api/admin/audit', { admin: true, cookie: HA.cookie }); ok('district admin cannot read audit log (403)', r.s === 403);
  r = await call('DELETE', '/api/admin/member?id=' + ids['Ali Raza'], { body: { confirm: 'DELETE' }, admin: true, cookie: HA.cookie }); ok('district admin cannot delete (403)', r.s === 403);
  r = await call('GET', '/api/admin/districts', { admin: true, cookie: HA.cookie }); ok('district admin sees only own district in config list', r.j.districts.length === 1 && r.j.districts[0].code === 'hyderabad');

  // ---- detail / photo / PDF data ----
  r = await call('GET', '/api/admin/member?id=' + ids['Ali Raza'], { admin: true, cookie: S.cookie });
  const stored = r.j.photo && Buffer.from(r.j.photo.split(',')[1], 'base64');
  ok('admin detail returns the exact stored photo (belongs to correct member)', stored && stored.equals(fs.readFileSync(path.join(__dirname, 'fixtures/photo.jpg'))));
  ok('detail includes all printable form fields + reference no.', r.j.member.ref_no === regs[0] && r.j.member.father_name === 'Test Father' && r.j.member.residence_address.includes('Dummy Road'));
  ok('detail does not expose storage path', !('photo_path' in r.j.member));
  r = await call('GET', '/api/admin/member?id=not-a-uuid', { admin: true, cookie: S.cookie }); ok('invalid id -> 400', r.s === 400);

  // ---- approve / reject ----
  r = await call('POST', '/api/admin/status', { body: { id: ids['Ali Raza'], status: 'approved' }, admin: true, cookie: HA.cookie }); ok('district admin approves own-district member', r.s === 200);
  r = await call('POST', '/api/admin/status', { body: { id: ids['Sana Gul'], status: 'rejected', note: 'Incomplete documents' }, admin: true, cookie: S.cookie }); ok('super admin rejects with note', r.s === 200);
  r = await call('POST', '/api/admin/status', { body: { id: ids['Sana Gul'], status: 'bogus' }, admin: true, cookie: S.cookie }); ok('invalid status value rejected', r.s === 400);
  r = await call('GET', '/api/admin/members?status=approved', { admin: true, cookie: S.cookie }); ok('approved filter -> 1', r.j.total === 1 && r.j.members[0].name === 'Ali Raza');
  d = await dump(); const ali = d.t.members.find(m => m.name === 'Ali Raza'); ok('status change recorded with reviewer + time', ali.reviewed_by === 'hyd.admin' && ali.reviewed_at);

  // ---- edits ----
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { contact: 'abc' }, admin: true, cookie: S.cookie }); ok('edit with invalid phone rejected (422)', r.s === 422);
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { cnic: '42101-2222222-2' }, admin: true, cookie: S.cookie }); ok('edit to an existing CNIC rejected (409)', r.s === 409);
  r = await call('PATCH', '/api/admin/member?id=' + ids['Ali Raza'], { body: { status: 'approved', ref_no: 'HACK', photo_path: 'x' }, admin: true, cookie: S.cookie }); ok('mass-assignment of status/ref/photo via edit ignored (400/422)', r.s === 422);
  d = await dump(); ok('reference number unchanged after attempted overwrite', d.t.members.find(m => m.name === 'Ali Raza').ref_no === regs[0]);

  // ---- summary / export ----
  r = await call('GET', '/api/admin/summary', { admin: true, cookie: S.cookie });
  const hy = r.j.districts.find(x => x.district === 'Hyderabad');
  ok('summary: totals and district-wise counts', r.j.totals.total === 4 && r.j.totals.approved === 1 && r.j.totals.rejected === 1 && hy.total === 2 && r.j.districts.some(x => x.district === 'Unassigned'));
  r = await call('GET', '/api/admin/summary', { admin: true, cookie: HA.cookie }); ok('district admin summary limited to own district', r.j.totals.total === 2);
  r = await call('GET', '/api/admin/export?district_id=1', { admin: true, cookie: S.cookie });
  const rawCsv = Buffer.from(await (await fetch(BASE + '/api/admin/export?district_id=1', { headers: { Cookie: S.cookie, 'X-Requested-With': 'npciha' } })).arrayBuffer());
  ok('CSV export for authorised admin (UTF-8 BOM, attachment, filtered)', r.s === 200 && rawCsv[0] === 0xEF && rawCsv[1] === 0xBB && rawCsv[2] === 0xBF && /attachment/.test(r.h.get('content-disposition')) && r.text.includes('Ali Raza') && !r.text.includes('Dilip Kumar'));
  r = await call('GET', '/api/admin/export', { admin: true, cookie: S.cookie }); ok("CSV neutralises formula injection ('=1+1' -> \"'=1+1\")", r.text.includes("'=1+1") && !/,=1\+1,/.test(r.text));
  r = await call('GET', '/api/admin/export', { admin: true, cookie: HA.cookie }); ok("district admin CSV contains only own district's rows", r.s === 200 && !r.text.includes('Dilip Kumar') && !r.text.includes('Mary John'));

  // ---- delete with confirmation, audit ----
  r = await call('DELETE', '/api/admin/member?id=' + ids['Mary John'], { body: {}, admin: true, cookie: S.cookie }); ok('delete without confirmation refused (400)', r.s === 400);
  d = await dump(); const filesBefore = d.files.length;
  r = await call('DELETE', '/api/admin/member?id=' + ids['Mary John'], { body: { confirm: 'DELETE' }, admin: true, cookie: S.cookie }); d = await dump();
  ok('delete with confirmation removes the record and its photo', r.s === 200 && d.t.members.length === 3 && d.files.length === filesBefore - 1);
  r = await call('GET', '/api/admin/audit?limit=200', { admin: true, cookie: S.cookie });
  const acts = new Set(r.j.entries.map(e => e.action));
  ok('audit log records login, view, update, status, export, delete', ['login', 'view_member', 'update_member', 'set_status', 'export_csv', 'delete_member', 'login_failed', 'admin_created'].every(a => acts.has(a)), [...acts].join(','));
  const auditText = JSON.stringify((await dump()).t.audit_log);
  ok('audit log never contains a full CNIC, password or token', !/\d{5}-\d{7}-\d/.test(auditText) && !auditText.includes(PW) && !auditText.includes(S.cookie.split('=')[1]));

  // ---- lockout + rate limiting ----
  await setup({ username: 'victim', role: 'super_admin' });
  for (let i = 0; i < 5; i++) await login('victim', 'wrong-wrong-wrong' + i);
  r = await login('victim', PW); ok('account locked after 5 failed logins (correct password now refused)', r.r.s === 401);
  await fetch(MOCK + '/__reset'); await setup({ username: 'boss', role: 'super_admin' });
  let last = 0; for (let i = 0; i < 14; i++) { const x = await login('someone', 'whatever-whatever' + i); last = x.r.s; }
  ok('login endpoint rate-limited per network (429)', last === 429);
  await fetch(MOCK + '/__reset');
  last = 0; for (let i = 0; i < 32; i++) { const x = await call('POST', '/api/register', { body: { junk: 1 } }); last = x.s; }
  ok('registration endpoint rate-limited per network (429)', last === 429);


  // ---- province / district / free-text taluka ----
  await fetch(MOCK + '/__reset');
  r = await call('GET', '/api/provinces'); ok('GET /api/provinces returns only active provinces', r.s === 200 && r.j.items.length === 1 && r.j.items[0].code === 'sindh' && !('active' in r.j.items[0]));
  r = await call('GET', '/api/districts?province_id=1'); ok('GET /api/districts returns the province districts', r.s === 200 && r.j.items.length === 4);
  r = await call('GET', '/api/districts?province_id=abc'); ok('districts: invalid province_id -> 422', r.s === 422);
  r = await call('GET', '/api/districts?province_id=99'); ok('districts: unknown province -> empty list, not an error', r.s === 200 && r.j.items.length === 0);
  state.t.districts.find(x => x.id === 3).active = false;
  r = await call('GET', '/api/districts?province_id=1'); ok('districts: inactive district hidden from applicants', r.j.items.length === 3);
  state.t.districts.find(x => x.id === 3).active = true;

  const locBad = async (label, patch, field) => { const before = (await dump()).t.members.length; const x = await call('POST', '/api/register', { body: form(patch) }); const after = (await dump()).t.members.length; ok('location: ' + label + ' rejected (422) and not saved', x.s === 422 && !!(x.j.fields && x.j.fields[field]) && before === after, x.s + ' ' + x.text.slice(0, 160)); };
  await locBad('district that does not exist', { district_id: 999 }, 'district');
  await locBad('district missing', { district_id: undefined }, 'district');
  await locBad('province that does not exist', { province_id: 42 }, 'province');
  state.t.provinces.push({ id: 2, code: 'punjab', name: 'Punjab', active: true });
  await locBad('district that belongs to another province', { province_id: 2, district_id: 1 }, 'district');
  await locBad('non-numeric district id', { district_id: "1' OR '1'='1" }, 'district');
  await locBad('taluka longer than 100 characters', { taluka_name: 'A'.repeat(101) }, 'taluka');
  await locBad('taluka with script/markup', { taluka_name: '<script>x</script>' }, 'taluka');

  r = await call('POST', '/api/register', { body: form({ cnic: '42101-7000001-1', taluka_name: 'Kandhkot' }) });
  ok('typed taluka saved with province/district IDs', r.s === 201, r.text.slice(0, 160));
  const dm = (await dump()).t.members.find(m => m.cnic === '42101-7000001-1');
  ok('stored row: province_id=1, district_id=1, taluka_name="Kandhkot"', dm && dm.province_id === 1 && dm.district_id === 1 && dm.taluka_name === 'Kandhkot', JSON.stringify(dm && [dm.province_id, dm.district_id, dm.taluka_name]));
  r = await call('POST', '/api/register', { body: form({ cnic: '42101-7000002-1', district_id: 4, taluka_name: '' }) });
  ok('district without a taluka typed -> saved with taluka_name null', r.s === 201);
  const dm2 = (await dump()).t.members.find(m => m.cnic === '42101-7000002-1');
  ok('row stores taluka_name=null when left empty', dm2 && dm2.taluka_name === null && dm2.district_id === 4);

  // ---- secrets scan ----
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
  const root = path.join(__dirname, '..');
  const pub = walk(path.join(root, 'public')).map(f => fs.readFileSync(f, 'latin1')).join('\n');
  ok('front-end assets contain no service key, no SUPABASE_ names, no Authorization/apikey code', !/service_role|SUPABASE|apikey|sb_secret|eyJ[A-Za-z0-9_-]{20,}\./.test(pub));
  ok('front-end contains no password hash / localStorage database', !/94f5fab3|localStorage|claude\.use\("db"\)/.test(pub));
  const allSrc = walk(root).filter(f => !/tests[\/\\]/.test(f) && !/\.jpg$|\.png$/.test(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  ok('project source has no real-looking secrets (JWTs, sb_secret_, private keys)', !/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]{10,}|BEGIN (RSA )?PRIVATE KEY/.test(allSrc));

  // ---- summary ----
  const passed = results.filter(x => x.pass).length, failed = results.length - passed;
  console.log(`\n=== ${passed} passed, ${failed} failed, ${results.length} total ===`);
  web.close(); mock.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER CRASH', e); process.exit(2); });
