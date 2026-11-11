# Changelog

## 2026-11-11 - Separate downloads: form only and photo only
- Success page (after Submit): new buttons "Download Form only" (single-page membership form PDF) and "Download Photo only" (passport photo as JPG). The existing full PDF (form + photo page) is unchanged.
- Admin member list: new buttons "فارم" (form only) and "تصویر" (photo only) next to "PDF"; the application preview header also has Form and Photo buttons.
- pdf(m, "form") builds page 1 only; no server, database or API change.

## 2026-11-10 - WhatsApp removal audit
- Audited the whole repository (public/, api/, lib/, sql/, docs/, tests/, vercel.json, package.json), git history, Vercel environment variable names and the Supabase schema. No WhatsApp share link, redirect, API/Cloud API/Business API call, webhook, automation, npm package, environment variable, database column or stored number remains in the active application.
- The WhatsApp share button and the stored WhatsApp number were already removed earlier (commit 350f4a1 and the pull request before it).
- Added an automated guard test: the test suite now fails if WhatsApp, wa.me, Twilio or similar references reappear in public/, api/ or lib/, or if such a package is added to package.json.
- Recovery point: git tag `backup-before-whatsapp-removal-2026-11-10` (restore with `git checkout backup-before-whatsapp-removal-2026-11-10`).
- No member records, photos, PDF logic, Google Sheets sync, admin accounts or Vercel variables were changed or deleted.

### Pending manual actions (outside this repository)
- Delete old Vercel deployments made before the WhatsApp removal (Vercel > npciha-website > Deployments). Keep the current production deployment.
- Check Google Apps Script (script.google.com) triggers and the Google Sheet for any old WhatsApp number or script.
- In WhatsApp itself: remove unknown Linked devices, turn on two-step verification, switch off Business auto-reply/greeting if not wanted.

## 2026-11-09
- Admin: added "Change photo" for members (server PATCH accepts a photo; UI preview, confirm, cancel; tests).
- Removed obsolete WhatsApp number and sharing documentation.
