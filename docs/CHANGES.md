# Changes made

## Original project (as received)
`index.html` (single file, ~700 KB with embedded images) + `vercel.json` (`cleanUrls` only). No backend.
Problems found:
1. **Admin password check ran in browser JavaScript** (a SHA-256 hash was embedded in the page; anyone could read it, brute-force it, or bypass it by editing the page).
2. **Records were stored with `claude.use("db")`**, which only works inside claude.ai. On Vercel nothing was saved, so the admin list was always unavailable. The old code even continued to generate a PDF showing a reference number that was never stored.
3. Reference numbers were derived from the clock (`Date.now()`), not unique or sequential.
4. No duplicate-CNIC protection, no server validation, photo stored as base64 inside the record.
5. No security headers, no rate limiting, no audit trail.

## Front end: what changed (`public/index.html`)
Design is untouched. Only script logic and the *admin* panel were edited; the public form markup, CSS, header, images, 3D background, form-drawing code and PDF layout code are byte-identical (verified, see TEST-REPORT).

| Change | Why |
|---|---|
| Submit now POSTs to `/api/register`; the PDF is created only after the server confirms the save, using the **saved** values and server reference number. Failures show a clear "Not saved…" message and keep typed data. | Requirement: never report success unless the database confirmed it. |
| Client-side CNIC and mobile checks before submit; photo type/size check when choosing a file. | Early, clear errors (server re-validates everything). |
| One per-page "submission token" (new one when the CNIC field is edited) so a double-tap or retry cannot create two records. | Duplicate-submission prevention. |
| Removed `claude.use("db")` storage and the embedded password hash / client-side password check. | Insecure / non-functional on Vercel. |
| Admin login: added **Admin Username** box (same style as the password box) and password is verified by the server. | Needed for real accounts and roles. This is the only visible change on the login panel. |
| Admin panel: search box, district/taluka/status filters, Summary, Export CSV, Audit log, Sign out, and per-row **Manage** (approve/reject, district/taluka, edit field, delete). Built only with the page's existing classes (`.btn.o`, `.row`, `.m`, `.msg`, inputs/selects). | Requested admin features. These live inside the previously plain admin list; the public form is unaffected. |
| PDF: `if(m.photo)` guard before `addImage`. | Avoids a crash if a record has no photo. Layout unchanged. |
| `claude` stub line kept; `save()` unchanged (falls back to `d.save`). | Preserve behaviour. |

## Not on the public form (design preserved)
District and Taluka are **not added to the public form** (that would change the form design). A Super Admin assigns them in the admin panel.
If you later want them on the form, say so and it can be added deliberately as a design change.

## New backend
* `api/register.js`: validate, rate-limit, duplicate check, photo to private bucket, insert, rollback of the photo on failure, idempotent retries.
* `api/admin/[action].js`: login, logout, me, districts, members (search/filter/paging), member (view/edit/delete), status, summary, audit, export. One function so the free Vercel plan's function limit is not an issue.
* `api/health.js`: connection/config check. `api/setup.js` + `public/setup.html`: token-gated admin creation (no default passwords exist).
* `lib/`: dependency-free Supabase REST/Storage client, auth (scrypt, sessions), validation, role permissions.
* `sql/001_schema.sql`: schema, constraints (unique CNIC, format checks), sequence-based reference numbers, RLS on every table with no public policies, revoked public privileges, rate-limit and summary functions, private storage bucket.
* `sql/002_seed_sindh_districts.sql`: editable district data (talukas intentionally empty).
* `vercel.json`: output directory, function timeout, security headers incl. CSP.
* `.env.example`, `.gitignore`, `README.md`, tests.

## Removed (and why)
* Client-side password hash and check: replaced by server auth.
* `claude.use("db")` persistence: not available outside claude.ai; replaced by Supabase.
* Reference format `NPCIHA/YYYY/<last 6 digits of timestamp>` replaced by `NPCIHA/YYYY/<6-digit database sequence>` (same shape, guaranteed unique).

## Province, district and taluka selection (migration 003 + seed 004)
* Registration form: Province (Sindh, read-only), searchable District and Taluka fields. Taluka loads only after a district is chosen and is cleared when the district changes.
* New public read-only APIs: `GET /api/provinces`, `GET /api/districts?province_id=`, `GET /api/talukas?district_id=`. They return active records only; talukas are returned only when `verified = true`.
* `/api/register` now requires a valid district (and a taluka when the district has verified talukas). The server checks that the district belongs to the province and the taluka belongs to the district.
* Database: `provinces` table; `districts.province_id`; `talukas.verified`, `talukas.source`; `members.province_id`. Existing rows and data are kept.
* Talukas are imported from a secondary source (Wikipedia, "List of tehsils of Sindh") with `verified = false`, so they are NOT shown to applicants until each one is checked against an official Government of Sindh / Board of Revenue source and set to `verified = true`.
* Karachi districts have no talukas (their sub-units are towns), so a taluka is not required there.

## Taluka as free text (migration 005)
* The taluka field on the registration form is now a plain text box. The applicant types the taluka name; it is stored in `members.taluka_name` (max 100 characters, letters only).
* The taluka list is no longer required on the public form. Talukas in `public.talukas` remain for the admin panel.
