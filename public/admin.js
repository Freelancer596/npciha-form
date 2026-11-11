/* NPCIH-A admin panel: advanced search, filters, statistics cards, results table, Excel / print / PDF
   exports, member details and the edit tools. Loaded (defer) after index.html's own script, which
   provides $, api, pdf, save, saveFormOnly, savePhotoOnly, drawForm, shrink, kd, fmt, uuid and the
   globals ME (signed-in admin) and GEO (provinces, districts, talukas). */

const LVL_N = { provincial: "Provincial", district: "District", taluka: "Taluka", city: "City", member: "Member" };
const ST_N = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const ST_UR = { pending: "زیر غور", approved: "منظور", rejected: "مسترد" };
const PAGE = { no: 1, size: 25, total: 0 };
const SEARCH_IDS = ["s-name", "s-cnic", "s-mobile", "s-ref"];
const FILTER_IDS = [["f-prov", "Province"], ["f-dist", "District"], ["f-tal", "Taluka"], ["f-level", "Office level"], ["f-desig", "Designation"], ["f-wing", "Wing"], ["f-status", "Status"], ["f-from", "From"], ["f-to", "To"]];
// Columns used in the print view and the PDF report (the Excel file has every column).
const REPORT_COLS = [["Serial No.", 9], ["Application No.", 36], ["Member Name", 44], ["CNIC", 32], ["Mobile", 24], ["District", 26], ["Taluka", 28], ["Designation", 30], ["Office Level", 18], ["Status", 18], ["Application Date", 20]];

const pvEl = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
const mk = (tag, cls, text, fn) => { const b = pvEl(tag || "button", cls, text); b.type = "button"; if (fn) b.onclick = fn; return b; };
const mini = (txt, fn) => { const b = mk("button", "btn o mini", txt, fn); return b; };

function toM(r, p) { return { ref: r.ref_no, date: kd(r.created_at), name: r.name, father: r.father_name, cnic: r.cnic, dob: fmt(r.dob), religion: r.religion, education: r.education || "", designation: r.designation, wing: r.wing, res: r.residence_address, off: r.office_address || "", prof: r.profession || "", contact: r.contact, email: r.email || "", photo: p }; }
function dName(id) { const d = GEO.districts.find(x => x.id === id); return d ? d.name : "Unassigned"; }
function tName(id) { const t = GEO.talukas.find(x => x.id === id); return t ? t.name : "-"; }
function fillSel(sel, items, all, keep) { const v = keep ? sel.value : ""; sel.textContent = ""; const o = document.createElement("option"); o.value = ""; o.textContent = all; sel.append(o); items.forEach(i => { const e = document.createElement("option"); e.value = i[0]; e.textContent = i[1]; sel.append(e); }); sel.value = v; }
function fillTal(sel, did, all) { fillSel(sel, GEO.talukas.filter(t => t.active && String(t.district_id) === String(did)).map(t => [t.id, t.name]), all); }

// ---------- state, messages, busy indicator ----------
function busy(on, text) { const s = $("spin"); s.textContent = text || "Loading… / لوڈ ہو رہا ہے"; s.classList.toggle("hide", !on); $("s-go").disabled = !!on; }
function fail(msg) { const e = $("ferr"); e.textContent = msg || "Something went wrong. Please try again."; e.classList.remove("hide"); }
function clearErr() { const e = $("ferr"); e.textContent = ""; e.classList.add("hide"); }
function okMsg(msg) { $("fmsg").textContent = msg || ""; }
function showLock(msg) { pvClose(); ME = null; $("lock").classList.remove("hide"); $("adm").classList.add("hide"); $("rb").textContent = ""; $("pwm").textContent = msg || ""; }
const gone = R => { if (R.r && R.r.status === 401) { showLock("Session ended. Please sign in again."); return true; } return false; };

// ---------- search and filter parameters ----------
// "all"      = every member in your scope (role scope is applied by the server)
// "filtered" = the dropdown filters and dates only
// "search"   = search boxes + dropdown filters + dates (exactly what the table shows)
function params(mode) {
  const p = new URLSearchParams();
  const put = (k, id) => { const v = ($(id).value || "").trim(); if (v) p.set(k, v); };
  if (mode === "all") return p;
  if (mode === "search") { put("name", "s-name"); put("cnic", "s-cnic"); put("mobile", "s-mobile"); put("ref", "s-ref"); }
  put("province_id", "f-prov"); put("district_id", "f-dist"); put("taluka_id", "f-tal"); put("office_level", "f-level");
  put("designation", "f-desig"); put("wing", "f-wing"); put("status", "f-status"); put("date_from", "f-from"); put("date_to", "f-to");
  return p;
}
function filterText() {
  const out = [];
  if (hasSearch()) SEARCH_IDS.forEach(id => { const v = $(id).value.trim(); if (v) out.push(id.slice(2) + ": " + (id === "s-cnic" ? "***" : v)); });
  FILTER_IDS.forEach(([id, label]) => { const el = $(id); const v = el.value; if (!v) return; const shown = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : v; out.push(label + ": " + shown); });
  return out.length ? out.join(" | ") : "none";
}
function hasSearch() { return SEARCH_IDS.some(id => $(id).value.trim()); }

function fillDist() {
  const pv = $("f-prov").value;
  const ds = GEO.districts.filter(d => d.active && (!pv || String(d.province_id) === pv)).map(d => [d.id, d.name]);
  fillSel($("f-dist"), ds.concat(ME.can.all_districts ? [["none", "Unassigned / غیر تفویض"]] : []), "All districts / تمام اضلاع", true);
  if (!ME.can.all_districts) { $("f-dist").value = String(ME.user.district_id); $("f-dist").disabled = true; }
  fillTalFilter();
}
function fillTalFilter() { fillTal($("f-tal"), $("f-dist").value, "All talukas / تمام تحصیلیں"); }
function fillFilters(F) {
  fillSel($("f-prov"), (GEO.provinces || []).filter(p => p.active).map(p => [p.id, p.name]), "All provinces / تمام صوبے", true);
  fillDist();
  if (F && F.designations) { fillSel($("f-desig"), F.designations.map(x => [x, x]), "All designations / تمام عہدے", true); }
  if (F && F.wings) { fillSel($("f-wing"), F.wings.map(x => [x, x]), "All wings / تمام ونگ", true); }
}
function markCards() { document.querySelectorAll(".stat").forEach(b => b.classList.toggle("on", b.dataset.status === $("f-status").value)); }
function setStatus(v) { $("f-status").value = v; markCards(); loadList(true); }

// ---------- results table ----------
async function loadList(reset) {
  if (reset) PAGE.no = 1;
  clearErr(); busy(true, "Searching… / تلاش ہو رہی ہے"); okMsg("");
  const off = (PAGE.no - 1) * PAGE.size;
  const p = params("search"); p.set("offset", String(off)); p.set("limit", String(PAGE.size));
  const R = await api("admin/members?" + p.toString());
  busy(false);
  if (gone(R)) return;
  if (!R.j || !R.j.ok) { renderRows([], 0); fail(R.j && R.j.message || "Members could not be loaded. Check your connection and try again."); return; }
  PAGE.total = R.j.total;
  renderRows(R.j.members, off);
  renderPager();
  okMsg(R.j.total + " member(s) found / ممبران ملے");
}

function renderRows(list, off) {
  const tb = $("rb"); tb.textContent = "";
  if (!list.length) { const tr = pvEl("tr"); const td = pvEl("td", "empty", "No members found. / کوئی ممبر نہیں ملا۔"); td.colSpan = 12; tr.append(td); tb.append(tr); return; }
  list.forEach((x, i) => tb.append(rowEl(x, off + i + 1)));
}

function rowEl(x, serial) {
  const tr = pvEl("tr");
  const cells = [["S.No", String(serial)], ["Application No.", x.ref_no], ["Member Name", x.name], ["CNIC", x.cnic], ["Mobile", x.contact],
    ["District", x.district_id ? dName(x.district_id) : "Unassigned"], ["Taluka", x.taluka_id ? tName(x.taluka_id) : (x.taluka_name || "-")],
    ["Designation", x.designation || "-"], ["Office Level", LVL_N[x.office_level] || "-"]];
  cells.forEach(([l, v]) => { const td = pvEl("td", "", v); td.dataset.l = l; tr.append(td); });
  const st = pvEl("td", ""); st.dataset.l = "Application Status";
  st.append(pvEl("span", "badge b-" + x.status, (ST_N[x.status] || x.status) + (ST_UR[x.status] ? " · " + ST_UR[x.status] : "")));
  tr.append(st);
  const dt = pvEl("td", "", kd(x.created_at)); dt.dataset.l = "Application Date"; tr.append(dt);
  const act = pvEl("td", "acts"); act.dataset.l = "Actions";
  act.append(mk("button", "", "👁 View Details / تفصیل", () => viewDetails(x.id)), mk("button", "", "📄 View PDF", () => viewPdf(x.id)), mk("button", "", "🧾 Form only / صرف فارم", () => rowDownload(x.id, "form")), mk("button", "", "🖼 Photo only / صرف تصویر", () => rowDownload(x.id, "photo")), mk("button", "more", "⚙ More / مزید", () => togglePanel(tr, x)));
  tr.append(act);
  return tr;
}

async function rowDownload(id, what) {
  clearErr(); busy(true, "Preparing download… / ڈاؤن لوڈ تیار ہو رہا ہے");
  try {
    const d = await detail(id); if (!d) return;
    const m = toM(d.member, d.photo);
    if (what === "form") await saveFormOnly(m); else await savePhotoOnly(m);
  } catch (e) { fail(e && e.message || "The file could not be created."); }
  finally { busy(false); }
}

function togglePanel(tr, x) {
  const nx = tr.nextElementSibling;
  if (nx && nx.classList.contains("subrow")) { nx.remove(); return; }
  const sub = pvEl("tr", "subrow"); const td = pvEl("td"); td.colSpan = 12; sub.append(td); tr.after(sub); panel(td, x);
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(PAGE.total / PAGE.size));
  const pg = $("pager"); pg.textContent = "";
  const from = PAGE.total ? (PAGE.no - 1) * PAGE.size + 1 : 0, to = Math.min(PAGE.total, PAGE.no * PAGE.size);
  const prev = mk("button", "btn o", "← Previous / پچھلا", () => { PAGE.no--; loadList(false); }); prev.disabled = PAGE.no <= 1;
  const next = mk("button", "btn o", "Next / اگلا →", () => { PAGE.no++; loadList(false); }); next.disabled = PAGE.no >= pages;
  const info = pvEl("span", "pinfo", PAGE.total ? from + "–" + to + " of " + PAGE.total + " · Page " + PAGE.no + " / " + pages : "");
  const sz = pvEl("select", "psize"); [25, 50, 100].forEach(n => { const o = pvEl("option", "", n + " per page"); o.value = n; sz.append(o); });
  sz.value = String(PAGE.size);
  sz.onchange = () => { PAGE.size = +sz.value; loadList(true); };
  pg.append(prev, info, next, sz);
}

// ---------- statistics cards (click a card to see its records) ----------
async function loadSummary() {
  const R = await api("admin/summary");
  if (gone(R)) return;
  if (!R.j || !R.j.ok) { $("stats").classList.add("err"); return; }
  $("stats").classList.remove("err");
  const T = R.j.totals;
  $("n-all").textContent = T.total; $("n-approved").textContent = T.approved; $("n-pending").textContent = T.pending; $("n-rejected").textContent = T.rejected;
}

// ---------- exports ----------
function saveBlob(blob, name) { const u = URL.createObjectURL(blob); const a = pvEl("a"); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }

async function downloadExcel(mode) {
  clearErr(); busy(true, "Preparing Excel file… / ایکسل فائل تیار ہو رہی ہے");
  try {
    const p = params(mode); p.set("format", "xlsx");
    const r = await fetch("/api/admin/export?" + p.toString(), { credentials: "same-origin", headers: { "X-Requested-With": "npciha" } });
    if (r.status === 401) { showLock("Session ended. Please sign in again."); return; }
    if (!r.ok) { let m = "Excel export failed."; try { m = (await r.json()).message || m; } catch (e) { /* not JSON */ } fail(m); return; }
    const cd = r.headers.get("content-disposition") || "";
    const nm = cd.match(/filename="([^"]+)"/);
    saveBlob(await r.blob(), nm ? nm[1] : "NPCIHA-members.xlsx");
    okMsg("Excel file downloaded. / ایکسل فائل ڈاؤن لوڈ ہو گئی۔");
  } catch (e) { fail("Network problem. Check your connection and try again."); }
  finally { busy(false); }
}

// JSON rows for the print view and the PDF report: same filters and the same records as Excel.
async function fetchRows(mode) {
  clearErr(); busy(true, "Loading member list… / ممبران کی فہرست لوڈ ہو رہی ہے");
  try {
    const p = params(mode); p.set("format", "json");
    const R = await api("admin/export?" + p.toString());
    if (gone(R)) return null;
    if (!R.j || !R.j.ok) { fail(R.j && R.j.message || "The list could not be loaded."); return null; }
    return R.j;
  } finally { busy(false); }
}
function pickCols(d, spec) {
  const idx = spec.map(([h]) => d.headers.indexOf(h));
  return { head: spec.map(([h]) => h), rows: d.rows.map(r => idx.map(i => (i < 0 ? "" : r[i]))) };
}

async function printList() {
  const d = await fetchRows("search"); if (!d) return;
  const T = pickCols(d, REPORT_COLS);
  const pa = $("printArea"); pa.textContent = "";
  pa.append(pvEl("h2", "", "NPCIH-A Sindh · Member List / ممبران کی فہرست"));
  pa.append(pvEl("p", "", "Records: " + d.total + " · Printed: " + new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }) + " · Filters: " + filterText()));
  const t = pvEl("table"); const hd = pvEl("tr"); T.head.forEach(h => hd.append(pvEl("th", "", h))); const th = pvEl("thead"); th.append(hd); t.append(th);
  const tb = pvEl("tbody"); T.rows.forEach(r => { const tr = pvEl("tr"); r.forEach(c => tr.append(pvEl("td", "", c))); tb.append(tr); }); t.append(tb);
  pa.append(t);
  pa.classList.remove("hide");
  window.print();
  setTimeout(() => { pa.textContent = ""; pa.classList.add("hide"); }, 800);
}

// Urdu text cannot be written with jsPDF's built-in font, so Urdu cells are drawn as small images.
function urduImg(t) {
  const font = "24px 'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Noto Naskh Arabic','Arial Unicode MS',serif";
  const c = document.createElement("canvas"), x = c.getContext("2d");
  x.font = font; const w = Math.ceil(x.measureText(t).width) + 10;
  c.width = w; c.height = 40;
  x.font = font; x.direction = "rtl"; x.fillStyle = "#000"; x.textBaseline = "middle"; x.fillText(t, 5, 21);
  return { url: c.toDataURL("image/png"), mm: w * 0.115 };
}

async function pdfReport() {
  if (!window.jspdf) { fail("The PDF library did not load. Check your internet connection and reload the page."); return; }
  const d = await fetchRows("search"); if (!d) return;
  const T = pickCols(d, REPORT_COLS);
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageH = 210, left = 6, rowH = 6.5, bottom = 196;
  let y = 0, pageNo = 1;
  const footer = () => { doc.setFont(undefined, "normal"); doc.setFontSize(8); doc.setTextColor(90); doc.text("Page " + pageNo, 291, 206, { align: "right" }); doc.setTextColor(0); };
  const header = () => {
    doc.setFont(undefined, "bold"); doc.setFontSize(14); doc.text("NPCIH-A Sindh · Member Report", left, 14);
    doc.setFont(undefined, "normal"); doc.setFontSize(9);
    doc.text("Records: " + d.total + " · Generated: " + new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }), left, 20);
    const ft = "Filters: " + filterText(); doc.text(doc.splitTextToSize(ft, 285)[0], left, 25);
    y = 31; drawHead();
  };
  const drawHead = () => {
    doc.setFont(undefined, "bold"); doc.setFontSize(8); doc.setFillColor(230, 230, 220);
    let x = left; REPORT_COLS.forEach(([h, w]) => { doc.rect(x, y, w, rowH, "F"); doc.text(h, x + 1, y + 4.4); x += w; });
    y += rowH; doc.setFont(undefined, "normal");
  };
  header();
  for (const r of T.rows) {
    if (y + rowH > bottom) { footer(); doc.addPage(); pageNo++; y = 12; drawHead(); }
    let x = left;
    r.forEach((cell, i) => {
      const w = REPORT_COLS[i][1];
      doc.rect(x, y, w, rowH);
      const s = String(cell == null ? "" : cell);
      if (/[؀-ۿ]/.test(s)) {
        const im = urduImg(s); const mw = Math.min(w - 2, im.mm); const mh = mw * 40 / (im.mm / 0.115);
        doc.addImage(im.url, "PNG", x + 1, y + (rowH - mh) / 2, mw, mh);
      } else {
        doc.setFontSize(7.5);
        doc.text(doc.splitTextToSize(s, w - 2)[0] || "", x + 1, y + 4.4);
      }
      x += w;
    });
    y += rowH;
  }
  footer();
  if (!d.rows.length) { doc.text("No members found for these filters.", left, y + 8); }
  doc.save("NPCIHA-member-report-" + new Date().toISOString().slice(0, 10) + ".pdf");
  okMsg("PDF report downloaded. / پی ڈی ایف رپورٹ ڈاؤن لوڈ ہو گئی۔");
}

// ---------- member details, PDF ----------
async function detail(id) { const R = await api("admin/member?id=" + id); if (gone(R)) return null; if (!R.j || !R.j.ok) { fail(R.j && R.j.message || "Cannot load this member."); return null; } return R.j; }
async function viewDetails(id) {
  clearErr(); busy(true, "Loading application… / درخواست لوڈ ہو رہی ہے");
  try { const d = await detail(id); if (d) openPreview(d); } finally { busy(false); }
}
async function viewPdf(id) {
  const w = window.open("", "_blank");
  clearErr(); busy(true, "PDF / PDF بن رہی ہے");
  try {
    const d = await detail(id);
    if (!d) { if (w) w.close(); return; }
    const m = toM(d.member, d.photo);
    const blob = (await pdf(m)).output("blob");
    if (w) { const u = URL.createObjectURL(blob); w.location.href = u; setTimeout(() => URL.revokeObjectURL(u), 120000); }
    else saveBlob(blob, "NPCIHA-" + m.ref.replace(/\W+/g, "_") + ".pdf");
  } catch (e) { if (w) w.close(); fail("PDF could not be created."); }
  finally { busy(false); }
}

// ---------- full application preview (photo, details, form) ----------
function pvClose() { const o = $("pvw"), z = $("pvz"); if (o) o.remove(); if (z) z.remove(); document.body.style.overflow = ""; }
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if ($("pvz")) { $("pvz").remove(); return; } if ($("pvw")) pvClose(); });
function openZoom(src, alt) {
  const old = $("pvz"); if (old) old.remove();
  const z = pvEl("div"), bar = pvEl("div", "pvzb"), sc = pvEl("div", "pvzs"), im = new Image(), lab = pvEl("span", "pvzl", "100%"); let k = 1;
  z.id = "pvz"; im.alt = alt || "";
  const set = n => { const fx = (sc.scrollLeft + sc.clientWidth / 2) / Math.max(sc.scrollWidth, 1), fy = (sc.scrollTop + sc.clientHeight / 2) / Math.max(sc.scrollHeight, 1); k = Math.min(6, Math.max(1, n)); const w = im.naturalWidth || 1, h = im.naturalHeight || 1; im.style.width = Math.round(Math.min(sc.clientWidth, sc.clientHeight * w / h) * k) + "px"; im.style.cursor = k > 1 ? "zoom-out" : "zoom-in"; sc.scrollLeft = fx * sc.scrollWidth - sc.clientWidth / 2; sc.scrollTop = fy * sc.scrollHeight - sc.clientHeight / 2; lab.textContent = Math.round(k * 100) + "%"; };
  const btn = (t, f) => { const b = pvEl("button", "", t); b.onclick = f; return b; };
  bar.append(btn("−", () => set(k / 1.4)), lab, btn("+", () => set(k * 1.4)), btn("Fit", () => set(1)), btn("✕ Close", () => z.remove()));
  im.onclick = () => set(k > 1 ? 1 : 2.5); im.onload = () => { set(1); sc.scrollLeft = 0; sc.scrollTop = 0; };
  sc.addEventListener("wheel", e => { e.preventDefault(); set(k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  window.addEventListener("resize", () => { if (document.body.contains(z)) set(k); });
  sc.append(im); z.append(bar, sc); document.body.append(z); im.src = src;
}
function openPreview(d) {
  pvClose();
  const M = d.member, m = toM(M, d.photo);
  const ov = pvEl("div"), box = pvEl("div", "pvbox"), hd = pvEl("div", "pvh"), ti = pvEl("div"), t1 = pvEl("b", "", "APPLICATION PREVIEW / درخواست پریویو"), t2 = pvEl("div", "", M.ref_no + " • " + kd(M.created_at));
  ov.id = "pvw";
  t1.style.cssText = "display:block;font-size:16px;letter-spacing:1px;color:var(--g)"; t2.style.cssText = "font-size:13px;color:var(--m)"; ti.append(t1, t2);
  const bt = pvEl("div"), dl = pvEl("button", "dl", "⬇ Download PDF"), cl = pvEl("button", "", "✕ Close");
  bt.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
  dl.onclick = async () => { dl.disabled = true; const t = dl.textContent; dl.textContent = "⏳ PDF…"; try { await save(await pdf(m), m); } catch (e) { alert("PDF could not be created: " + (e && e.message || "unknown")); } dl.disabled = false; dl.textContent = t; };
  const fd2 = pvEl("button", "", "🧾 Form"), pd2 = pvEl("button", "", "🖼 Photo");
  fd2.onclick = async () => { fd2.disabled = true; try { await saveFormOnly(m); } catch (e) { alert("Form could not be created: " + (e && e.message || "unknown")); } fd2.disabled = false; };
  pd2.onclick = async () => { pd2.disabled = true; try { await savePhotoOnly(m); } catch (e) { alert(e && e.message || "Photo could not be saved"); } pd2.disabled = false; };
  cl.onclick = pvClose; bt.append(dl, fd2, pd2, cl); hd.append(ti, bt);
  const top = pvEl("div", "pvtop"), dt = pvEl("div", "pvd");
  [["Application No.", M.ref_no], ["Date", kd(M.created_at)], ["Status", ST_N[M.status] || M.status], ["Name", M.name], ["Father Name", M.father_name], ["CNIC", M.cnic], ["Date of Birth", fmt(M.dob)], ["Religion", M.religion], ["Education", M.education], ["Designation", M.designation], ["Office Level", LVL_N[M.office_level] || ""], ["Office Area", M.office_area], ["Wing", M.wing], ["District", M.district_id ? dName(M.district_id) : ""], ["Taluka", M.taluka_name || (M.taluka_id ? tName(M.taluka_id) : "")], ["Contact", M.contact], ["E-mail", M.email], ["Profession", M.profession], ["Residence Address", M.residence_address], ["Office Address", M.office_address]].forEach(([l, v]) => { const r = pvEl("div"); r.append(pvEl("small", "", l), pvEl("span", "", v || "—")); dt.append(r); });
  const ph = pvEl("div", "pvph"), fr = pvEl("div", "pvfr");
  if (d.photo) { const im = new Image(); im.src = d.photo; im.alt = "Photo of " + M.name; im.onclick = () => openZoom(d.photo, im.alt); fr.append(im); const zb = pvEl("button", "", "🔍 Zoom photo"); zb.onclick = () => openZoom(d.photo, im.alt); ph.append(fr, zb); }
  else { fr.append(pvEl("div", "na", "Photo Not Available")); ph.append(fr); }
  top.append(ph, dt);
  const fh = pvEl("b", "pvf", "MEMBERSHIP FORM / ممبرشپ فارم"), holder = pvEl("div", "", "Loading form…"); holder.style.cssText = "color:var(--m);font-size:14px";
  drawForm(m).then(c => { holder.textContent = ""; holder.append(c); }).catch(() => { holder.textContent = "The form could not be drawn."; });
  box.append(hd, top, fh, holder); ov.append(box); ov.onclick = e => { if (e.target === ov) pvClose(); }; document.body.append(ov); document.body.style.overflow = "hidden"; ov.scrollTop = 0;
}

// ---------- "More" panel: approve / reject, reassign, edit a field, change photo, delete ----------
function panel(pn, x) {
  const info = pvEl("div", "msg", "Ref: " + x.ref_no + " | Registered: " + kd(x.created_at) + " | District: " + dName(x.district_id) + " | Taluka: " + (x.taluka_id ? tName(x.taluka_id) : (x.taluka_name || "-")));
  info.style.marginTop = "0"; pn.append(info);
  const say = t => { info.textContent = t; };
  const done = async (R, ok) => { if (gone(R)) return; if (R.j && R.j.ok) { await loadList(false); await loadSummary(); okMsg(ok); } else say(R.j && R.j.message || "Failed."); };
  if (ME.can.status) {
    const r = pvEl("div", "row");
    [["Approve", "approved"], ["Reject", "rejected"], ["Set Pending", "pending"]].forEach(([l, st]) => r.append(mini(l, async () => {
      if (!confirm(l + " this registration?\n" + x.ref_no)) return;
      const n = st === "rejected" ? (prompt("Reason (optional)") || "") : "";
      done(await api("admin/status", { method: "POST", json: { id: x.id, status: st, note: n } }), "Status set to " + st + ".");
    })));
    pn.append(r);
  }
  const d = pvEl("div", "row"); d.style.marginTop = "8px";
  const ds = pvEl("select"), ts = pvEl("select");
  const dsOpts = ME.can.reassign ? GEO.districts.filter(z => z.active).map(z => [z.id, z.name]) : [];
  fillSel(ds, dsOpts, "District…");
  ds.value = x.district_id || "";
  if (!ME.can.reassign) { ds.disabled = true; fillSel(ds, [[ME.user.district_id, dName(ME.user.district_id)]], "District…"); ds.value = ME.user.district_id; }
  const refT = () => fillTal(ts, ds.value, "Taluka…"); refT(); ts.value = x.taluka_id || ""; ds.onchange = refT;
  d.append(ds, ts); pn.append(d);
  pn.append(mini("Save district / taluka", async () => { if (!ds.value) { say("Choose a district first."); return; } const j = { taluka_id: ts.value || null }; if (ME.can.reassign) j.district_id = +ds.value; else if (x.district_id !== ME.user.district_id) { say("This record has no district."); return; } done(await api("admin/member?id=" + x.id, { method: "PATCH", json: j }), "Assignment saved."); }));
  const fs = pvEl("select"); fs.style.marginTop = "8px";
  [["name", "Name"], ["father", "Father name"], ["dob", "Date of birth (YYYY-MM-DD)"], ["religion", "Religion"], ["education", "Education"], ["designation", "Designation"], ["wing", "Wing"], ["res", "Residence address"], ["off", "Office address"], ["prof", "Profession"], ["contact", "Mobile"], ["email", "E-mail"]].concat(ME.can.cnic_search ? [["cnic", "CNIC"]] : []).forEach(([k, l]) => { const o = pvEl("option", "", "Edit: " + l); o.value = k; fs.append(o); });
  pn.append(fs);
  pn.append(mini("Change selected field", async () => { const v = prompt("New value for " + fs.options[fs.selectedIndex].text.replace("Edit: ", "")); if (v === null) return; done(await api("admin/member?id=" + x.id, { method: "PATCH", json: { [fs.value]: v } }), "Field updated."); }));
  const pf = pvEl("input"); pf.type = "file"; pf.accept = "image/*"; pf.className = "hide";
  const pw = pvEl("div", "hide"); pw.style.marginTop = "8px";
  const pi = pvEl("img"); pi.alt = "New photo"; pi.style.cssText = "display:block;width:110px;max-width:40%;border:1px solid var(--b);margin-bottom:6px";
  let np = ""; const clr = () => { np = ""; pf.value = ""; pi.removeAttribute("src"); pw.classList.add("hide"); };
  pf.onchange = async () => { const f = pf.files && pf.files[0]; if (!f) return; if (f.type && !/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type) || f.size > 25 * 1048576) { clr(); say("Please choose a JPG, PNG or WebP photo under 25 MB."); return; } say("Processing photo…"); try { np = await shrink(f); pi.src = np; pw.classList.remove("hide"); say("Check the new photo, then tap Save new photo."); } catch (e) { clr(); say("Could not read this photo. Try another one."); } };
  const pr = pvEl("div", "row");
  pr.append(mini("Save new photo", async () => { if (!np) { say("Choose a photo first."); return; } if (!confirm("Replace the photo of " + x.name + " (" + x.ref_no + ")?")) return; const R = await api("admin/member?id=" + x.id, { method: "PATCH", json: { photo: np } }); if (gone(R)) return; if (R.j && R.j.ok) { clr(); await loadList(false); okMsg("Photo updated. / تصویر تبدیل ہو گئی۔"); } else say(R.j && R.j.message || "Failed."); }), mini("Cancel", () => { clr(); say("Photo change cancelled."); }));
  pw.append(pi, pr);
  if (ME.can.edit !== false) pn.append(mini("📷 Change photo / تصویر تبدیل کریں", () => pf.click()), pf, pw);
  if (ME.can.remove) pn.append(mini("Delete record", async () => { if (!confirm("Permanently delete " + x.name + " (" + x.ref_no + ")? This cannot be undone.")) return; if (prompt("Type DELETE to confirm") !== "DELETE") { say("Delete cancelled."); return; } done(await api("admin/member?id=" + x.id, { method: "DELETE", json: { confirm: "DELETE" } }), "Record deleted."); }));
}

// ---------- sign-in, audit, sign-out ----------
async function enter() {
  const R = await api("admin/me"); if (!R.j || !R.j.ok) return false;
  ME = R.j;
  const G = await api("admin/districts"); if (G.j && G.j.ok) GEO = G.j;
  const F = await api("admin/facets");
  $("lock").classList.add("hide"); $("adm").classList.remove("hide");
  $("x-bar").classList.toggle("hide", !ME.can.export);
  $("faud").classList.toggle("hide", !ME.can.audit);
  $("s-cnic").disabled = !ME.can.cnic_search;
  $("s-cnic").placeholder = ME.can.cnic_search ? "42101-1234567-1" : "Not available for your role";
  fillFilters(F.j && F.j.ok ? F.j : null);
  loadSummary(); loadList(true);
  return true;
}
async function showAudit() {
  clearErr();
  const R = await api("admin/audit?limit=50"); if (gone(R)) return;
  if (!R.j || !R.j.ok) { fail(R.j && R.j.message || "Failed."); return; }
  const L = $("rb"); L.textContent = "";
  okMsg("Latest audit entries (" + R.j.total + " total)");
  R.j.entries.forEach(e => { const tr = pvEl("tr"); const td = pvEl("td", "", new Date(e.at).toLocaleString() + " | " + (e.admin_username || "-") + " | " + e.action + (e.target_id ? " | " + String(e.target_id).slice(0, 8) : "")); td.colSpan = 12; tr.append(td); L.append(tr); });
  $("pager").textContent = "";
}

// ---------- wiring ----------
function clearAll() {
  SEARCH_IDS.forEach(id => { $(id).value = ""; });
  ["f-level", "f-desig", "f-wing", "f-status", "f-from", "f-to"].forEach(id => { $(id).value = ""; });
  $("f-prov").value = ""; fillDist(); markCards(); loadList(true);
}
$("unlock").onclick = async () => { $("pwm").textContent = ""; const R = await api("admin/login", { method: "POST", json: { username: $("un").value, password: $("pw").value } }); if (R.j && R.j.ok) { $("pw").value = ""; if (!(await enter())) $("pwm").textContent = "Could not start the session."; } else $("pwm").textContent = R.j && R.j.message || "Could not reach the server."; };
$("pw").onkeydown = e => { if (e.key === "Enter") $("unlock").click(); };
$("un").onkeydown = e => { if (e.key === "Enter") $("pw").focus(); };
$("flo").onclick = async () => { await api("admin/logout", { method: "POST", json: {} }); showLock("Signed out."); };
$("frf").onclick = () => { loadList(false); loadSummary(); };
$("faud").onclick = showAudit;
$("s-go").onclick = () => loadList(true);
$("s-clear").onclick = clearAll;
SEARCH_IDS.forEach(id => { $(id).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); loadList(true); } }; });
["f-level", "f-desig", "f-wing", "f-status", "f-from", "f-to", "f-tal"].forEach(id => { $(id).onchange = () => { if (id === "f-status") markCards(); loadList(true); }; });
$("f-prov").onchange = () => { fillDist(); loadList(true); };
$("f-dist").onchange = () => { fillTalFilter(); loadList(true); };
document.querySelectorAll(".stat").forEach(b => b.addEventListener("click", () => setStatus(b.dataset.status)));
$("x-all").onclick = () => downloadExcel("all");
$("x-filt").onclick = () => downloadExcel("filtered");
$("x-res").onclick = () => downloadExcel("search");
$("x-print").onclick = printList;
$("x-pdf").onclick = pdfReport;
