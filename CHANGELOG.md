# Changelog

## 2026-11-12 - Advanced member search, filters, statistics and exports (admin)
- Search boxes (each one narrows the list, all combined): Member Name, CNIC (authorised roles; 13 digits with or without dashes), Mobile (any common format: 03XX..., +92..., 0092...), Application No. (full or partial). Short inputs are refused with a message (names 2+ letters, application no. 3+, CNIC 4+ digits, mobile 7+ digits).
- Filter dropdowns, all combined with AND: Province, District, Taluka, Office Level, Designation (values taken from the database), Wing, Application Status, Registered from / to dates.
- Taluka matching: a member matches a taluka by taluka id, or, when the id is empty, by the typed taluka name inside the same district. Names are compared ignoring case, spaces, punctuation and a leading "Taluka"/"Tehsil" (so "TANGWANI", "Kandh kot" and "Taluka Kashmore" are found under their taluka).
- Results table: serial number, application no., name, CNIC, mobile, district, taluka, designation, office level, status, application date, and actions (View Details, View PDF, Form only, Photo only, More). Pagination with 25/50/100 per page. Phones show each record as a labelled card.
- Statistics cards (Total, Approved, Pending, Rejected) are clickable and show their records.
- Exports (Excel .xlsx, same filters as the screen): All Members, Filtered Members, Search Results. Print Member List and Download PDF Report use the same filters. Exports above 5000 records are refused with a message instead of being cut short. CNIC is masked for roles that may not see it; data entry staff cannot export.
- Admin page code moved from index.html to public/admin.js and public/admin.css. The member form and its PDF are unchanged.
- API: new actions facets and export; members accepts name, cnic, mobile, ref, province_id, office_level, designation, wing, status, date_from, date_to, taluka_id, district_id, limit, offset. Export and search are written to the audit log without personal values.
- Tests: 52 new offline API tests (npm test: 282 passing) and a browser test of the admin page (npm run test:ui: 29 passing, desktop and 390px phone).
- No database change. Backup taken before the work: schema backup (backup.members_2026_11_12, talukas, districts, provinces: 32 members at backup time). Photos are in the private bucket and were not touched.

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
