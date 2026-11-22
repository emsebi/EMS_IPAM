# Read-only installed Import evidence

PR #90 adds a backend Portable JSON preview route and a shared browser/server format classifier. An older UI-only deployment can show the Import dialog while lacking the required backend or `/ipam-import-format.mjs`. A healthy `/health` response alone cannot establish compatibility.

`scripts/import-installed-check.py` compares nine explicitly listed Import source/dependency files with their hashes in the running app container. It also compares the delivered HTML, app JavaScript and shared classifier with the reference checkout. Requests are fixed, unauthenticated GETs to `127.0.0.1:8888`; redirects are not followed and response size/time are bounded. App container ID, immutable image digest, start time and restart count are captured before and after observation. Only these selected identity fields and hashes are emitted, never file contents, environment variables or command errors.

This diagnostic does not read DB credentials, RADIUS files, users, NAS collections or secrets; it does not query application tables, log in, preview/commit an import, scan a device, build an image, change a container, migrate, restart or deploy. `/health` performs the application's existing `SELECT 1`. Its local tests use temporary synthetic files and mocked Docker/HTTP boundaries.

On the authorized VM runner, using a reviewed checkout:

```sh
python3 scripts/import-installed-check.py --source-root "$PWD" --source-sha "$GITHUB_SHA"
```

The supplied full SHA identifies the reference checkout, **not the installed system**. The workflow uses its own checked-out `GITHUB_SHA`. The checker always reports `deployed_sha: null`, `runtime_backend_verified: false` and `acceptance: pending`.

| Result | Exit | Meaning |
| --- | --- | --- |
| `blocked` | 2 | Health/identity unavailable or changed, an unreadable/missing file, or any hash mismatch. Do not roll out based on this evidence. |
| `files_match_runtime_unverified` | 0 | These observed files and served assets match, health responds ready, and the two app identity observations agree. Already-loaded Node code and the complete installed tree remain unverified. |
| `invalid_reference` | 2 | The reference SHA or reference files are invalid/unavailable; no VM reads have begun. |

The dedicated workflow serializes with the existing deployment group. It writes only its isolated runner checkout/evidence artifact. A push runs it only on `ops/import-readonly-preflight-20261122` when `.github/import-readonly-probe-trigger.txt` changes; it is also manually dispatchable. Run the reviewed diagnostic after source CI. Do not replace an unavailable read-only probe with an old UI deployment workflow.

Record the exact source SHA, CI run, diagnostic run, mismatched/missing files and current deployment uncertainty separately in #89. File evidence cannot authorize a rollout or claim operator acceptance. A future permitted non-RADIUS rollout still requires backup/restore verification, recorded identity, VM acceptance, health/regression and stop/rollback on risk. RADIUS is healthy, accepted and frozen; no new real RADIUS tests are planned. If shared app/backend startup could affect it, keep deployment blocked and progress the remaining development priorities.
