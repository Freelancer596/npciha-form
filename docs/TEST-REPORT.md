# Test report

Environment used for testing: sandbox with **no internet access**, Node 22, headless Chromium.
Therefore **no real Supabase project, no real Vercel deployment, and no real jsPDF/three.js CDN were available**.
Tests marked MOCK ran the real server code against an in-memory stand-in for Supabase's REST/Storage API
(`tests/mock-supabase.js`). A pass there proves the application logic, **not** that the SQL runs or that RLS behaves on real Supabase.

## A. Actually executed and passed

### A1. API logic vs MOCK Supabase: `node tests/run-tests.js` → 140 passed, 0 failed
Registration: valid save with reference no.; row + private photo stored; duplicate CNIC rejected (also when typed without dashes); idempotent retry; simultaneous double-submit → one record, no orphan photo; 19 invalid inputs rejected and not saved (names, CNIC, phone, e-mail, DOB, religion, wing, address length, missing/oversize/PNG/text-as-JPEG photo, >600 KB body, HTML in name); wrong method; cross-site origin; malformed body.
Failures: DB insert failure, storage failure, total outage, missing configuration → clear 503 messages with no internals, no false success, no orphan photo; recovery afterwards.
Auth: setup token required; weak password rejected; passwords stored only as scrypt hashes; unauthenticated access to every admin endpoint → 401 with no data; CSRF-style requests refused; cookie flags; forged cookie; logout revokes server-side; session expiry; lockout after 5 failures; login/registration rate limits (429).
RBAC: district scoping (list, detail by id, edit, approve, widening via query string), taluka/district consistency, data-entry masking of CNIC, no CNIC search/approve/export/delete for roles without permission, audit restricted to Super Admin.
Features: district, taluka, status, date, name, reference and CNIC search/filters; filter-injection attempt neutralised; approve/reject recorded with reviewer; edits validated (duplicate CNIC 409; attempts to overwrite status/ref/photo rejected); summary totals and district-wise counts; CSV export (BOM, filter, formula-injection neutralised, role-limited); delete requires confirmation and removes photo; audit log content and absence of full CNIC/password/token.
Secrets: front-end assets and project source contain no service key, JWT or `sb_secret_` string.

### A2. Browser UI flow (Chromium, MOCK Supabase, **jsPDF replaced by a stub**) → 30 passed, 0 failed
Page loads under the production CSP headers with no violations; frontend CNIC/phone/photo errors; DB outage shows "Not saved" and keeps typed data; success only after DB confirmation; PDF code path invoked with saved record and photo (stub, see B); double-submit creates no second record; duplicate CNIC error; admin login/logout, session resume after refresh, no data visible before login; assign district/taluka; district filter; approve with confirm; View renders the form canvas from DB data; summary; audit log; CSV download; data-entry UI (masked CNIC, hidden export/audit).

### A3. Design preservation (original vs updated page, Chromium)
IDENTICAL byte-for-byte: entire `<style>`, `<header>`, the whole membership form card (fields, order, labels, Urdu), 3D background script, `drawForm()` coordinates/fonts, CDN includes, all three embedded images, Admin button; `pdf()` layout code identical except the null-photo guard.
IDENTICAL output: the rendered membership-form canvas for the same dummy data.
Screenshot of the public form (390×844): updated page matched the original with **0 differing pixels** on a repeat run; one run showed 21–24 differing pixels in a 2 px column, but the **original page differs from itself by the same amount** between runs, so that is renderer noise, not a change.
Intentionally different: the Admin panel (username box, toolbar, Manage buttons), listed in CHANGES.md.

## B. Not verified here: needs your deployment or credentials
| Item | How to verify |
|---|---|
| SQL files executed on real PostgreSQL (syntax, constraints, functions) | They were **not run**; no Postgres available. Run `sql/001_schema.sql` in Supabase; it is idempotent and any error is shown. |
| Real Supabase connection, Storage upload, signed access | Open `/api/health`, then register a dummy member and check Table Editor + Storage. |
| RLS / anonymous cannot read records; bucket is private | By design (RLS on, no policies, privileges revoked, bucket `public=false`) but **not tested live**. Check Supabase → Advisors → Security and Storage → member-photos = Private. |
| Vercel build/deploy, dynamic route `api/admin/[action].js`, headers | No Vercel build was possible. There is no build step and no dependencies, and all files pass `node --check`; confirm after deploy. |
| Real PDF output via jsPDF and three.js background | CDN unreachable offline. jsPDF was stubbed (A2), so actual PDF file layout/Urdu rendering was **not** inspected here. The code that composes the PDF is unchanged from your original. |
| Android phone behaviour (file picker/camera, downloads) | Test on your device. |
| Load/performance, Supabase limits | Not tested. |

## C. Known behaviours / limitations
* Pre-existing: page 1 of the PDF writes the member's name with jsPDF's default font, which cannot draw Urdu/Arabic letters. (The names are accepted, since Unicode letters are allowed.) The form page, which is drawn as an image, uses the system font. Changing this would alter the PDF, so it was left as-is.
* CDN scripts (three.js, jsPDF) have no integrity hashes (as in the original); the CSP limits them to cdnjs.
* Public duplicate-CNIC message confirms that a CNIC is already registered (needed so applicants understand the rejection); rate limits reduce abuse.
* Rate limits are per network address; offices behind one connection may need a higher `REGISTER_RATE_MAX`.
* A rejected applicant's CNIC stays reserved until an admin edits or deletes the record.
* Export capped at 5,000 rows per file. Hard delete only (audit entry keeps reference and masked CNIC).
