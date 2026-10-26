# NPCIH-A Modern Government Portal redesign

## Scope
This change introduces a new visual layer for the existing NPCIH-A HRC Wing Sindh membership portal. It intentionally keeps the existing static HTML application and serverless API architecture.

## Design system
- Midnight navy: `#122B49` for institutional navigation and headings.
- Teal: `#087E72` for primary actions and focus states.
- Cool grey: `#F3F6FA` for the page canvas.
- Muted gold: `#C6A15B` for restrained identity accents.
- Responsive cards, accessible focus rings, 16px form controls, and reduced-motion support.
- Dark mode follows the device color-scheme preference.

## UI changes
- Added restrained animated teal/gold ambient orbs, a moving header sheen, a top scroll-progress indicator, and layered institutional surfaces.
- Added four visual form sections: personal details, organisation, address/contact, and photograph.
- Restyled form controls, photo selection, submit/PDF/WhatsApp actions, and validation messages.
- Added a secure administration intro panel and refreshed the login and member management surfaces.
- Added mobile-first single-column layouts and larger touch targets.
- Uses CSS perspective, pointer-aware 3D tilt, and lightweight JavaScript reveal/hover motion without adding an animation-library dependency; the legacy Three.js canvas stays dormant.

## Compatibility constraints
- Existing form field IDs are preserved.
- Existing event handlers, API routes, Supabase schema, auth/session implementation, access control and PDF drawing code are not intentionally changed.
- Existing admin actions (search, filters, summary, CSV export, audit log and sign out) remain the controls wired by the original application.
- The existing form still decides when a save has succeeded; the visual layer does not fake a success response.

## Validation status (2026-10-26)
- GitHub Actions: **passed** on the redesign branch (JavaScript syntax check + API regression suite).
- API regression suite: **156 passed, 0 failed** against the in-memory Supabase mock. This does not prove live Supabase/RLS configuration.
- Vercel preview: build **READY** at `https://npciha-membership-p1omo50jq-zs-dc21.vercel.app` for commit `af7fe37d9e6ad5461951341f070ff124f13d826a`. The project has Vercel SSO protection enabled for preview deployments.
- The preview build completed; interactive browser checks against the real Supabase service have not been performed.

## Validation checklist
Before merging or deploying:
1. Confirm the GitHub Actions `Verify NPCIH-A redesign` workflow remains green.
2. Confirm `/api/health` reports the expected service status without exposing secrets.
3. Test a valid registration and duplicate-CNIC response against a configured Supabase project.
4. Confirm the application reference and exactly two-page PDF are generated only after a successful save.
5. Test WhatsApp and re-download actions after a saved record.
6. Test each admin role, district scoping, masked CNIC for operators, and prohibited actions.
7. Verify mobile layout, keyboard focus, reduced-motion settings, and light/dark mode.
8. Verify the deployed preview before merging to the production branch.

The UI-only changes do not themselves establish that the real Supabase deployment, security configuration, or legal compliance has been verified.
