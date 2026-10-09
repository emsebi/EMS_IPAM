# EMS-IPAM checkpoint - 2026-10-10 - green CI and i18n exact keys

Branch: work/i18n-personnel-foundation. Main unchanged.

Completed:
- Fixed outdated security regression: assert running server does not import legacy secrets helper.
- Fixed radio regression to expect semantic translation key rather than Persian source literal.
- Added exact semantic-key translator with English fallback for missing or blank localization.
- Kept legacy phrase translation for unmigrated UI.
- Wired exact translator into app.js for semantic-key UI.
- Added tests for interpolation, unknown keys, fallback, and app wiring.

Validation:
- Node 22 CI: 71 tests passed, 0 failed.
- https://github.com/emsebi/EMS_IPAM/actions/runs/37998899021
- Browser and production deployment tests remain outstanding.

Next package:
- Reproduce and fix Settings/Inventory device create/edit defects using browser tests.
- Continue English-first migration for device forms.
- Keep commits small and check CI before closing each package.
