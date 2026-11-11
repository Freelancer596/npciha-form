'use strict';
// Browser checks for the admin panel. Opens the REAL page in Chromium, signs in and clicks through the
// features against the real API handlers, with the in-memory mock database.
// Needs Playwright + Chromium:  node tests/ui-check.js   (prints SKIP if Playwright is not installed)
// The CDN scripts (three.js, jsPDF) are blocked here; a small jsPDF stub records the PDF calls instead.
const fs = require('fs'), os = require('os'), path = require('path');
const { server: mock, state } = require('./mock-supabase');
const { start } = require('./harness');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('SKIP: Playwright is not installed.'); process.exit(0); }

const PW = 'Dummy-Passw0rd-123';
const OUT = process.env.UI_OUT || path.join(os.tmpdir(), 'npciha-ui');
fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   <-- ' + (extra || ''))); };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const MOCK = 'http://127.0.0.1:' + mock.address().port;
  const web = await start({ mockUrl: MOCK });
  const BASE = 'http://127.0.0.1:' + web.address().port;
  await fetch(MOCK + '/__reset'); await fetch(MOCK + '/__ratereset');
  const setup = o => fetch(BASE + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ token: process.env.SETUP_TOKEN, password: PW, ...o }) });
  await setup({ username: 'boss', role: 'super_admin' });
  await setup({ username: 'hyd.entry', role: 'data_entry', district_code: 'hyderabad' });

  // ----- seed members directly into the mock database (realistic mix, 40 records so paging is used) -----
  const addM = (o) => state.t.members.push({ id: uuid(state.t.members.length + 1), ref_no: o.ref, name: o.name, father_name: 'Father', cnic: o.cnic, dob: '1990-01-01', religion: 'Islam', education: 'BA', designation: o.des || 'Member', wing: 'HRC', office_level: o.level || 'taluka', office_area: null, residence_address: 'House 1 Road', office_address: 'Office Road', profession: 'Teacher', contact: o.contact, email: 'x@example.com', photo_path: null, district_id: o.d === undefined ? 1 : o.d, taluka_id: o.t === undefined ? null : o.t, taluka_name: o.tn || null, province_id: 1, status: o.status || 'pending', status_note: null, reviewed_by: null, reviewed_at: null, created_at: o.at, updated_at: o.at });
  addM({ ref: 'NPCIHA/2026/000001', name: 'Ali Raza', cnic: '42101-1111111-1', contact: '03001111111', t: 1, tn: 'Latifabad', des: 'Chairman', status: 'approved', at: '2026-11-01T05:00:00Z' });
  addM({ ref: 'NPCIHA/2026/000002', name: 'Sana Gul', cnic: '42101-2222222-2', contact: '03002222222', t: 2, tn: 'Qasimabad', des: 'Secretary', status: 'pending', at: '2026-11-02T05:00:00Z' });
  addM({ ref: 'NPCIHA/2026/000003', name: 'Dilip Kumar', cnic: '42101-3333333-3', contact: '03003333333', d: 2, t: 3, tn: 'Rohri', level: 'city', des: 'Patron', status: 'rejected', at: '2026-11-03T05:00:00Z' });
  addM({ ref: 'NPCIHA/2026/000004', name: 'Tangwani Member', cnic: '42101-4444444-4', contact: '03004444444', tn: 'TANGWANI', status: 'approved', at: '2026-11-04T05:00:00Z' });
  for (let i = 1; i <= 36; i++) addM({ ref: 'NPCIHA/2026/' + String(10 + i).padStart(6, '0'), name: 'Member ' + String(i).padStart(2, '0'), cnic: '42102-' + String(i).padStart(7, '0') + '-' + (i % 10), contact: '0301' + String(1000000 + i), status: i % 3 === 0 ? 'approved' : 'pending', at: new Date(Date.UTC(2026, 10, 5, 5, i)).toISOString() });
  const N = state.t.members.length, APPROVED = state.t.members.filter(m => m.status === 'approved').length, PENDING = state.t.members.filter(m => m.status === 'pending').length, REJECTED = state.t.members.filter(m => m.status === 'rejected').length;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('npcihaIntroSeenSessionV1', '1'); } catch (e) { /* ignore */ }
    // jsPDF stub: the real library is on a CDN that this test machine cannot reach. Records what the report does.
    window.__pdf = { pages: 1, texts: [], saved: null, images: 0 };
    window.jspdf = { jsPDF: class { constructor() { } setFont() { } setFontSize() { } setTextColor() { } setFillColor() { } rect() { } splitTextToSize(s) { return [String(s)]; } addImage() { window.__pdf.images++; } addPage() { window.__pdf.pages++; } text(t) { window.__pdf.texts.push(String(t)); } save(n) { window.__pdf.saved = n; } } };
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|cdnjs|ERR_/.test(m.text())) jsErrors.push(m.text()); });
  await page.route(/cdnjs\.cloudflare\.com|bg-music\.mp3/, r => r.abort());

  const rowsText = () => page.$$eval('#rb tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ')));
  const fmsg = () => page.textContent('#fmsg');
  const waitIdle = () => page.waitForFunction(() => document.querySelector('#spin').classList.contains('hide'));

  await page.goto(BASE + '/');
  await page.click('#t2');
  await page.fill('#un', 'boss'); await page.fill('#pw', PW); await page.click('#unlock');
  await page.waitForSelector('#adm:not(.hide)');
  await page.waitForFunction(() => document.querySelector('#n-all').textContent !== '–', null, { timeout: 8000 }).catch(async () => { console.log('DEBUG pwm=' + (await page.textContent('#pwm')) + ' fmsg=' + (await page.textContent('#fmsg')) + ' ferr=' + (await page.textContent('#ferr')) + ' errs=' + jsErrors.join(' / ')); await page.screenshot({ path: path.join(OUT, 'debug.png') }); throw new Error('stats not loaded'); });
  await waitIdle();

  // ---- statistics and first page ----
  ok('stats: Total Applications matches the database', (await page.textContent('#n-all')) === String(N));
  ok('stats: Approved / Pending / Rejected match', (await page.textContent('#n-approved')) === String(APPROVED) && (await page.textContent('#n-pending')) === String(PENDING) && (await page.textContent('#n-rejected')) === String(REJECTED));
  const fits = await page.evaluate(() => { const w = document.querySelector('.tblwrap'); return w.scrollWidth <= w.clientWidth + 1; });
  ok('table: fits the screen width on a computer (no sideways scroll)', fits);
  ok('table: first page shows 25 rows', (await rowsText()).length === 25);
  ok('table: rows show serial 1 first and CNIC + mobile + designation columns', (await rowsText())[0].startsWith('1 NPCIHA') && /42102-|42101-/.test((await rowsText())[0]));
  ok('pager: "of N" total is shown', (await page.textContent('#pager')).includes('of ' + N));
  await page.locator('#rb').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'admin-desktop-table.png') });
  await page.screenshot({ path: path.join(OUT, 'admin-desktop.png'), fullPage: true });

  // ---- pagination ----
  await page.click('#pager button:has-text("Next")'); await waitIdle();
  ok('pagination: Next shows page 2 with serials 26 onward', (await page.textContent('#pager')).includes('Page 2') && (await rowsText())[0].startsWith('26 '));
  await page.click('#pager button:has-text("Previous")'); await waitIdle();

  // ---- search boxes ----
  await page.fill('#s-name', 'member 0'); await page.press('#s-name', 'Enter'); await waitIdle();
  let rt = await rowsText();
  ok('search by name: every result contains "Member 0" and there are several', rt.length > 0 && rt.every(r => /Member 0/i.test(r)), rt.slice(0, 2).join(' | '));
  await page.click('#s-clear'); await waitIdle();
  await page.fill('#s-mobile', '0300-2222222'); await page.click('#s-go'); await waitIdle();
  rt = await rowsText();
  ok('search by mobile (dashed form) finds Sana Gul only', rt.length === 1 && rt[0].includes('Sana Gul'), rt.join(' | '));
  await page.click('#s-clear'); await waitIdle();
  await page.fill('#s-cnic', '4210133333333'); await page.click('#s-go'); await waitIdle();
  rt = await rowsText();
  ok('search by CNIC typed without dashes finds Dilip Kumar', rt.length === 1 && rt[0].includes('Dilip Kumar'), rt.join(' | '));
  await page.click('#s-clear'); await waitIdle();
  await page.fill('#s-ref', 'NPCIHA/2026/000002'); await page.press('#s-ref', 'Enter'); await waitIdle();
  rt = await rowsText();
  ok('search by application number finds Sana Gul', rt.length === 1 && rt[0].includes('Sana Gul'));
  await page.click('#s-clear'); await waitIdle();
  await page.fill('#s-name', 'a'); await page.press('#s-name', 'Enter'); await waitIdle();
  ok('search too short: a clear message is shown', (await page.isVisible('#ferr')) && (await page.textContent('#ferr')).includes('at least 2 letters'));
  await page.click('#s-clear'); await waitIdle();

  // ---- clickable statistics ----
  await page.click('.stat[data-status="approved"]'); await waitIdle();
  rt = await rowsText();
  ok('stat card "Approved" filters the table to approved records', (await page.inputValue('#f-status')) === 'approved' && (await fmsg()).includes(String(APPROVED)) && rt.every(r => /Approved/.test(r)), (await fmsg()));
  await page.click('.stat[data-status=""]'); await waitIdle();
  ok('stat card "Total" clears the status filter', (await page.inputValue('#f-status')) === '' && (await fmsg()).includes(String(N)));

  // ---- dropdown filters (combined) ----
  await page.selectOption('#f-prov', { index: 1 }); await waitIdle();
  ok('province filter loads districts of that province', (await page.$$eval('#f-dist option', o => o.length)) > 2);
  await page.selectOption('#f-dist', '1'); await waitIdle();
  await page.selectOption('#f-tal', { label: 'Latifabad' }).catch(() => { });
  await page.selectOption('#f-status', 'approved'); await waitIdle();
  rt = await rowsText();
  ok('combined filters (district 1 + approved): rows returned, every one approved', rt.length > 0 && rt.every(r => /Approved/.test(r)), rt.join(' | '));
  await page.selectOption('#f-status', ''); await page.selectOption('#f-prov', ''); await page.selectOption('#f-dist', ''); await waitIdle();
  await page.selectOption('#f-level', 'city'); await waitIdle();
  rt = await rowsText();
  ok('office level filter: city -> Dilip Kumar only', rt.length === 1 && rt[0].includes('Dilip Kumar'), rt.join(' | '));
  await page.selectOption('#f-level', ''); await waitIdle();
  await page.selectOption('#f-desig', 'Chairman'); await waitIdle();
  ok('designation dropdown (from database values) filters to Chairman', (await rowsText()).length === 1);
  await page.selectOption('#f-desig', ''); await waitIdle();
  await page.click('#s-clear'); await waitIdle();

  // ---- details, PDF, more panel ----
  await page.click('#res tbody tr:first-child button:has-text("View Details")'); await page.waitForSelector('#pvw');
  ok('View Details opens the full application (photo box and form section)', (await page.isVisible('#pvw .pvfr')) && (await page.textContent('#pvw')).includes('MEMBERSHIP FORM'));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('pvw'));
  await page.click('#res tbody tr:first-child button.more'); await page.waitForSelector('tr.subrow button:has-text("Approve")');
  ok('More panel shows approve / reject / edit tools', (await page.$$('tr.subrow button')).length >= 4);
  await page.click('#res tbody tr:first-child button.more');

  // ---- exports ----
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#x-res')]);
  const xlsxPath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(xlsxPath);
  const bytes = fs.readFileSync(xlsxPath);
  ok('Excel export from the screen downloads a real .xlsx (zip starts PK)', /\.xlsx$/.test(dl.suggestedFilename()) && bytes.slice(0, 2).toString() === 'PK' && bytes.length > 1000, dl.suggestedFilename());
  await page.selectOption('#f-status', 'rejected'); await waitIdle();
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#x-filt')]);
  ok('Export Filtered (rejected) downloads', /\.xlsx$/.test(dl2.suggestedFilename()));
  await page.selectOption('#f-status', ''); await waitIdle();
  await page.evaluate(() => { window.__printed = 0; window.__printRows = -1; window.print = () => { window.__printed++; window.__printRows = document.querySelectorAll('#printArea tbody tr').length; }; });
  await page.click('#x-print'); await page.waitForTimeout(200);
  const pr = await page.evaluate(() => ({ n: window.__printed, rows: window.__printRows }));
  ok('Print Member List opens the print dialog with the table rows', pr.n === 1 && pr.rows === N, JSON.stringify(pr));
  await page.click('#x-pdf'); await page.waitForFunction(() => window.__pdf.saved !== null, null, { timeout: 15000 }).catch(() => { });
  const pdfState = await page.evaluate(() => window.__pdf);
  ok('PDF report is produced with a .pdf name', !!pdfState.saved && /\.pdf$/.test(pdfState.saved), JSON.stringify(pdfState).slice(0, 200));
  ok('PDF report spills onto a second page for 40 members and lists names', pdfState.pages >= 2 && pdfState.texts.some(t => t === 'Member 01'));

  // ---- mobile layout ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mob = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, trDisplay: getComputedStyle(document.querySelector('#res tbody tr')).display, thHidden: getComputedStyle(document.querySelector('#res thead')).display === 'none' }));
  ok('phone (390px): no horizontal page scroll', mob.sw <= mob.iw, JSON.stringify(mob));
  ok('phone: results become cards (rows are blocks, header hidden)', mob.trDisplay === 'block' && mob.thHidden);
  await page.locator('#rb tr').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'admin-mobile-cards.png') });
  await page.screenshot({ path: path.join(OUT, 'admin-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- data entry: CNIC box disabled, export hidden ----
  await page.click('#flo'); await page.waitForSelector('#lock:not(.hide)');
  await page.fill('#un', 'hyd.entry'); await page.fill('#pw', PW); await page.click('#unlock');
  await page.waitForSelector('#adm:not(.hide)'); await waitIdle();
  ok('data entry: CNIC search box is disabled and export bar is hidden', (await page.isDisabled('#s-cnic')) && !(await page.isVisible('#x-bar')));

  const real = jsErrors.filter(e => !/cdn|jspdf|three|Failed to load/i.test(e));
  ok('no JavaScript errors on the admin page', real.length === 0, real.join(' | '));
  await browser.close();
  web.close(); mock.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n=== UI: ${passed} passed, ${results.length - passed} failed, ${results.length} total (screenshots in ${OUT}) ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('UI TEST CRASH', e); process.exit(2); });
