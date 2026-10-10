# EMS-IPAM checkpoint — 2026-10-10 — device workflows and green browser CI

Branch: work/i18n-personnel-foundation. Main remains unchanged.

Completed:
- Settings General offers permission-aware shortcuts to Inventory and Device Types.
- Inventory create refuses an already registered IP instead of silently opening an edit.
- Create wizard handles missing address spaces.
- English/Persian translation keys cover the new controls and errors.
- Legacy i18n no longer translates substrings inside English user-entered device names.
- Updated legacy assertion to reflect the guarded create path.
- Added Chromium browser integration as a required CI job.

Validation (commit 1864541d115ab8c38d2004ae0c1838b6ae8ddac5):
- GitHub Actions: https://github.com/emsebi/EMS_IPAM/actions/runs/38023895883
- Node 22: 75 tests passed, 0 failed.
- Playwright/Chromium + isolated PGlite: 11 browser/API scenarios passed.
- Browser suite verifies actual device type create/rename/delete safeguards, Inventory device create/edit, AP/Station selection, personnel, Settings opening, and viewer access.
- New duplicate-IP guard and Settings shortcuts have focused static regression tests; dedicated interactive browser checks for these two new paths remain a follow-up.
- Production PostgreSQL, real hardware and manual deployment have not been tested here.

Next:
- Add dedicated browser checks for duplicate-IP and Settings shortcuts.
- Continue English-first migration of Inventory and device-type editors.
- Investigate remaining Settings/device issues reported by user with browser evidence.
