# EMS-IPAM checkpoint — 2026-10-10 — Inventory validation coverage

Branch: work/i18n-personnel-foundation. Main unchanged.

Baseline: c9bd943d751fd6cb1c7963b753f0f44c32cf8c0d.

Completed:
- Added docs/checkpoints/2026-10-10-browser-regression-plan.md with acceptance checks for the duplicate-IP create wizard, out-of-range IP, and Settings shortcuts.
- Added docker-app/tests/inventory-translation-coverage.test.mjs. It asserts that all three Inventory creation errors have nonempty, distinct English and Persian values.
- The new test is included automatically in npm test via tests/*.test.mjs.

Verified:
- GitHub Actions run 38067361890 succeeded for commit 3406aea22ef933fd15db049993151122564cf49f.
- Both Node.js and Playwright browser jobs completed successfully.
- The existing browser suite still covers 11 scenarios. The dedicated interactive duplicate-IP/Settings cases were NOT added in this run.

Remaining:
- Add dedicated browser interaction checks for duplicate-IP and Settings shortcuts; attempts to write the expanded browser suite through the GitHub connector were rejected, so no claim of new browser coverage is made.
- Continue Inventory English-first UI migration and validate new/edit flows on real PostgreSQL before release.
- Production deployment and live hardware are untested.

Next continuation should start from this branch head and avoid repeating the Inventory translation test.
