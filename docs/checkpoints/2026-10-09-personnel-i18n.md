# EMS-IPAM checkpoint — 2026-10-09 — Personnel i18n

- Branch: `work/i18n-personnel-foundation`.
- Added explicit `data-i18n` and `data-i18n-placeholder` support for stable DOM translation keys.
- Personnel dialog source is now authored in English, including Employee Code and Full Name labels.
- Personnel dynamic list/actions/validation/toasts/CSV import messages now use `personnel.*` / `common.*` keys.
- English remains the base/fallback; Persian values live in `fa.json`.
- Added regression tests specifically for Employee Code and Full Name in English/Persian and for absence of Persian hard-coded text in the Personnel dialog.
- Next: Settings dialog migration and remaining hard-coded Persian inventory.
