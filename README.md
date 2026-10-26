# NPCIH-A Sindh Membership Website

Your original website (same design, logo, Urdu text, form and PDF) now saves registrations to a
central **Supabase PostgreSQL** database through secure **Vercel** serverless APIs, with a
server-protected admin area.

```
public/            the website (index.html = your original page, minimally wired to the API)
public/setup.html  one-time page to create admin accounts (works only while SETUP_TOKEN is set)
api/               server code (register, health, setup, admin/*)
lib/               server helpers (Supabase client, auth, validation)
sql/               001_schema.sql (tables, security, private bucket), 002_seed_sindh_districts.sql
docs/              CHANGES.md, TEST-REPORT.md
tests/             offline test suite (optional, not needed for deployment)
```

No `npm install` is needed: the server code has **zero dependencies**.

---

## 1. Accounts you need (all have free plans)
1. **GitHub** (github.com) holds the code.
2. **Supabase** (supabase.com) holds the database and private photos.
3. **Vercel** (vercel.com) hosts the website. Sign up with your GitHub account.

> Tip on Android: if a site looks cramped, in Chrome tap ⋮ → **Desktop site**.
> Check Vercel's and Supabase's current plan terms. Vercel's free "Hobby" plan is for non-commercial use,
> and free Supabase projects can be paused after a period of inactivity. For a live organisation you may prefer paid plans.

## 2. Supabase project
1. Supabase → **New project**. Choose a name, a **strong database password** (save it somewhere safe; this app does not need it), and a region close to Pakistan (e.g. Mumbai or Singapore). Wait until it finishes starting.
2. **Keep the project private.** Do not enable anything else; this app uses only the server key.

## 3. Install the database
1. In GitHub (after step 5) or from the unzipped files, open `sql/001_schema.sql`. On GitHub tap the file → **Copy raw file** (icon at top right of the file).
2. Supabase → **SQL Editor** → **New query** → paste → **Run**. You should see "Success. No rows returned".
3. Repeat with `sql/002_seed_sindh_districts.sql` (adds the Sindh district list).

This creates: members, districts, talukas, admins, sessions, audit log, rate-limit tables; unique CNIC constraint;
**Row Level Security enabled with no public policies** (the public/anon key can read nothing); and the
**private** storage bucket `member-photos` (not public, JPEG only, 512 KB max). No manual bucket setup is needed.

After running it, check **Supabase → Advisors → Security Advisor**: there should be no "RLS disabled" warnings on these tables,
and **Storage → member-photos** must say *Private*.

### Adding districts and talukas (no code)
Supabase → **Table Editor** → `districts` or `talukas` → **Insert row**. For a taluka, `district_id` is the number in the `districts` table.
Set `active` to false to hide an entry. The admin screens read these tables automatically.
Talukas are intentionally **not** pre-filled (no unverified list), so add the ones you need.

## 4. Get the two Supabase values
Supabase → **Project Settings → API** (or **API Keys**):
* **Project URL** → `SUPABASE_URL`
* **service_role** key (or the new **Secret key**, `sb_secret_...`) → `SUPABASE_SERVICE_ROLE_KEY`

Never share the service key, never paste it into the website files or into GitHub. It lives only in Vercel.

## 5. Put the project on GitHub (from an Android phone)
**Option A. GitHub Codespaces (recommended: handles the ZIP for you)**
1. GitHub → **+** → **New repository** → name e.g. `npciha-site` → **Private** → Create.
2. On the repo page: **Code → Codespaces → Create codespace** (opens VS Code in the browser).
3. In the Explorer panel, use ⋮/right-click → **Upload…** and select `npciha-vercel-secure.zip`.
4. Open the Terminal (☰ → Terminal → New Terminal) and type:
   ```
   unzip -o npciha-vercel-secure.zip && rm npciha-vercel-secure.zip
   git add -A && git commit -m "NPCIHA site" && git push
   ```
   (If the ZIP unpacked into a sub-folder, move its contents to the repository root so `vercel.json` sits at the top.)

**Option B. Upload files by hand (slower)**
Android cannot upload whole folders, so create the folders first: repo → **Add file → Create new file**, type
`api/admin/.gitkeep` as the name (typing `/` creates folders), Commit. Do the same for `public/.gitkeep`, `lib/.gitkeep`, `sql/.gitkeep`.
Then open each folder and use **Add file → Upload files** to upload that folder's files (keep exact names, including `[action].js`).
Root files: `package.json`, `vercel.json`, `.gitignore`, `.env.example`, `README.md`. You may skip `tests/` and `docs/`.

**Never upload a file containing real keys.** The project has none; `.gitignore` blocks `.env` files.

## 6. Deploy on Vercel
1. Vercel → **Add New… → Project** → **Import** your GitHub repo.
2. **Framework Preset: Other.** Leave Build/Output settings alone (`vercel.json` sets them).
3. Open **Environment Variables** and add (Production, Preview and Development):

| Name | Value |
|---|---|
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your service/secret key |
| `APP_SECRET` | any long random text (24+ characters) |
| `SETUP_TOKEN` | temporary random text (20+ characters); used in step 8 |

4. Tap **Deploy**. When finished, open the address Vercel gives you (e.g. `https://npciha-site.vercel.app`).

Optional: `REGISTER_RATE_MAX` (default 30 registrations per hour per network; raise it if one office registers many people from one connection) and `ADMIN_SESSION_HOURS` (default 8).

## 7. Verify the database connection
Open `https://YOUR-SITE.vercel.app/api/health`. You should see `"ok": true`, `"database": "ok"`, `"storage_bucket": "ok"`, `"districts_loaded": true`.
If not, see Troubleshooting. (This page shows only yes/no status, never keys.)

## 8. Create the first administrator
1. Open `https://YOUR-SITE.vercel.app/setup`.
2. Enter your **SETUP_TOKEN**, a username (lowercase), a password of **12+ characters**, role **Super Admin**, and tap the button.
3. **Then remove `SETUP_TOKEN`** in Vercel → Settings → Environment Variables and **Redeploy** (Deployments → ⋮ → Redeploy). Setup is then disabled.
4. To add more people later, set a new `SETUP_TOKEN`, redeploy, use `/setup`, then remove it again. Using an existing username **resets that password** and signs the person out everywhere.

Roles:
| Role | Can do |
|---|---|
| **Super Admin** | everything: all districts, assign districts/talukas, approve/reject, edit, delete, export, audit log, full CNIC |
| **District Admin** (needs district code, e.g. `hyderabad`) | own district only: view, search (incl. CNIC), edit, approve/reject, export |
| **Data Entry Operator** (needs district code) | own district only: view and correct details; CNIC is masked; cannot approve, export or delete |

Use a unique strong password per person; also turn on 2-step verification for your GitHub, Supabase and Vercel accounts.

## 9. Using the site
* **Public form** works exactly as before. A registration is reported as saved **only after** the database confirms it; the PDF is made from the saved record and carries the server-issued reference (`NPCIHA/2026/000001`).
* **Admin** (button at bottom right): sign in with username + password. Search by name / reference / CNIC, filter by district, taluka, status; **Summary**, **Export CSV**, **Audit log**, **Sign out**; per record **View**, **PDF**, **Manage** (approve/reject, district/taluka, edit a field, delete with double confirmation).
* New registrations have **no district**, because the original form has no district field (design preserved). A Super Admin assigns district/taluka under **Manage**; from then on that district's admins see the record.
* The PDF is the application form exactly as before. It is not a membership certificate, and approval status is not printed on it.

## 10. Troubleshooting
| Symptom | Fix |
|---|---|
| `/api/health` says `not_configured` / config false | Add the missing env variable in Vercel, then **Redeploy** (changes apply only to new deployments). |
| `database: error` | Wrong `SUPABASE_URL`/key (no spaces, no quotes), or `001_schema.sql` was not run, or the Supabase project is paused (Supabase → Restore). |
| `rate_limit_function: error` | Re-run `sql/001_schema.sql`. |
| `storage_bucket: missing` | Re-run `sql/001_schema.sql` (it creates the bucket). |
| Form says "Not saved… database temporarily unavailable" | Open `/api/health`; fix as above. Your typed data stays on the page. |
| "A registration with this CNIC already exists" | Working as intended. Find the record in Admin (search the CNIC) and edit/delete it if it was entered wrongly. |
| Cannot sign in | Check username (lowercase). After 5 wrong passwords an account locks for 15 minutes. Reset the password through `/setup`. |
| `/setup` says disabled | `SETUP_TOKEN` is not set (or needs a redeploy). |
| 404 on `/api/...` | Repo root must contain `vercel.json`, `api/`, `public/` (not inside an extra folder). |
| Admin list empty for a district admin | Records need a district assigned by a Super Admin. |

## 11. Security notes
* Passwords: scrypt with per-user salt. Sessions: random token in an `HttpOnly; Secure; SameSite=Strict` `__Host-` cookie; only a hash is stored; revocable; 8 h default.
* All admin API calls check the session on the server; roles are enforced on the server.
* The service key exists only in Vercel's environment. Row Level Security denies the public key everything.
* Photos are in a **private** bucket and are only returned to signed-in admins through the API.
* Server-side validation of every field; photos limited to JPEG ≤ 350 KB with magic-byte and size checks.
* Rate limits (database-backed): registration, login, setup; account lockout.
* Logs avoid CNICs, passwords and tokens; the audit log stores field names and masked CNICs only.
* This project makes **no claim of legal/privacy-law compliance**. Have that assessed (data retention, consent notice, who may access data) before going live.

See `docs/CHANGES.md` and `docs/TEST-REPORT.md` for exactly what changed and what was tested.


## WhatsApp and PDF behavior (configured)
- Membership PDF is generated as exactly two pages: page 1 is the completed form; page 2 is the member photo with name and application number.
- The Share on WhatsApp button opens the administrator chat at `923336305884` and pre-fills only the member name and application number. The member must press Send. The PDF is not attached to WhatsApp.
- The application must first be saved successfully by the backend before the WhatsApp action becomes available.

## Optional: mirror new applications to Google Sheets

Supabase remains the authoritative database. When configured, each newly submitted application is also appended to a private Google Sheet. A Google Sheets outage does not block the registration, and the row is not a substitute for the database.

1. In Google Cloud Console, create/select a project and enable **Google Sheets API**.
2. Create a **Service Account** and generate a JSON key. Keep the JSON private; never commit it to GitHub or place it in front-end code.
3. Create a Google spreadsheet and add a tab named **Applications** (or choose another tab name).
4. Share the spreadsheet with the service account's `client_email` as **Editor**. Do not turn on public sharing.
5. In Vercel → Project → Settings → Environment Variables, add:
   - `GOOGLE_SHEETS_SPREADSHEET_ID`: the long ID from the spreadsheet URL between `/d/` and `/edit`.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the complete contents of the downloaded service-account JSON file, as one JSON value.
   - `GOOGLE_SHEETS_TAB_NAME`: `Applications` (must match the tab name).
6. Apply to Production (and Preview if needed), then redeploy Vercel.
7. Submit a test application. The first row is created as column headings; subsequent new applications are appended.

The sheet includes application reference/date, applicant details and location IDs/taluka. It does not copy the uploaded photo. The spreadsheet contains personal information such as CNIC, so keep sharing restricted to authorized staff only. If the sync fails, the registration still remains saved in Supabase; check Vercel Function Logs for a `Google Sheets sync failed` message.

