# EMS-IPAM checkpoint — 2026-10-10 — Settings/Inventory device flow

Branch: work/i18n-personnel-foundation; main remains unchanged.

Changes:
- Settings > General now provides role-aware shortcuts to Inventory and Device Types, restoring a direct path to add/edit devices and types without duplicating editors.
- Inventory's create flow checks the live address-space data and rejects an already registered IP rather than silently opening the existing record for overwrite.
- The create wizard disables submission when no address spaces are available and explains the requirement.
- New messages use English canonical keys and Persian localization.
- Added focused regression tests and a Playwright/Chromium browser job to CI, using the existing isolated PGlite integration suite.

Validation:
- CI Node and browser jobs must be checked after this commit; no claim of passing browser tests yet.
- Existing browser suite exercises device creation/editing, device-type rename and deletion safeguards, plus Settings opening.

Next:
- Inspect CI failures and repair them if needed.
- Add explicit browser duplicate-IP and Settings-shortcut checks when the browser suite can be updated safely.
- Continue Inventory form English-first migration and device validation.
