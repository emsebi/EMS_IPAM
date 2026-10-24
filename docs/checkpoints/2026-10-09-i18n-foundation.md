# EMS-IPAM checkpoint — 2026-10-09 — i18n foundation

- Branch: `work/i18n-personnel-foundation` (no changes to `main`).
- Converted `en.json` to canonical English keys and `fa.json` to matching Persian translations.
- Preserved the old Persian-source strings in `legacy-fa.json` so existing hard-coded Persian UI continues to render in English.
- Added `i18n-core.mjs` with single-pass phrase matching, English fallback, and test coverage.
- Updated `app.js` to load canonical packs and remember untranslated DOM text/attributes for safe repeated translation.
- Scope: language infrastructure only; this does **not** claim all hard-coded UI strings or modules are fully migrated.
- Validation before commit: 10 bilingual phrase checks, missing-translation fallback, catalog key parity, and app migration anchors.
- Next package: migrate one UI module to explicit stable translation keys and cover its dynamic UI strings.

Run full project tests in a Node >=22 checkout with `cd docker-app && npm test`; full suite was not executed in this connector-only run.
