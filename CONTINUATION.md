# Installed Import compatibility evidence — 2026-11-22

Fresh main: `ca4f1829695bdb1ff95bc799157bd52de3b4f96b`, a screenshot-only successor of #90 merge `24dcbaefb2410903dacec5a4f20771f54f811498`. Both candidate CI 44979017800 and merge CI 44979172804 passed all four gates (48 browser scenarios, 34 native HTTP tests, no native skips). Import code is merged, while installed/operator acceptance remains PARTIAL. Open #83/#85 are green, #84 failed and #12 is draft; none is changed here. #89 and both acceptance documents remain authoritative.

The new read-only Import preflight checks nine explicit source/dependency file hashes inside the app container, three loopback-served assets, existing GET /health and selected app identity fields before/after observation. It detects an old backend, missing shared classifier, stale served UI and an intervening container restart/replacement. No login, import request, DB/table/credential/RADIUS access, scan, push, image build, migration, restart or deployment. Only diagnostic checkout/evidence files are written by its dedicated runner workflow.

Fourteen isolated Python tests pass locally, including fail-closed reference/identity/health handling, bounded HTTP, redirect refusal and redacted failures. Ordinary CI now runs them. Matching files remain `files_match_runtime_unverified`, never a full deployed SHA or runtime/operator acceptance. See docs/IMPORT-INSTALLED-PREFLIGHT.md; exact candidate CI and VM diagnostic observations belong in #89. Do not infer live success from mocked tests.

Next: after candidate CI, run the dedicated read-only VM diagnostic and record actual compatibility blockers; then continue the #83/#84/#85 color conflict with default OFF while deployment acceptance remains open. Do not run old UI-only deploy workflows for the new backend endpoint/shared module. Any later permitted non-RADIUS rollout needs backup/restore validation and identity/health/regression protection. RADIUS is healthy/user-accepted/frozen, and new real RADIUS testing is removed from the plan. Work executes; Chat handles decisions/feedback; GitHub/#89 is the status ledger.

---

# Content-based unified import detection — 2026-11-22

Fresh main: `09dbc527f6c28ceb2f964fe758b4f09ebb348bd1`; #90 base head `9d6dccf6dcc8300de21de3a60930980bf30bfca6` passed CI 44960535711 (all four gates, 47 browser scenarios, 33 native HTTP tests). Open #83/#85 remain green, #84 failed and #12 draft; they are not changed here. Current #89 and both acceptance documents were reviewed. RADIUS remains healthy/user-accepted and frozen, with no new real RADIUS testing.

A shared browser/server format classifier now uses bytes instead of filename/MIME: ZIP signature selects the existing workbook validator, UTF-8 JSON content selects Portable validation, and delimited text selects CSV validation. A ZIP signature does not assert workbook validity. The server independently classifies spreadsheet content, so renamed/missing extensions work without trusting the browser. BOM and JSON after more than 512 bytes of whitespace are recognized; CSV retains comma/semicolon/tab/single-column behavior, including blank lines before the header. Empty, unsupported binary/UTF-16/invalid UTF-8 and malformed workbook input cannot be committed. Existing 7 MiB spreadsheet and 8 MiB Portable limits remain.

Tests cover the extension/content matrix, UTF-8 and size boundaries, corrupt/non-workbook ZIP rejection, authorized HTTP preview/commit for misnamed Excel and CSV, no writes on rejected input, stable host ID/MAC and unchanged sibling Space. Browser coverage adds invalid-input rejection with Commit disabled, a truncated XLSX rejected by the server, a no-extension/BOM/long-whitespace JSON, CSV named .xlsx and a real XLSX named .json. The existing preview-conflict, round-trip, late-response and Dark Mode tests remain intact.

Local targeted result before publication: 38 passed, zero failures, 8 native-PostgreSQL-only skips (46 including parent). Checksums/syntax/whitespace are verified. No local browser pass is claimed because of the previously observed Chromium socket restriction; require the candidate's full CI and native HTTP/browser evidence, recorded in #90/#89. If every gate succeeds and refs remain unchanged, merge this reviewed Import work, then verify merge CI separately; no deployment is implied by merge.

VM: no access/write/deployment/restart/migration/discovery/config push. Last observed older UI installation is 44948850727 / `f3995f6f75a258d63e6f93ec252825799e7a8de2`; full current deployed SHA and fresh health are unverified. The new shared module must be packaged with both frontend and backend, and the new preview endpoint needs a compatible server; do not use old UI-only rollout workflows. Next: read-only installed compatibility/identity and backup/restore planning before any protected VM rollout, or proceed with the color-conflict priority while VM acceptance is pending. No stable/DONE claim before practical acceptance. Work handles execution, Chat feedback; GitHub/#89 owns status.

---

# Portable JSON server preview and conflict round-trip — 2026-11-22

Fresh main remains `09dbc527f6c28ceb2f964fe758b4f09ebb348bd1`; PR #90 starts from `770f5c721e6fd2c99669eaa9d421cdf6fbed802c`, whose CI 44954749978 passed all four gates and 46 browser/API scenarios. Open #83/#85 are green, #84 failed, and #12 remains draft; no color/Radio branch is changed.

The unified dialog now calls POST /api/imports/subnet/preview instead of trusting a local sample. The endpoint shares commit authorization (currently admin-only), destination lookup and package validation. It runs only SELECTs in a repeatable-read, read-only transaction, counting new/existing/archived prefixes and hosts in the selected Space. Safe samples are bounded to 50 per kind with conflicts first; totals cover the entire validated file. The UI displays skip/replace effects, explains restoration of trash and replacement of device ports, and explicitly says commit rechecks current state. No preview token promises that the database is locked until commit.

Shared validation rejects malformed/oversized record lists instead of silently truncating, rejects unaligned/duplicate prefixes, and canonicalizes IP/CIDR identities before duplicate checks. Legacy missing lists and source host IDs remain supported. No schema/migration/RADIUS/module/config/container change. RADIUS remains healthy, user-accepted and frozen; no new real RADIUS testing is in the plan.

Tests add actual HTTP preview/invalid-request no-write comparisons (source, destination and trash), unauthorized viewer/branch requests, missing destination, active and archived conflicts, a new conflict inserted after preview, skip preservation, replace restoration with stable IDs, and export/import/export round-trip. Browser tests exercise held late responses for both spreadsheet and JSON paths, invalid JSON records rejected by the server with Commit disabled, and a real export uploaded under a .csv filename through preview, skip and replace. Spreadsheet workflows and Dark Mode checks remain intact.

Local targeted validation: 38 passed, 0 failed, 8 native-PostgreSQL-only cases skipped (46 including parent). The new HTTP case passes under PGlite; native PostgreSQL and browser evidence must come from this candidate's CI, recorded in #90/#89. Local Chromium's previously confirmed socket restriction remains; do not claim a local browser pass. Syntax, whitespace, checksum-tool tests and manifest are checked before publication.

VM/deployed SHA: no VM access, write, deployment, restart, migration, scan or config push. Latest observed old UI deployment remains 44948850727 / `f3995f6f75a258d63e6f93ec252825799e7a8de2`, not evidence of the full current installed tree. Acceptance stays PARTIAL. Next: inspect all candidate gates, finish file-detection edge cases and review compatibility/guarded rollout with backup, identity capture and regression protection. Backend preview is a new route, so a UI-only copy is insufficient for deployment. Work implements, Chat handles decisions/feedback, GitHub/#89 owns status.

---

# Unified Import CI recovery and stale-preview guard — 2026-11-22

Current authority: Issue #89 and the user's 2026-11-22 instruction. **RADIUS is healthy and user-accepted, frozen and outside development scope.** All older requests below for real MikroTik Full/Read or new real RADIUS tests are superseded and removed from the current plan. No RADIUS code/config/database/schema/users/NAS/secrets/credentials/container/image/migration/restart/redeploy changes are authorized. Existing isolated CI regression tests do not authorize live service tests. Other deployments require backup, identity capture, health/regression and stop/rollback on risk.

Fresh main: `09dbc527f6c28ceb2f964fe758b4f09ebb348bd1` (screenshot-only successor of `21c792a00a6aace64cbc90dcdd98545501cf4e66`, whose CI 44948808270 succeeded). Open PRs checked: #90, #83, #84, #85 and draft #12. Leave the conflicting color variants and Radio draft untouched.

PR #90 head `7a552db5ca23eb1c6d2d30fd540a3da89993abb1` fixed the dirty-import dialog interception: browser job 136987276394 in CI 44950541404 succeeded, as did Docker/PostgreSQL. The overall run failed only because SHA256SUMS still contained the old browser test hash. Refresh the manifest without bypassing verification.

This step also prevents an in-flight Import preview from re-enabling Commit after the file/destination changes or the dialog closes and reopens. Starting another preview clears the old authorization; stale success/error replies cannot replace the current selection. Only IPAM client state is changed. Browser coverage holds actual HTTP preview responses, invalidates each of those three contexts, then waits for completion and requires disabled Commit and unchanged target/sibling data. The existing real XLSX and CSV preview/commit cases still run afterwards. Portable JSON cancellation now tests both rejecting and accepting the unsaved-form confirmation and verifies no database changes.

Local validation: 11 portable/UI/import tests passed (zero skipped), four checksum-tool tests passed, JS syntax/whitespace and refreshed source manifest verified. Local browser execution is blocked before any scenario by Chromium's socket permission error; no local browser pass is claimed. The exact candidate SHA and GitHub CI results are recorded in #90 and #89. Require green browser/test/Docker/native PostgreSQL gates on the new candidate before any merge.

VM: no access, write, deployment, restart, migration, scan or config push in this step. Latest observed UI deployment evidence is run 44948850727, source `f3995f6f75a258d63e6f93ec252825799e7a8de2`; this is an older UI-only source, not the current full installed SHA or fresh VM health proof. User acceptance remains open. Next: verify the new CI; complete Portable JSON conflict/validation preview and round-trip acceptance before a guarded rollout. Keep Work implementation and Chat feedback separate; only GitHub/#89 is the status ledger.

---

# Preserve Personnel during fixture cleanup — 2026-11-21 UTC

[PR #86](https://github.com/emsebi/EMS_IPAM/pull/86) merged with expected head as `8f1c2d054c19394f784807ca327f5a95a2b4e87a`. Candidate CI 44927861295 and 44927857398 passed all four gates; native PostgreSQL job 136917806022 passed all 31 HTTP tests with no failures/skips and browser job 136917806041 passed 44 scenarios. [Merge CI 44933607196](https://github.com/emsebi/EMS_IPAM/actions/runs/44933607196) also succeeded, verified 18:07 UTC. Its tree equals the tested candidate. Fresh base is `8f1c2d054c19394f784807ca327f5a95a2b4e87a`; open #83/#84/#85 UI/browser work and draft #12 remain untouched.

The next narrow preflight covers personnel.company_id: its ON DELETE SET NULL relationship would silently detach a person if the fixture company were purged. Fixture creation owns no Personnel, so any linked record blocks cleanup, including inactive Personnel. The production-schema read-only test compares complete Personnel rows alongside hierarchy/grants. A new native PostgreSQL HTTP case injects a synthetic existing person's link to active and already-archived fixtures, then requires normal cleanup/recovery refusal, no DELETE for the blocked fixture, identical rows/journal bytes and retained active/trash entries. Restoring only the injected link permits repeatable recovery, after which the complete original Personnel row must still match.

Local combined journal/Radio/Company/HTTP validation: 27 passed, 0 failed, 8 native-only skips (35 including parent); all 315 listed source checksums, syntax and whitespace pass. The new native HTTP case is not executed by the local PGlite adapter. Candidate CI IDs/status are recorded in the PR; require all 32 native HTTP tests with zero skips/failures and every other gate before fresh-ref/expected-SHA merge.

Next: inspect the candidate's Personnel case and all gates. Then inventory remaining incoming references from the actual migrated schema (old migration text alone is not the current RADIUS contract), cover module references and private preservation comparisons before any installed-loopback XLSX runner. This SELECT-only guard remains optional rehearsal tooling, not an atomic concurrency lock or a complete installed cleanup policy. No application/schema change, VM write/deployment, real-device scan or router push. Installed XLSX acceptance, practical Radio acceptance and actual MikroTik Full/Read login remain open.

---

# Company hierarchy and grant preflight for XLSX fixture cleanup — 2026-11-21 UTC

PR #78 merged as `6a8e598d4aab02bba87a100e9bcc2f2a4d2030ab`; [merge CI 44922365467](https://github.com/emsebi/EMS_IPAM/actions/runs/44922365467) completed successfully in all four gates. Fresh main `e158828c15c149822402742ce36235cd16f72053` only adds its generated Radio screenshot. The earlier failed merge run 44901729931 remains a failure. Open #83/#84/#85 overlap IPAM UI/browser/color work; this step does not edit those files. #12 remains draft pending practical Radio acceptance.

This bounded step adds a SELECT-only fixture preflight for incoming companies.parent_company_id, user_company_access.company_id and user_space_access.space_id. Fixture creation owns no child companies or grants, so any such reference blocks cleanup, including archived children/Spaces and inactive users. Unrelated branch grants do not block it. The guard uses the existing beforeCleanup hook together with the Radio guard; it does not change the application or schema and is not a concurrency lock or a complete installed cleanup policy.

A production-schema PGlite test runs each refusal in a read-only transaction and compares full hierarchy/Space/user/grant rows before and after. Three native-PostgreSQL HTTP cases cover all three reference types with active and already-archived fixtures: normal cleanup and journal recovery must send no DELETE for the blocked fixture, retain its active/trash entry, preserve full relevant rows and leave recovery journal bytes unchanged. Each case removes only its injected synthetic relation and completes repeatable recovery in its disposable database.

Local combined journal/Radio/Company/HTTP validation: 27 passed, 0 failed, 7 native-only skips (34 including the HTTP parent). The three new HTTP cases therefore still require native PostgreSQL CI; expect all 31 HTTP tests with no skips. Source checksum and syntax validation are recorded in the PR, together with candidate CI run IDs. No local native-PostgreSQL pass is claimed.

Next: inspect those three native HTTP cases and every test/browser/Docker/PostgreSQL gate for the exact candidate head; do not merge on skipped local coverage. Re-read main and PR heads before expected-SHA merge, preserving concurrent checksum entries. Then cover remaining module/personnel incoming references and private before/after preservation evidence before wiring an installed-loopback XLSX runner. No VM write/deployment, device scan, router push, credentials access or real-device acceptance in this step. Installed XLSX, Radio operator acceptance and actual MikroTik Full/Read login remain open.

---

# Integrate Device Types readiness fix with current search/theme work — 2026-11-21 UTC

PR #78 original head `b5bed9e28e7dbedeefa3ac1021ff2858cc6a9b0f` passed both [PR CI 44906660455](https://github.com/emsebi/EMS_IPAM/actions/runs/44906660455) and [push CI 44906652687](https://github.com/emsebi/EMS_IPAM/actions/runs/44906652687). Browser job 136853605742 passed 43 real HTTP/browser scenarios at 13:01:36 UTC, including the held real Device Types refresh and desktop/mobile layout assertions. Test, Docker and native PostgreSQL gates succeeded. This does not retroactively turn merge CI 44901729931 into success.

Fresh main `7cc2f5a23c8b96871c41d5c8f435ad89e2d2b7dd` includes merged Link Planner #79/#80, global live-search #81 and module dark-theme #82 plus generated screenshots. Those PRs are closed; only #78 and inactive draft #12 remain open. Bring main into #78 without replacing any application/module/workflow/screenshot bytes. The browser test merges cleanly, retaining the new global-search/Ctrl+K assertions and the Device Types atomic layout snapshot. Resolve only the SHA256SUMS conflict by using the current main manifest and recomputing the changed test/checkpoint hashes.

Local checks: Node syntax, listed-source checksums and whitespace against fresh main. New integration CI IDs/status are recorded in #78. Next: require all gates on the integrated head, especially both the global-search/Ctrl+K case and delayed Device Types desktop/mobile case (44 browser/API scenarios expected). Re-read both refs before expected-SHA merge; preserve intervening main changes. Older candidate success is not evidence for this new integrated tree. If pending, follow the recorded run IDs next turn rather than waiting indefinitely.

After P0 integration, resume the recorded Company hierarchy/access-grant cleanup preflight and preservation tests before an installed-loopback XLSX runner. No VM write/deployment, application/schema change, device discovery or router push. Radio operator acceptance, installed XLSX acceptance and real MikroTik Full/Read login remain open.

---

# P0 browser readiness repair after PR #65 merge — 2026-11-21 UTC

PR #65 merged with expected head at `1ac9fc9fee1a55bdb3409198b9d3df8033e16a6e`, after both candidate CIs passed all four gates and native PostgreSQL job 136825476390 passed all 28 HTTP tests with no failures/skips. Its merge CI [44901729931](https://github.com/emsebi/EMS_IPAM/actions/runs/44901729931) subsequently **failed** in browser job 136838868126 at 12:00:58 UTC: Device Types desktop measured one column and every row at x/y/height zero. Ordinary tests, Docker and PostgreSQL succeeded. Do not describe that merge run as successful.

New main `15028b4dc443a7e372192187bf43b807f8c8bd11` contains Link Planner longitude PR #77; [CI 44906244285](https://github.com/emsebi/EMS_IPAM/actions/runs/44906244285) passed all gates, including browser. Current base `31297c49375d0a808db1641423356ebdae9bda39` adds only seven generated screenshots. Preserve the active Link Planner work and all deployed UI changes.

This bounded P0 step repairs the Device Types browser readiness check. The previous count >= 6 could accept the pre-refresh list; locator evaluation could then measure a grid detached by asynchronous page replacement (consistent with the observed zero geometry). The replacement requires all newly created fixture IDs and positive card dimensions, and reads the current connected DOM and its layout in one browser task. Desktop/mobile column counts, row alignment, wrapping, compact height and overflow assertions remain unchanged. A held real GET response proves the pre-refresh list is rejected before the response is released; no API data is fabricated and no fixed sleep/retry hides a failed layout assertion. Response interception and DOM readiness are bounded by timeouts.

Local checks: Node syntax, listed-source checksum verification and diff whitespace. Full browser behavior requires this candidate's CI; run IDs/status are in the PR body. Next: inspect the held-response readiness case and the complete browser gate plus the other gates before expected-SHA merge with fresh main. Do not repeat the old 44901729931 success claim or treat newer main success as proof of this patch. If CI remains pending, follow the recorded runs next turn.

After this P0 gate is green, resume the already recorded Company/access-grant cleanup preflight (companies.parent_company_id, user_company_access.company_id, user_space_access.space_id), with exact-row/journal preservation and no DELETE on refusal; then module references and private preservation evidence before any installed-loopback XLSX runner. That work was deferred in this turn to address the observed CI failure. No VM write/deployment, application/schema change, device discovery, router push or real-device acceptance. Installed XLSX, Radio operator acceptance and actual MikroTik login remain open.

---

# PR #65 integrated with current IPAM/Radio main — 2026-11-21 UTC

Fresh main is `e7f877281e8361ad20225255a58f257cb30927eb`, preserving the IPAM live-search/inherited-color and Radio compact-UI merges (#75/#74), Link Planner, all generated screenshots and their workflows. PR #12 remains draft/inactive. Only the fixture helper/tests, this checkpoint and source manifest differ from that main; no active UI/module files are edited or deployed.

PR #65's original head `e57efd2f61794e99c78f7ead678db4be5fb1668f` passed PR CI 44470371702 and push CI 44470328084. PostgreSQL job 135378073721 confirms the external-Radio-child case and all 28 HTTP tests passed with zero skips/failures at 2026-11-19T06:12:10Z. Those results predate the latest main and do not substitute for this integration candidate's CI. The real merge conflicts were only CONTINUATION.md and SHA256SUMS: keep both histories and rebuild the manifest from current main plus the two fixture files.

The HTTP regression now also explicitly archives the blocked synthetic company and retries journal recovery. It must refuse the purge, send no DELETE, leave both full host rows and journal bytes unchanged, and retain the company in trash. This covers recovery when a cross-branch Radio reference exists after archive, not only the active-company path. The test then restores the original synthetic link and cleans up through the guarded recovery path.

Local combined journal/preflight/HTTP validation: 26 passed, 0 failed, 4 native-PostgreSQL-only skips (30 including the HTTP parent); all 313 listed checksums and the diff against fresh main pass. This does not execute the extended native-only case locally.

Next: inspect candidate push/PR CI IDs recorded in #65; require the extended Radio case and all 28 native PostgreSQL HTTP tests with zero skips plus every ordinary/browser/Docker gate. Re-read main and PR head before expected-SHA merge; preserve any intervening changes. Then cover remaining incoming references and private preservation comparisons before an installed-loopback runner. The optional SELECT-only Radio guard is still narrow and is not an atomic lock against concurrent writes. No installed XLSX acceptance is claimed.

Latest observed Actions include successful IPAM UI deployment 44895861291 and Radio compact UI deployment 44895981971, with successful main CI 44896140211. These are observed workflow conclusions, not a new deployment or operator acceptance in this run; do not treat the older single-source installed checkpoint below as the complete current module state. Radio functional acceptance and actual MikroTik Full/Read login remain open. No VM write, device discovery, router push, schema change or credential access.

---

# Radio relationship preflight for disposable XLSX cleanup (2026-11-19 UTC)

PR #64 merged with expected head at `c3977cd96289539dd888fa0904804641b6caade3`. Candidate CI 44456081052 and 44456075220 passed; PostgreSQL job 135331300575 passed all 27 HTTP tests without failures/skips at 04:07:41 UTC. Merge CI [44469937411](https://github.com/emsebi/EMS_IPAM/actions/runs/44469937411) succeeded. Fresh main `ecc0cdfbf5b67566866a891d60e1cdb382bbfe1b` adds only the generated Radio screenshot. PR #12 remains inactive/draft.

Small next step: a SELECT-only fixture preflight counts outside-company hosts referencing a fixture Radio parent, including archived records. An optional beforeCleanup hook runs after ownership validation and before archive/purge in normal cleanup and journal recovery. A detected reference refuses deletion; the native PostgreSQL HTTP test verifies both linked rows, the active fixture company and pending journal survive, no DELETE is sent for that company, and recovery can finish after removing only the synthetic relationship. The PGlite test checks unchanged full host rows and executes the preflight in a read-only transaction for active and archived children.

Local validation and candidate CI IDs are in the PR body. Next: verify the new native HTTP case and all 28 HTTP tests with zero skips, plus ordinary/browser/Docker gates, before merging with fresh refs and expected head. Then cover other incoming references (company hierarchy, grants and module foreign keys) and private before/after preservation evidence before an installed-loopback runner. This narrow guard covers hosts.radio_parent_host_id only; it is optional for isolated tests, not a complete installed cleanup policy or an atomic concurrency lock. Keep a single fixture owner; do not infer safety against concurrent application writes.

No application/schema change, VM redeployment, device scan or router push. Installed source remains `71d9b35b73270b1e595e36cea20d77753d30f55c` (Lab Deploy 44376757411). Installed XLSX, Radio operator acceptance and real MikroTik login remain open. Unresolved create replies still need evidence reconciliation, never guessed IDs.


---

# EMS_IPAM module publication checkpoint — 2026-11-20

**Status: code merged into main; VM modules installed and reachable; operator functional acceptance remains open.**

- [Radio map stability PR #68](https://github.com/emsebi/EMS_IPAM/pull/68) merged via `4ad6d83a0f4e61d15aed45fb6c9050f4556605e7`. Radio 2.3.1 keeps viewport fixed while picking GPS coordinates, adds explicit Focus/zoom, preserves simultaneous AP groups, AP→Station links, per-station distances and persisted PostgreSQL positions. [Module-only VM deployment 44706521989](https://github.com/emsebi/EMS_IPAM/actions/runs/44706521989) successful.
- [Link Planner PR #67](https://github.com/emsebi/EMS_IPAM/pull/67) merged via `9e618050591473499e3cea2958eba563c6b60b4d`. Link Planner 0.2.0 is a **separate** admin-only module: two selectable locations, authenticated on-demand SRTM90 profile, LOS/Fresnel + curvature, inverse tower-height computation (fixed A → required B or reverse), explicit RF budget inputs, curated MikroTik/Mimosa/Ericsson/Huawei/RACOM model/protocol references, saved plans and JSON results. **Theoretical reference PHY or brochure ceiling is not measured throughput.** Vendor-specific MCS/SNR, firmware/licence, weather/rain availability and PDF-grade reports remain open under [Issue #66](https://github.com/emsebi/EMS_IPAM/issues/66).
- Combined branch CI [44765258831](https://github.com/emsebi/EMS_IPAM/actions/runs/44765258831) passed all four gates and Link Planner browser [44765258601](https://github.com/emsebi/EMS_IPAM/actions/runs/44765258601) passed after synchronising Radio 2.3.1 and resolving `SHA256SUMS` discrepancies. The original Link Planner-only installation on VM [44707008922](https://github.com/emsebi/EMS_IPAM/actions/runs/44707008922) passed, including DB backup and RADIUS integrity check.
- Live connectivity and runtime audit [44764568381](https://github.com/emsebi/EMS_IPAM/actions/runs/44764568381) passed from the authorized self-hosted runner to `http://10.1.1.5:8888/health`: HTTP 200, 9 registered modules including `radio` and `link-planner`, app/database/radius_ops containers running, unauthenticated map endpoints return expected 401.
- No reinstallation on VM was required when merging: the user-facing module-only code was already deployed and verified. **User still needs to visually accept the interface and verify a known RF path; real RouterOS RADIUS login Full/Read remains unverified.**
- New host installation: `install.sh` from `main` includes both modules. Take separate backups and distinguish migration, test success and production validation. Project Core version remains 1.7.1; Radio is 2.3.1; Link Planner is an experimental 0.2.0.

---

# Resume cleanup after lost archive/purge responses (2026-11-19 UTC)

[PR #63](https://github.com/emsebi/EMS_IPAM/pull/63) merged at `2607e6dd4d49a2b4be410ba1923d76cd1e88a842` after PR CI 44448977718 and push CI 44448972824 succeeded. PostgreSQL job 135307949508 passed the process-exit and ambiguous-create cases and all 25 HTTP tests without failures/skips. [Merge CI 44455678717](https://github.com/emsebi/EMS_IPAM/actions/runs/44455678717) succeeded. Fresh main `5478d05c42d376da90660a9b1d96c200123f1c3d` adds only generated Radio screenshots; PR #12 remains inactive/draft.

The fixture journals and fsyncs purge intent before deleting an archived company. Cleanup requires an admin bootstrap view, verifies the known ID/name in active records or trash, and can resume an archived record after a lost archive response. If a purge response/removal checkpoint is lost, the same recorded ID may be marked removed only when purge intent exists and both admin active/trash views show it absent. Missing records without that evidence still fail. An active record restored after purge intent is refused. Existing version-1 journals without purge intent remain readable but do not authorize treating unexplained absence as success.

Production-route tests inject failure immediately before purge and after successful archive/purge HTTP operations, reopen the journal and recover twice. Pre-existing Company/Space listings and trash remain identical. A scoped reader cannot issue cleanup deletes or change journal bytes. A separate out-of-band removal test verifies that absence without purge intent remains unresolved and recovery sends no delete. The filesystem test also reopens and verifies the persisted purge-intent state.

Local combined journal/HTTP suite: 25 passed, 0 failed, 3 existing native-PostgreSQL-only skips (28 including the HTTP parent). Native PostgreSQL must pass all 27 HTTP tests without skips; the ordinary test gate includes the filesystem case. Candidate CI run IDs and next checks are in the PR; no full-CI or VM pass is claimed for this new head.

Next: verify the new cleanup-recovery and unexplained-absence cases plus all CI gates before merging with fresh refs/expected SHA. Then add a read-only dependency/preservation preflight before cascading cleanup: in the disposable database, link an outside-branch host to a fixture Radio parent and prove cleanup refuses without changing either record. Cover other incoming references and keep private before/after evidence before wiring the installed-loopback runner. Unresolved creation replies remain fail-closed and require evidence reconciliation; no name-based guessing. One recovery owner per journal is still required.

This remains an isolated database rehearsal with no live CLI/workflow, VM deployment, schema/application change, discovery or router push. Installed source remains `71d9b35b73270b1e595e36cea20d77753d30f55c` from Lab Deploy 44376757411. Installed-panel XLSX, Radio operator acceptance and actual MikroTik Full/Read login remain open.

---

# Private XLSX fixture journal and confirmed-ID recovery (2026-11-19 UTC)

[PR #62](https://github.com/emsebi/EMS_IPAM/pull/62) merged at `e05b67a21ad860dce3eff09f5f2f48fa7c6efa05` after successful PR CI 44441949873 and push CI 44441942358. PostgreSQL job 135284672551 passed all 23 HTTP tests, including both lifecycle cases, without failures/skips. [Merge CI 44448470690](https://github.com/emsebi/EMS_IPAM/actions/runs/44448470690) succeeded; fresh main `debc4d032004acd0f82cd24b1e6b81f778598903` adds only generated Radio screenshots. PR #12 remains inactive/draft.

The disposable fixture now optionally journals a create intent before each API call, confirmed returned IDs, and successful removals. The append-only file is created exclusively with mode 0600; each event has a UTC observation time and is fsynced, and the parent directory entry is synced after file creation. It stores no credentials or host payloads. Recovery validates the journal and only retries confirmed IDs with matching current name markers. Completed recovery is repeatable. Unresolved creates, incomplete/invalid records and non-private files fail closed; a previous journal is never overwritten.

A child process runs the real XLSX HTTP scenario, commits its writes and exits with code 77, bypassing finally. The parent reopens the journal, verifies two recorded IDs, performs recovery twice and compares the pre-existing Company/Space listings. A separate real-HTTP test simulates a lost create response: recovery makes zero API calls and does not guess an ID. Filesystem tests cover private permissions, overwrite refusal, truncation and unknown removal IDs.

Local combined journal/HTTP run: 23 passed, 0 failed, 3 existing native-PostgreSQL-only skips (26 including the HTTP parent). Native PostgreSQL must pass all 25 HTTP tests with no skips; the ordinary test job also runs the journal filesystem case. Candidate CI run IDs are in the PR. This is an isolated test database, not installed-panel acceptance.

Next: check those new cases and all CI gates, then merge with fresh refs/expected head. Extend recovery for interruption between archive, purge and the removal checkpoint, with injected lost responses; current recovery deliberately reports a failure if the active record is absent rather than assuming deletion succeeded. Unresolved create replies still require reconciliation from retained evidence, not name-based guessing. Before an installed runner, retain the private preservation comparison, unexpected-relationship checks before cascading deletion, and fixed-loopback/authentication boundaries. Do not run concurrent recovery processes for one journal. No live CLI/workflow is attached.

No VM deployment, device discovery, router push or application/schema change. Installed source remains `71d9b35b73270b1e595e36cea20d77753d30f55c` (successful Lab Deploy 44376757411). Installed-panel XLSX, Radio operator acceptance and actual MikroTik Full/Read login remain open.

---

# XLSX fixture lifecycle and failure-path rehearsal (2026-11-19 UTC)

[PR #61](https://github.com/emsebi/EMS_IPAM/pull/61) merged at `96924c5f7f8c1c2604a5c25e5ba6d61dcfb2bea8` with expected head after both [PR CI 44433752534](https://github.com/emsebi/EMS_IPAM/actions/runs/44433752534) and [push CI 44433747394](https://github.com/emsebi/EMS_IPAM/actions/runs/44433747394) passed. Native PostgreSQL job 135257335142 passed the two XLSX cases and all 21 HTTP tests with no failures/skips. [Merge CI 44441459672](https://github.com/emsebi/EMS_IPAM/actions/runs/44441459672) succeeded; fresh main `7d5ba88d5e8e1d5afc0094820360aa773231baa8` adds only the generated Radio geographic screenshot.

The new `docker-app/tests/helpers/xlsx-http-fixture.mjs` provisions uniquely named synthetic branches/Spaces through the existing API, records each returned company ID before continuing, seeds same-IP hosts and sentinels, and calls the shared XLSX scenario. Its finally path checks the recorded ID/name marker, archives and purges only those company IDs in reverse order, attempts every recorded cleanup, and reports scenario/cleanup failures together. Existing audit records are retained.

Production-route tests now exercise normal completion, failure after the first company creation, failure after a committed XLSX import, and refusal to delete a fixture whose name marker changed. The ordinary paths compare pre-existing Company/Space listings, both established branch payloads and trash before/after. The ownership-failure test verifies that the changed record and its Space still exist, then explicitly repairs only that synthetic record in the disposable database.

Local HTTP suite: 20 passes, 0 failures, 3 existing PostgreSQL-only skips (23 including the parent) with PGlite. Native PostgreSQL and all other CI gates for this candidate remain pending; run IDs are in the PR. This is a disposable-database lifecycle rehearsal, not an installed-panel test or a row-by-row preservation audit for every module.

Next: inspect both lifecycle cases and all 23 HTTP tests without skips in PostgreSQL CI, plus all remaining gates, before merging with fresh refs/expected head. Before wiring an installed-loopback runner, add durable recovery for lost create responses/process interruption, a private before/after preservation check, and refusal of unexpected relationships before cascading purge. Test these failure paths in the disposable database first. The current helper intentionally has no live CLI/workflow or installed credentials; do not run it against user Spaces or infer crash-safe cleanup from finally.

No VM deployment, real-device discovery, router push or schema/application change. Installed source remains `71d9b35b73270b1e595e36cea20d77753d30f55c` from successful Lab Deploy 44376757411. Do not redeploy for this test-only change. Installed-panel XLSX acceptance, Radio #12 operator acceptance and actual MikroTik login remain open.

---

# Shared XLSX HTTP scenario with explicit fixture identity (2026-11-19 UTC)

Fresh main `9733e795ba904b6e5bf8f2e931d772fbc16aa14b` adds only tested screenshots after [checkpoint e766172](https://github.com/emsebi/EMS_IPAM/commit/e766172c9e21803dac9f937279ba00c4759fbbec). [Checkpoint CI 44387039897](https://github.com/emsebi/EMS_IPAM/actions/runs/44387039897) completed successfully. PR #12 remains the only pre-existing open PR, inactive and draft; no concurrent module files were edited.

The existing two-sheet XLSX HTTP scenario is now a shared helper at `docker-app/tests/helpers/xlsx-import-scenario.mjs`, retaining its original strict Unicode, read-only preview, stable host ID/MAC, first-sheet-only and Skip retry assertions. It additionally checks explicit Company/Space identities and the synthetic CIDR before any import request, rejects a reused destination, preserves every unrelated destination host, and compares the sibling branch before/after with a same-IP sentinel for the newly imported row. The production-route test proves missing/incorrect fixture identity is rejected without sending preview or commit requests or changing either branch. This is test-harness validation, not a replacement for backend authorization.

Local `node --test docker-app/tests/multisite-http.test.mjs`: 18 passed, 0 failed, 3 existing native-PostgreSQL-only cases skipped (21 including the parent). This uses real production HTTP routes with the disposable PGlite adapter. Native PostgreSQL, browser and the remaining CI gates still require the new head's results; run IDs will be recorded in the PR. No installed-panel execution or acceptance is claimed.

Next: inspect both named XLSX subtests in the native PostgreSQL CI job (all 21 tests, no skips) and every other gate before merging with fresh main/expected head. Then implement the installed-loopback wrapper with owned synthetic fixture provisioning, exact-ID cleanup in failure paths and a private before/after preservation check; test that lifecycle in a disposable database before running on the installed VM. The helper deliberately does not provision records, handle installed credentials or provide cleanup, so it must not be invoked against existing user Spaces as a standalone live probe.

The installed build remains `71d9b35b73270b1e595e36cea20d77753d30f55c` from successful [Lab Deploy 44376757411](https://github.com/emsebi/EMS_IPAM/actions/runs/44376757411). Do not redeploy for this test-only change. Installed-panel XLSX acceptance, Radio operator acceptance and real MikroTik Full/Read login remain open. No live discovery, router push, application/schema changes or removal of the legacy CIDR constraint.

---

# Verified isolated checkout deployment and merge (2026-11-18 UTC)

[Lab Deploy 44376757411](https://github.com/emsebi/EMS_IPAM/actions/runs/44376757411) completed successfully for installed source `71d9b35b73270b1e595e36cea20d77753d30f55c`. Dedicated-VM job `135057833118` completed at 19:11:10 UTC; its final Docker/PostgreSQL/FreeRADIUS smoke passed at 19:11:02 UTC. The earlier checkout EACCES in run 44375919531 is resolved by the separate source directory, verified on the actual runner.

Verified from the completed job and logs: source checksum gate; preserved configuration and private pre-upgrade database backup; build before container replacement; existing database volume and application state retained; healthy panel on port 8888; installed IPAM, network-access, network-map, Radio, RADIUS, radius-ops and reports available; existing RADIUS records, credentials and assignments unchanged; valid Message-Authenticator, Response Authenticator and assigned permissions on the temporary loopback reply, followed by fixture cleanup. The independent Docker smoke also passed persistence/restart and database-outage recovery. These checks do not provide a row-by-row comparison of every other module, installed-panel XLSX acceptance or a real MikroTik login.

[PR CI 44376446159](https://github.com/emsebi/EMS_IPAM/actions/runs/44376446159), [push CI 44376341101](https://github.com/emsebi/EMS_IPAM/actions/runs/44376341101) and [release-branch CI 44376757379](https://github.com/emsebi/EMS_IPAM/actions/runs/44376757379) all succeeded on that candidate. [PR #60](https://github.com/emsebi/EMS_IPAM/pull/60) merged at `f94d9ea4b0c70112e40eca683b0a549a392775a5` after rechecking main `e7ebaae2d943cfe792783f64ac57fd53434e89f3` and supplying the expected PR head. The merge tree is identical to the installed candidate. [Merge CI 44386532472](https://github.com/emsebi/EMS_IPAM/actions/runs/44386532472) completed successfully across all four test gates and screenshot publishing. Fresh main `981ff02d12dcc829d1da7c4423637f3dc18db644` adds only the two generated Radio screenshots; this checkpoint preserves them. The checkpoint CI ID/status is recorded in #60.

Next: read this checkpoint's CI before further integration. Keep the deploy trigger branch pinned at the verified installed SHA; do not redeploy merely for this merge or evidence update. Then add a bounded installed-panel XLSX preview/commit check using explicitly synthetic isolated Branch/Space fixtures and loopback HTTP. Reuse the existing workbook and import assertions; prove unchanged sibling/pre-existing records and clean up only recorded fixture IDs, including failure paths, before running it on the installed VM. The successful disposable-VM HTTP fixture 44271905157 and CI browser tests remain separate evidence and need not be repeated solely for documentation.

PR #12 remains draft and inactive, pending Radio operator acceptance. Keep installed-panel import acceptance and the real MikroTik Full/Read/Bad Replies incident open. No real-device discovery, configuration push, production uniqueness-constraint removal or public-release readiness is claimed.

---

# Lab deployment blocked at shared checkout; isolated source path (2026-11-18 UTC)

[PR #59](https://github.com/emsebi/EMS_IPAM/pull/59) merged at `faf2e226ff0901891f8bec8d42c5670ae288ec25`. [PR CI 44341748410](https://github.com/emsebi/EMS_IPAM/actions/runs/44341748410), [push CI 44341734238](https://github.com/emsebi/EMS_IPAM/actions/runs/44341734238), and [merge CI 44342101667](https://github.com/emsebi/EMS_IPAM/actions/runs/44342101667) all succeeded. Merge browser job 134934573812 records both import scenarios and 39 browser/API passes at 2026-11-18 16:01:18 UTC. Main `e7ebaae2d943cfe792783f64ac57fd53434e89f3` adds only tested screenshots.

The existing Lab Deploy push branch `work/i18n-personnel-foundation` was fast-forwarded with expected SHA from `588ba9f86a1731ee12c5308ddef2e755131352dc` to the exact tested merge `faf2e226ff0901891f8bec8d42c5670ae288ec25`. [Deployment 44375919531](https://github.com/emsebi/EMS_IPAM/actions/runs/44375919531) failed at checkout (job 135054940400, 2026-11-18 19:01:09 UTC): EACCES removing `/home/emsrunner/_work/EMS_IPAM/EMS_IPAM/.github/workflows`. Backup/build/container replacement/start and all post-upgrade checks were skipped. No new deployment succeeded; the last verified installed build remains `2ca7e975929ea96f7df4e437294ad12f40b19957`.

This patch isolates the host-runner checkout under `lab-deploy-source`, sets all shell steps to that source directory and stages only that checkout. It avoids deleting or changing ownership of the shared workspace root. Existing backup, credentials/volumes, port 8888, module and signed RADIUS smoke gates remain unchanged. Application/module bytes are unchanged from the tested merge; no router configuration or discovery is involved.

Next: inspect candidate CI linked in this PR. If successful, re-read both refs and fast-forward the existing Lab Deploy branch with expected SHA to this tested candidate. Record its run/job IDs in the PR and check checkout, checksum, backup, build, health, data preservation and final smoke. Do not merge or declare deployment success until the complete lab run succeeds. Then merge with fresh main/expected PR head and follow merge CI. Installed-panel import and Radio operator acceptance and real MikroTik login remain open; temporary loopback acceptance is not a device login.

---

# Preserve stored names in localized import destinations (2026-11-18 UTC)

[PR #59](https://github.com/emsebi/EMS_IPAM/pull/59) head `94801f553b7898854418118d2b3f3ccc6df7b45e` failed the browser gate in [PR CI 44331537599](https://github.com/emsebi/EMS_IPAM/actions/runs/44331537599) and [push CI 44331452498](https://github.com/emsebi/EMS_IPAM/actions/runs/44331452498). The other three gates succeeded. Both browser logs failed on the same assertion: the Persian option displayed stored domain name `Default` as `پیش‌فرض` (PR job 134896951180 at 2026-11-18 15:06:28 UTC). The earlier real XLSX file-picker scenario passed before this failure.

The localized compound label was being passed through the legacy Persian substring translator. Import options now use `translate="no"`, as existing search result labels already do. Explicit semantic keys still translate the field label and missing-data fallback, while the stored Space/domain names remain verbatim and HTML-escaped. Stable option/API Space IDs and the original strict English/Persian browser expectations are retained; no assertion was relaxed.

Next: inspect the new CI runs linked in #59, specifically the named same-branch import scenario, all 39 browser/API scenarios, and all remaining gates. Only after success, recheck main/head and merge with expected SHA, then follow merge CI. No deployment until the tested build is ready. Fresh main remains `905d1164bd7b2cac447e3e9401c945286af117b3`; PR #12 remains inactive and requires operator acceptance. Local Chromium's socket restriction still prevents a local browser run; syntax and the existing local UI/import tests are not a substitute for CI browser evidence.

No schema or legacy uniqueness constraint changes, live discovery or router push. Installed build remains `2ca7e975929ea96f7df4e437294ad12f40b19957`; installed-panel import acceptance, Radio acceptance and real MikroTik login remain open.

---

# Routing-domain labels in the Excel/CSV import destination (2026-11-18 UTC)

Fresh main `905d1164bd7b2cac447e3e9401c945286af117b3` is the screenshot-only successor of the #58 evidence checkpoint. [Checkpoint CI 44320301464](https://github.com/emsebi/EMS_IPAM/actions/runs/44320301464) and [merge CI 44320065789](https://github.com/emsebi/EMS_IPAM/actions/runs/44320065789) both finished successfully.

Import destination options now include the existing routing-domain name beside CIDR and Space name, using the existing Persian/English translation keys and escaping the complete label. Missing domain metadata is shown as Not recorded, not guessed as Default. The option value and API destination remain the stable Space ID.

The browser suite reuses the same-branch overlapping-domain fixture (identical CIDR, Space name and host IP). It selects each domain by its visible label in English/Persian, checks preview and commit destination IDs, previews without writes, stable host identity and unchanged sibling records. This new scenario uses CSV through the common Excel/CSV modal; #58 retains the real two-sheet XLSX file-picker test. The overlap constraint change remains test-only. Production schema, authorization, RADIUS and Radio behavior are unchanged.

Next: inspect the named same-branch import scenario and every CI gate for this PR head (run IDs in the PR), then merge with fresh main and expected SHA. Follow merge CI before staging a ready application build with the existing EMS-IPAM Lab Deploy workflow. Preserve backup, installed Radio trial, credentials, volumes and port 8888. Do not remove the legacy uniqueness constraint as part of this UI change. Local browser execution is limited by Chromium socket permissions; syntax/checksum checks alone do not prove browser behavior.

No deployment or real-device discovery was performed. Installed build remains `2ca7e975929ea96f7df4e437294ad12f40b19957`. Installed-panel import acceptance, Radio #12 operator acceptance and real MikroTik login remain open.

---

# Verified XLSX file-picker regression merged (2026-11-18 UTC)

[PR #58](https://github.com/emsebi/EMS_IPAM/pull/58) merged at `44966db01088882798877a85fd3d85fb631e48a4` with expected head `f819a36a39d3456df280c4ce228ea5d2efe25120`, after rechecking unchanged main `9a4bbaa0a73a524692b15dd90b60a26f206ef380`. [PR CI 44310837259](https://github.com/emsebi/EMS_IPAM/actions/runs/44310837259) and [push CI 44310799186](https://github.com/emsebi/EMS_IPAM/actions/runs/44310799186) completed successfully across all four gates: tests/checksums/RADIUS, PostgreSQL, Docker/SSH and browser.

Browser job 134824249437 records the named XLSX file-picker PASS at 2026-11-18 13:10:38 UTC and all 38 browser/API scenarios passed, with no uncaught browser errors. The production HTTP routes, real two-sheet workbook and visible modal were exercised against the disposable PGlite adapter. The test checks explicit Branch/Space selection, invalidation of a stale preview, Unicode/entities/newlines, previews without writes, stable host ID/MAC/VLAN/type, exclusion of invalid/second-sheet rows and unchanged other-branch records sharing the same IPs. PostgreSQL job 134824249371 separately passed all 20 HTTP tests and 7 routing-domain upgrade tests, with no failures or skips. The local Chromium socket-permission failure is an environment limitation; the browser pass is verified from CI, not from the local attempt.

[Merge CI 44320065789](https://github.com/emsebi/EMS_IPAM/actions/runs/44320065789) was started and remains pending at this checkpoint. The checkpoint CI ID/status will be recorded in #58. Next run: check both results before further integration; do not infer their success from PR CI.

Next small code step after those gates: the XLSX destination options in `syncBulkIpamSpaces()` still show only CIDR and Space name. Include the existing routing-domain name so same-named, same-CIDR Spaces are distinguishable; reuse the existing same-branch overlapping-domain browser fixtures to verify the selected destination Space ID and unchanged sibling records. Keep the legacy uniqueness constraint until the remaining MS-03 compatibility gates are proven; no schema rebuild or automatic discovery.

No deployment was performed for this test-only merge. The installed panel remains `2ca7e975929ea96f7df4e437294ad12f40b19957` from [Lab Deploy 44241670216](https://github.com/emsebi/EMS_IPAM/actions/runs/44241670216). [Isolated VM fixture 44271905157](https://github.com/emsebi/EMS_IPAM/actions/runs/44271905157) remains valid separate evidence; do not repeat it solely to record its result. Installed-panel XLSX acceptance, Radio #12 operator acceptance and real MikroTik login remain open. Signed loopback replies do not close the real-device incident.

---

# Verified multisite/import fixture on the dedicated VM (2026-11-18 UTC)

[PR #57](https://github.com/emsebi/EMS_IPAM/pull/57) merged at `8f9c65a3375b52a733f3ed4ab40ccbb93fc7278a` after successful [PR CI 44271912633](https://github.com/emsebi/EMS_IPAM/actions/runs/44271912633), [push CI 44271904972](https://github.com/emsebi/EMS_IPAM/actions/runs/44271904972) and [Lab Import Fixture 44271905157](https://github.com/emsebi/EMS_IPAM/actions/runs/44271905157), all on `38339707048191ad98e2817d33aa9e351ae066d1`.

VM job 134690342000 records the fixture source/time at 2026-11-18 09:04:18 UTC. All 20 HTTP tests passed, with 0 failures and 0 skips, including the named CSV preview/commit and two-sheet XLSX Unicode/branch-identity checks. The TAP artifact `lab-import-fixture` (14411804702) was uploaded. Stop containers passed at 09:04:40 UTC; the job finished successfully. Container initialization was slow but did complete; it is not an unresolved failure.

These were Node 24/PostgreSQL 16 containers on the dedicated runner, using synthetic credentials and tmpfs with no host ports or persistent/host volumes. The suite reused its existing uniquely named disposable database. This is VM runtime fixture evidence, not a test against the live installed-panel database or operator acceptance. The installed panel remains `2ca7e975929ea96f7df4e437294ad12f40b19957` from successful [Lab Deploy 44241670216](https://github.com/emsebi/EMS_IPAM/actions/runs/44241670216); no redeployment was performed for this merge.

Next: inspect main CI for the merge and this evidence checkpoint (run IDs in #57). Then extend the existing Chromium import modal scenario to select `docker-app/tests/fixtures/ipam-two-sheets.xlsx` through its file picker; verify explicit Branch/Space destination, read-only preview, Unicode and preserved other-branch records, using the existing browser fixtures and cleanup. The current browser scenario exercises CSV, while XLSX coverage is HTTP-only. Keep installed-panel XLSX acceptance, Radio #12 operator acceptance and real MikroTik login open; do not repeat the successful VM fixture solely to record its result.

---

# Verified lab deployment and permanent checksum guard (2026-11-18 UTC)

[PR #56](https://github.com/emsebi/EMS_IPAM/pull/56) deployed `2ca7e975929ea96f7df4e437294ad12f40b19957` through [Lab Deploy 44241670216](https://github.com/emsebi/EMS_IPAM/actions/runs/44241670216). The run finished successfully; job 134590807218 on runner `ems-ipam-lab` records final smoke success at 05:10:04 UTC. [Candidate CI 44241489651](https://github.com/emsebi/EMS_IPAM/actions/runs/44241489651) and [release CI 44241670132](https://github.com/emsebi/EMS_IPAM/actions/runs/44241670132) also passed.

Verified evidence: source checksums, private pre-upgrade database backup and existing configuration preservation; health on port 8888; installed IPAM, network-access, network-map, Radio, RADIUS, radius-ops and reports; unchanged RADIUS records, credentials and assignments; signed temporary-loopback replies and cleanup; final Docker/PostgreSQL/FreeRADIUS smoke. This does not establish an independent row-by-row comparison of every other module or a real MikroTik login.

This follow-up removes the dated push trigger from #56 and retains `sha256sum --check --strict SHA256SUMS` before any lab operation. All 306 listed files verify locally; the exact GNU guard rejects both changed bytes and a missing file in an isolated synthetic fixture. Application and module files remain identical to the verified deployment. The release branch remains pinned to the deployed SHA; updating the PR branch does not redeploy it.

Next: check the refreshed #56 CI and merge with expected head after rechecking main, then inspect merge CI. After that, exercise XLSX preview/commit against the installed VM using explicitly synthetic isolated branch/Space fixtures, verify existing branch records are unchanged and clean up only the created fixture IDs. Record this separately from operator acceptance. Do not repeat deployment merely to reconcile this workflow/checkpoint. XLSX hands-on acceptance, Radio #12 operator acceptance and real MikroTik login remain open; signed loopback replies do not close the real-device incident.

---

# Checksum verification before release (2026-11-18 UTC)

Fresh main `f85301babd9e3771db76695e837fbf11eda509a8` is the screenshot-only successor of #54. [Main CI 44227666128](https://github.com/emsebi/EMS_IPAM/actions/runs/44227666128) succeeded, including PostgreSQL, Docker and browser gates.

The 26 stale entries reported in #54 are refreshed in SHA256SUMS. `python3 scripts/checksums.py --check` now runs in CI immediately after checkout, before tests can rewrite generated logs. After reviewing intentional changes, use `python3 scripts/checksums.py --write`; add new paths explicitly. This verifies the existing manifest's listed files, not completeness of an archive or the separate legacy SHA256SUMS.txt. Unlisted local files and credentials are never collected automatically.

Four CLI tests pass: modified binary bytes are detected without rewriting, refresh is repeatable, missing files abort without partial writes, malformed/duplicate/escaping/self paths fail, and unlisted local files stay excluded.

Next: inspect the checksum step and all CI gates for this PR (run IDs in its description). Recheck main and expected head before merge, then follow merge CI. Only after those checks, stage the tested import/UI release through EMS-IPAM Lab Deploy, preserving the installed Radio trial, backup, credentials, volumes and port 8888; record deployed SHA and hands-on XLSX evidence. Last verified VM deployment 44050910476 predates #52. Radio #12 practical acceptance and real MikroTik login remain open.

---

# MS-02 XLSX HTTP import (2026-11-18 UTC)

[PR #53](https://github.com/emsebi/EMS_IPAM/pull/53) and its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/44176884714) passed the CSV regression.

The HTTP suite now imports a real two-sheet XLSX fixture generated by openpyxl 3.1.5, with synthetic RFC 5737 addresses and Persian text. It checks first-sheet selection, Unicode/entities/newlines, read-only preview, Update identity/MAC preservation, Skip retry, invalid-row exclusion and an unchanged other branch.

Next: inspect the named XLSX subtest in the PostgreSQL job and all gates for this PR head. After merge CI, stage the tested import/UI release through EMS-IPAM Lab Deploy, preserving the installed Radio trial, credentials, backup and volumes. Record the deployed SHA and hands-on import evidence. The last verified lab deployment 44050910476 predates #52. Real MikroTik login remains open.

---

# MS-02 CSV import isolation (2026-11-17 UTC)

Fresh main includes #49 and #52. [Lab deploy 44050910476](https://github.com/emsebi/EMS_IPAM/actions/runs/44050910476) succeeded for `a91a0ef0`; its job records persistence and migration-ledger checks after restart. [Main CI 44090032411](https://github.com/emsebi/EMS_IPAM/actions/runs/44090032411) passed after #52. That import/UI change is newer than the deployed lab SHA.

The HTTP suite now checks CSV preview, Skip, repeated Skip, Update, invalid rows, stable host IDs/MACs and exact preservation of the other branch with overlapping IPs. A branch writer and viewer exercise authorization for both endpoints.

Next: inspect the named CSV isolation test in the PostgreSQL CI job and all gates for this PR head. After merge CI, stage the tested import/UI build through EMS-IPAM Lab Deploy while preserving the installed Radio trial, data and credentials. XLSX end-to-end coverage, VM hands-on import acceptance and real MikroTik login remain pending.

---

# Core 003: required routing domains (2026-11-12 UTC)

[PR #48](https://github.com/emsebi/EMS_IPAM/pull/48) and its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43158991262) passed the staged downgrade rehearsal. Core startup now runs 003 after 002 in the existing transaction. It requires a default for every branch, backfills unbound active and recycled Spaces, enforces NOT NULL and adds the branch/domain/CIDR key alongside the existing branch/CIDR key. Explicit domains and access grants are preserved.

Next: verify the named Core 003 restored-database test in the native PostgreSQL CI job and all other gates on the PR head. After merge CI, exercise backup and upgrade on the dedicated VM with the current data preserved. Record preflight, deployed SHA and evidence before considering removal of the legacy key. Radio GPS and real MikroTik login still need operator evidence.

---

# MS-03 staged constraints on the restored database (2026-11-12 UTC)

[PR #47](https://github.com/emsebi/EMS_IPAM/pull/47) merged at `1ac5414`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43138278955) passed.

The native restore test commits the required domain binding and the Company/Domain/CIDR unique constraint after the backfill, alongside the legacy Company/CIDR constraint. An old writer omits the domain and commits a new Space. A separate downgrade removes the staged constraints and checks the previously committed Space, original bindings, hosts, prefixes and access grants. The existing overlap rehearsal uses the same staging DDL.

Next: verify the named committed-stage test in the PostgreSQL 16 CI job. After all gates and merge CI pass, use the staged DDL in a new checksummed core migration with guarded backfill and verify the migration ledger and restart on a restored database. Keep the legacy unique key through this phase. VM and operator acceptance remain pending.

---

# MS-03 transactional backfill rehearsal (2026-11-12 UTC)

[PR #46](https://github.com/emsebi/EMS_IPAM/pull/46) merged at `ae93b21`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43125103965) passed.

On a restored copy after migration 002, run the preflight, then `psql -X --single-transaction -v ON_ERROR_STOP=1 -f scripts/routing-domain-backfill.sql`. The script locks the three tables for the transaction, stops when any company lacks a default, and reports each changed Space with its branch, domain, recycle state and assignment time. It is separate from application startup.

Next: verify the named restored backfill subtest in the native PostgreSQL CI job. It exercises missing defaults (including an empty branch), rollback after UPDATE, committed assignment, and a second run. After merge CI passes, rehearse the next migration phase on a restored copy: enforce the required binding and domain-scoped uniqueness together while retaining the old Company/CIDR constraint, then verify compatibility with the legacy writer and rollback. Production constraints and VM acceptance are still pending.

---

# MS-03 preflight for missing routing domains (2026-11-12 UTC)

[PR #45](https://github.com/emsebi/EMS_IPAM/pull/45) merged at `99d7e30395d3989422b6d6c4d589c7ce6c08afd2`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43117247009) passed.

Run `psql -X -v ON_ERROR_STOP=1 -f scripts/routing-domain-preflight.sql` against the restored database with migration 002 applied. The read-only query reports unbound active and recycled Spaces, and companies missing a default even if they have no Spaces. Each result includes the statement time, company ID and applicable Space and default-domain IDs. An empty result clears only these two preconditions.

The native recovery fixture introduces both types of unbound Space and missing defaults, checks the exact report and verifies that setting NOT NULL fails. It rolls back the simulated faults and repeats the report in a read-only transaction, comparing original records and access grants.

Next: inspect the named preflight test in the native PostgreSQL job and the remaining gates linked in the PR. After merge CI, rehearse transactional backfill of unbound Spaces in a restored copy, including retry and abort on a missing default, before changing production constraints. The VM Radio GPS/uplink trial and real MikroTik login still need operator evidence.

---

# MS-03 browser selection for overlapping Spaces (2026-11-11 UTC)

[PR #44](https://github.com/emsebi/EMS_IPAM/pull/44) merged at `9000e66f64e7c7e6bc6876250a6bab0ef39d1f2b`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43100247391) passed.

The Chromium fixture enables the proposed uniqueness key in its disposable database after the legacy checks. Two identically named Spaces in one branch have the same CIDR, host name and IP. The test selects each visible routing-domain label and checks the requested Space ID and the host ID shown in the dialog. A separate single-Space reader session exercises the non-default domain alone.

Next: inspect the named same-branch host selection in the browser job and all gates linked in the PR. After merge CI, check the migration preflight for unbound and recycled Spaces before changing the production constraint. The VM Radio GPS/uplink trial and real MikroTik login still need operator evidence.

---

# MS-03 HTTP reads for overlapping Spaces in a single branch (2026-11-11 UTC)

[PR #43](https://github.com/emsebi/EMS_IPAM/pull/43) merged at `03a9c8b0585a7f2af4af7096dcb40a3896831978`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43092858972) passed.

The PostgreSQL HTTP fixture uses the proposed uniqueness key in its disposable database. Two Spaces in one branch have the same name and CIDR, and contain distinct hosts with the same name and IP. The test checks exact-IP search and direct Space reads with admin and single-Space reader sessions. It checks the stored identity, source and record timestamp of each authorized result, and a 404 for a direct read of the ungranted sibling.

Next: check the named MS-03 HTTP subtest in the native PostgreSQL job and all CI gates linked in the PR. After merge CI, verify the Space editor and result selection in the browser for same-branch overlaps before enabling the new production constraint. The Radio GPS/uplink trial and real MikroTik login still need operator evidence.

---

# MS-03 rehearsal of CIDR uniqueness within a routing domain (2026-11-11 UTC)

[PR #42](https://github.com/emsebi/EMS_IPAM/pull/42) merged at `9bbc26e9b88e9a7d3032694aa5ce49fa1b02cd89`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43074668042) passed.

The new PostgreSQL subtest runs inside a transaction in the disposable restored database. It makes the domain mandatory, adds uniqueness on (company, domain, CIDR), then removes the old branch-wide constraint. Two Spaces in one branch share a CIDR and host IP across Voice and Default. The test checks the original Space grant and host IDs, rejects a duplicate in Default, tries to restore the old constraint with both networks present, and rolls back the transaction. It checks the original records and legacy constraint again after rollback.

Next: verify the named restored-branch subtest in native PostgreSQL and all CI gates linked in the PR. After merge CI, exercise the production HTTP search and Space-scoped reads with these same-branch overlaps in an isolated PostgreSQL fixture before changing the production migration. VM Radio GPS/uplink and real MikroTik login acceptance remain open.

---

# MS-03 recovery of selected routing domains (2026-11-11 UTC)

[PR #41](https://github.com/emsebi/EMS_IPAM/pull/41) merged at `183f0b2575fd98cd101d5a12f580eacd0c8b1130`. Its [main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43073833560) passed, including browser, PostgreSQL and Docker.

The native PostgreSQL recovery fixture now assigns a distinct non-default domain named Voice to each of two branches with the same CIDR and host IP before taking the upgraded backup. It restores the custom-format dump into an empty database, starts the application migrations, and compares stored domain IDs, Space bindings, hosts, prefixes and grants with the pre-backup data. The pre-upgrade recovery and recycled Space checks remain in the same test.

Next: inspect the named PostgreSQL backup test and the remaining CI jobs linked in the PR. If green, recheck main and the expected PR head before merging. The production uniqueness constraint still prevents duplicate CIDRs within one branch. The VM Radio GPS/uplink trial and real MikroTik login remain open.

---

# MS-03 portable subnet source identity (2026-11-11 UTC)

[PR #39](https://github.com/emsebi/EMS_IPAM/pull/39) merged at `a00e0a77d60dbf2dceb52a3c9d21dbbede756122`. [Main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43054820108) passed, including the browser, PostgreSQL and Docker gates.

Version 1 subnet exports record the originating company, Space and routing domain alongside the existing export timestamp. Import still writes to the explicitly selected, authorized destination Space. The HTTP round-trip test imports a legacy file in skip mode and a newly exported file in replace mode. The native PostgreSQL fixture uses matching CIDRs and identically named non-default domains in two branches. It checks that source records, destination domain and radio parent relationships survive the transfer.

Next: check the portable v1 round-trip in the PostgreSQL CI job on this branch and the other gates before merging with the expected SHA. The PR tracks the run IDs. Same-branch duplicate CIDRs remain blocked. Real Radio GPS/uplink and MikroTik login acceptance are still open.

---

# MS-03 integration with Radio 2.3 (2026-11-11 15:05 UTC)

PR #39 now includes main `dae9f0272e3950761236943855f0dd7f16e674fe` and its tested Chromium setup on Ubuntu 24.04. The earlier [PR browser job](https://github.com/emsebi/EMS_IPAM/actions/runs/43035020689/job/130571464967) stopped during the Ubuntu package install, before the Space scenario ran. The [1.7.1 main CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43040612289) passed before this integration.

The integrated HTTP and Radio tests passed 18 cases locally, with two PostgreSQL-only cases skipped. Follow the new run IDs in [PR #39](https://github.com/emsebi/EMS_IPAM/pull/39). Check the browser report for both the Space domain selector and Radio multi-AP scenarios, and the native PostgreSQL and Docker results before merging at the expected head. The live Radio GPS/uplink save-and-reload and real MikroTik login still require operator evidence.

---

# MS-03 checkpoint — Space editor routing-domain selection (2026-11-11 UTC)

[PR #38](https://github.com/emsebi/EMS_IPAM/pull/38) merged at `9ee8cf09ff5e4512572536783af2ce471be5370e` after [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43025337351) passed. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43034180364) is tracked separately.

The Space form shows the owning branch's stored domain options. Only the admin's editor bootstrap receives these lists, including unused domains. Internal search bootstrap calls omit them. A new Space starts on the branch default; an existing Space opens on its saved domain or shows an unbound value. The form submits an ID only when the operator changes the selection. Stored option names are rendered as text and excluded from legacy UI translation.

Local multisite HTTP tests passed 15 with two native-only skips. The browser fixture exercises creation in a second domain, ordinary editing without resubmitting the ID, and opening other branches that only have their own default. The source is recorded IPAM configuration. No router or VM operation was performed.

Next: use the run IDs in the PR to verify the named Space editor browser check and all PostgreSQL, Docker and core gates, then merge with expected head after rechecking refs. After merge CI, verify portable import/export compatibility with non-default domains before changing CIDR uniqueness. Radio GPS/uplink persistence and real RouterOS login acceptance remain open.

---

# MS-03 checkpoint — explicit routing domain on Space writes (2026-11-11 UTC)

[PR #37](https://github.com/emsebi/EMS_IPAM/pull/37) merged at `ff71db58f32434805090f6a915e272fca91b4fb6` and [merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/43000370623) passed. Base `a9e9230d0f9a644094f0b33c67794c8e274c8aa7` includes the published screenshot.

The existing admin-only create and edit Space endpoints accept an explicit routingDomainId. The composite foreign key checks domain ownership in the write itself. Unknown and other-branch domain UUIDs produce the same 409 response; malformed IDs produce 400. An omitted or null selection uses the branch default on creation and preserves the stored binding on edit. Audit records the resulting stored domain. The per-company CIDR constraint remains active; the UI does not yet offer domain selection.

All 17 multisite HTTP tests passed on isolated PostgreSQL 16.15. The new test seeds a second domain in the North fixture and verifies explicit creation and reassignment, ordinary edits, atomic conflict responses, admin-only writes, other-branch read denial, and the audit trail. These are IPAM record operations; no device observation or deployment occurred.

Next: check the named "MS-03 explicit Space writes enforce domain ownership and preserve legacy edits" test in the PostgreSQL job and the core, Docker and browser gates linked in the PR. Recheck main and PR head before merging with expected SHA. After merge CI, expose a branch-scoped list of eligible routing domains to the Space editor and test default/explicit selection and an unchanged legacy edit. Keep the existing CIDR constraint while import/export/restore compatibility is verified. Radio 2.3 user GPS/uplink acceptance and real RouterOS Full/Read login remain open.

---

# MS-03 checkpoint — preserve recorded names in bilingual search (2026-11-11 UTC)

[PR #37](https://github.com/emsebi/EMS_IPAM/pull/37) at `48f22e00b414424452956ec7debc908ad6f15fff` passed the [native PostgreSQL search test](https://github.com/emsebi/EMS_IPAM/actions/runs/42991858994/job/130426412007), core and Docker. Both browser jobs failed the same bilingual prefix assertion ([PR](https://github.com/emsebi/EMS_IPAM/actions/runs/42991858994/job/130426411638), [push](https://github.com/emsebi/EMS_IPAM/actions/runs/42991808652/job/130426244291)). The Persian DOM translator replaced the stored domain name `Default` with `پیش‌فرض` after rendering.

On the same PR, the labeled search metadata is already localized and now opts out of a second text translation. The branch, Space, domain and evidence strings remain escaped. The two-branch browser fixture now uses a Space name containing translation-dictionary entries in both languages and retains the exact domain-name assertions. A local DOM check reproduced the original failure and verified both languages with the production renderer and mutation observer, including null and mixed-language values. The HTTP and language suites passed 27 checks with one native-only skip.

Next: check the replacement PR and push runs linked in the PR body. Inspect the Chromium job for bilingual duplicate-prefix selection and mixed registered/unregistered results, plus the native PostgreSQL, Docker and core jobs on the new head. If successful, recheck refs, merge with the expected SHA and check merge CI. Then test explicit domain selection on Space writes as described below. Radio 2.3 on the VM still awaits user GPS/uplink acceptance; RouterOS Full/Read login awaits real-device evidence.

---

# MS-03 checkpoint — recorded routing domain in multisite search (2026-11-11 UTC)

[PR #36](https://github.com/emsebi/EMS_IPAM/pull/36) merged at `49a640b29ddea407abc1b76d7b1cfbc5a5f97409` using expected head `df3941a02d464c636d798f4610c401d7f1921386`. The [PostgreSQL job](https://github.com/emsebi/EMS_IPAM/actions/runs/42985290970/job/130404911670) passed the Space-grant list and count regression. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42991162041) passed. The search change starts at `a57ab3f018627de149a41109ba854fbf790cc7b8`.

Mixed and paged search return routingDomainId and routingDomainName for hosts, prefixes and unregistered IP candidates. Search displays the name beside Branch/Space in both languages and marks a missing binding as unrecorded. The source is stored IPAM inventory; the existing record-update and live-observation fields retain their meaning.

All 16 multisite HTTP tests passed on isolated PostgreSQL 16.15. Coverage includes identical addresses in two branches, company vs. Space grants, a renamed domain, an unbound Space and free-IP results after the first page. The local Chromium process could not create its singleton socket. The bilingual label assertions are in the CI browser suite.

Next: use the run IDs in the PR description to check the named MS-03 search test in the PostgreSQL job, the bilingual search/selection checks in the browser job, and the two remaining jobs. Merge with the expected PR head after rechecking main. After merge CI, test explicit domain selection on Space writes: verify branch ownership, preserve the existing binding on an ordinary edit, and retain the current per-company CIDR constraint. The Radio 2.3 trial still awaits AP/Station GPS and uplink save/reload acceptance; real RouterOS Full/Read login is open.

---

# MS-03 checkpoint — routing domains on authorized Space reads (2026-11-11 UTC)

[PR #35](https://github.com/emsebi/EMS_IPAM/pull/35) merged at `3252ca89509ba528d9e6007fe9c50265b8d45d1e` after [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42976797467) passed the startup and backup/restore tests. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42984619078) succeeded. The next branch starts at `d6420408a140a7296777ecbe91aa174eec8bcde9`.

Bootstrap, company Space lists and individual Space data now return the recorded routing domain ID and name from the owning company's IPAM record. An unbound Space returns null. The company page's Space list and its host, prefix and radio totals now respect individual Space grants. There is no router observation timestamp for this stored relationship.

The production HTTP fixture passed all 15 tests on native PostgreSQL 16.15. It checks distinct domain IDs for an identical CIDR in two branches, a renamed domain from the database, and a Space-only reader with an ungranted sibling in the same branch. The embedded run passed 14 with the native-only check skipped.

Next: read the PR's linked CI runs on its exact head. Check the named MS-03 Space-read test in the PostgreSQL job, then recheck main and the PR head before merging. After merge CI, carry domain identity into authorized search results and their branch/Space labels. The Radio 2.3 VM trial still awaits the user's AP/Station GPS and uplink save/reload check. The RouterOS Full/Read login incident still awaits real-device evidence.

---

# MS-03 checkpoint — versioned default routing domains (2026-11-11, Tehran)

[PR #34](https://github.com/emsebi/EMS_IPAM/pull/34) merged at `da51bae3c4cb037064b4ba2334a2fa42ccf5f4b9` using expected head `3368f927a05366bf3a9b2ce37581c387d7dc0802`. The [browser](https://github.com/emsebi/EMS_IPAM/actions/runs/42956914683/job/130314080157) verified the owning branch on identically named Spaces. The [PostgreSQL job](https://github.com/emsebi/EMS_IPAM/actions/runs/42956914683/job/130314080467) verified rejection of wrong-branch edits. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42962605230) passed. Base `3b76256f276e1a8b6787e6525145cee003b391a2` adds the published Radio screenshot.

On `work/ms03-default-domain-migration`, Core now runs the additive SQL as migration 002 under the existing startup transaction, advisory lock and checksum ledger. The original baseline is unchanged. Existing branches get one default each; their active and recycled Spaces retain their IDs and receive the matching binding. Inserts from old clients also assign defaults. The composite foreign key enforces branch ownership. The existing per-company CIDR constraint and nullable domain column remain in place. This phase does not enable duplicate CIDRs in separate VRFs within a branch.

Native PostgreSQL 16.15: 14 multisite HTTP tests and both migration tests passed with no skips. A full custom dump before upgrade restored into a blank database; startup upgraded it twice without changing legacy records or grants. Dumping the upgraded database and restoring it into another blank database retained the domain IDs, Space bindings and migration ledger. Creating a branch and Space after that restore also assigned its default. The embedded core suite passed 233 tests, with the two native-only checks covered separately.

Next: check the named startup HTTP test and the pre/post-upgrade backup test in the PostgreSQL CI job plus all remaining gates on the exact head; run IDs are in the PR description. If green, recheck refs, merge using expected SHA and verify merge CI. Then expose the owning domain ID and name on authorized Space reads and test two branches sharing a CIDR before changing search or enabling non-default domains. The [Radio 2.3 VM trial](https://github.com/emsebi/EMS_IPAM/pull/12) still needs practical AP/Station GPS and uplink save/reload acceptance. RouterOS Full/Read login remains open. No deployment.

---

# MS-10 checkpoint — branch identity in ordinary Space edits (2026-11-11, Tehran)

[PR #33](https://github.com/emsebi/EMS_IPAM/pull/33) merged at `b38930200cb82cfdce8e9d2b922515be293c7c44` with expected head `309d043b3beb9fcff0f944564aea1dffe46ef2dc`. The [PR run](https://github.com/emsebi/EMS_IPAM/actions/runs/42950061064) and [push run](https://github.com/emsebi/EMS_IPAM/actions/runs/42950032278) passed all four gates. The [PostgreSQL job](https://github.com/emsebi/EMS_IPAM/actions/runs/42950061064/job/130292001245) ran the portable radio-link test. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42956330406) passed; the subsequent main commit `9894ba706cec5cd2f1739b4155827b0f262c5ea9` only publishes a screenshot.

On `work/ms10-space-edit-owner`, the Space form shows the owning company or branch read-only, including when two branches use the same range and name. Previously an ordinary Space PUT with a different companyId returned 200 and saved the submitted metadata on the original branch. The new 409 response rejects the entire mismatched request before mutation. The update remains scoped to the owner at write time. Existing clients can omit companyId or supply the current owner. Cross-branch transfer with ownership history and grant reevaluation remains a separate MS-10 feature.

The new HTTP test reproduced the unwanted 200 on the previous code. With the fix, native PostgreSQL 16.15 passed all 14 multisite HTTP tests with no skips, including unchanged host/prefix data, direct Company/Space reader access, forbidden reads and writes, and accepted edits with and without companyId. Local Chromium was blocked before browser startup (process-singleton socket not permitted). Exact run IDs and results are in the PR description.

Next: check the named HTTP and “Space editor shows the owning branch for both identically named ranges” browser results on this exact head. Verify all four CI gates and merge with expected SHA if green. Then implement the additive, versioned default routing-domain migration using the rehearsed SQL and an upgrade fixture. Keep existing Space IDs, nullable compatibility with legacy writers, and the original CIDR uniqueness constraint at this stage; test fresh and upgraded databases before deployment. The [Radio 2.3 trial](https://github.com/emsebi/EMS_IPAM/pull/12) remains on the VM pending user GPS and uplink save/reload acceptance. Real RouterOS Full/Read login remains open.

---

# MS-03 checkpoint — portable subnet import across overlapping branches (2026-11-11, Tehran)

[PR #32](https://github.com/emsebi/EMS_IPAM/pull/32) merged with expected head `5c7fc76dc119109ae1c7cfdf497aab89662831b1` at `8846c50ed427541b527fed9ad2851a1796eae917`. The [PR run](https://github.com/emsebi/EMS_IPAM/actions/runs/42943585916) and [push run](https://github.com/emsebi/EMS_IPAM/actions/runs/42943911280) passed. The [PostgreSQL job](https://github.com/emsebi/EMS_IPAM/actions/runs/42943585916/job/130270913588) ran the legacy HTTP writer test without skipping. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42949467057) passed. The next main commit `9e8891bae977a63d6da243dfb3b14d9e5db1d2d8` updates only the published Radio screenshot.

Branch `work/ms03-portable-radio-links` fixes a format-v1 round-trip defect in Core IPAM. An exported host uses sourceId/sourceRadioParentHostId, while the importer read only the legacy field names. On an unmodified server the newly imported Station lost its AP. The importer now resolves only APs mapped within the explicit destination Space, preserves previously skipped Stations, and leaves a Station unlinked if its AP was skipped against an ordinary or deleted host. Replace retains destination host IDs. Ambiguous duplicate host identifiers or IP strings are rejected before writes. No change to the Radio module or production schema.

Local native PostgreSQL 16.15 passed all 13 multisite HTTP tests with no skips, including a real prefix export and both import modes between two branches sharing the same CIDR and radio IPs, on the expanded trial schema. The four portable package tests passed. Check the PR description for the exact head, run IDs and any later results.

Next: verify the named “portable subnet round-trip remaps radio parents only inside the selected branch” scenario in the PostgreSQL job, all four gates, and the current base and head before merge. After integration, check what an ordinary Space edit does when the requested Company differs, including the original host IDs and grants; keep an explicit transfer with ownership history separate (MS-10). The old unique constraint still applies. The VM stays on [Radio 2.3](https://github.com/emsebi/EMS_IPAM/pull/12) pending user save/reload acceptance of GPS and uplink. Real RouterOS Full/Read remains open.

---

# MS-03 checkpoint — live legacy HTTP writes during the routing-domain trial (2026-11-11, Tehran)

[PR #31](https://github.com/emsebi/EMS_IPAM/pull/31) merged at `8d922a97060879682f61867ecfe6448d640da0bf` using expected head `7d498b963d634974e3b384cb54dd9b118a865dd5`. [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42929239692) and [push CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42929206814) succeeded. The [PostgreSQL 16 job](https://github.com/emsebi/EMS_IPAM/actions/runs/42929239692/job/130223481309) restored a pre-upgrade dump and compared original records and grants in a second database. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42942949067) succeeded. Its screenshot-only follow-up is the base for this step, `3061e0a0e1241f2c93e3e8c7b32a21bd42400334`.

Branch `work/ms03-legacy-http-writes` exercises the running production HTTP server in a disposable native PostgreSQL database. A separate connection applies the trial schema and backfill. Current admin requests edit an already-assigned Space and create a new Space without specifying a domain. The existing host/prefix IDs survive, a duplicate receives 409, and a second backfill attaches the new Space to its own branch default. During and after backfill the Company-scoped reader can open the new Space and the other branch’s Space-scoped reader receives 404. The reader’s allowed Space and host stay accessible. All 12 multisite HTTP tests passed locally on PostgreSQL 16.15, with zero skips. Both upgrade tests continue to share the same test-only SQL. Exact CI run IDs are recorded in the PR description.

Next: verify the named “MS-03 legacy HTTP writes and scoped reads survive the default-domain backfill” test ran in the PostgreSQL job and both CI runs passed on the PR head, then merge with its expected SHA. Before production DDL, check the existing Space edit and portable import/export paths for ownership changes. The ordinary Space PUT updates name/CIDR/metadata and currently does not transfer ownership; model transfers and grant reevaluation separately (MS-10). Keep the legacy CIDR constraint through compatibility tests.

VM remains on [Radio 2.3](https://github.com/emsebi/EMS_IPAM/pull/12) pending user confirmation of GPS and uplink after save/reload. Actual RouterOS Full/Read login remains open. No deployment or production schema change. Reconcile pre-existing release manifest differences before packaging.

---

# MS-03 checkpoint — recovering the pre-upgrade database (2026-11-11, Tehran)

[PR #30](https://github.com/emsebi/EMS_IPAM/pull/30) merged at `991d6edc601b64afafac747ad2537d7d82d0a0ca` with expected head `c76995fd9b4babe123519e02f7869734dc823ed9`. All four gates passed on [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42920708907) and [push CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42920671320), including the named native PostgreSQL rollback/retry test. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42928612859) succeeded. Base `5413c8b541eda2faf9e26076ef7c50f892d8b789` adds only a published screenshot.

Branch `work/ms03-native-recovery` tests a full legacy PostgreSQL custom-format dump before the trial upgrade, restores it into a separate blank database, compares rows and old schema shape, and retries the trial upgrade on the recovered database. The fixture covers overlapping branches, recycled Space, two hosts and prefixes, a user and both types of grants. Local PGlite rollback/retry passed. Native recovery runs in the PostgreSQL 16 CI job with the service's own pg_dump and pg_restore binaries. Exact run IDs and results belong in the PR description.

Next: inspect the named “MS-03 pre-upgrade PostgreSQL backup restores legacy identities and grants into a fresh database” result on the branch head and all four CI gates. If green, merge with expected SHA. Then exercise legacy HTTP create/edit and scoped reads against the expanded schema; check transfer semantics separately before implementing MS-10. Keep the original CIDR constraint and production schema until the compatibility plan is tested.

VM still runs the [Radio 2.3 trial](https://github.com/emsebi/EMS_IPAM/pull/12), pending coordinate and uplink save/reload acceptance. RouterOS Full/Read login still needs device evidence. No deployment.

---

# Current checkpoint — MS-03 default-domain upgrade rehearsal (2026-11-11, Tehran)

[PR #29](https://github.com/emsebi/EMS_IPAM/pull/29) merged with expected head `f450d2dd362a255e2481be339514f459b5c05a02` at `91835cde6ba23f0b5bc72655b829fb411a52fa7e`. All four gates passed on [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42911993805) and [push CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42911944577). The browser logged 31 passing scenarios including retention of form values on a duplicate CIDR. PostgreSQL verified the create/edit conflict with both original Spaces and hosts intact. [Merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42920110806) also succeeded. Base `014b53867ea15ba6caca485b64d85a8da1cdce40` includes the automatic screenshot publication.

Branch `work/ms03-default-domain-rehearsal` adds a test-only rehearsal using the current baseline schema. Two branches share a CIDR and host IP. The test checks active and recycled Spaces, an empty branch, original hosts/prefixes and Company/Space grants. A cross-branch assignment fails the composite foreign key after backfill; rolling back restores the original schema and data. Retrying assigns one stable default per company. An old-style Space insert still succeeds and a repeat backfill catches it, while the old duplicate-CIDR constraint remains effective. The rehearsal passed locally on PGlite. Nothing invokes this SQL at application startup.

Next: inspect the new test by name in the PostgreSQL 16 job and all four gates on the exact PR head. Run IDs and handoff are in the PR description. If green, merge using its expected head. Before enabling a production migration, rehearse a real backup/restore round trip and writes by the old application during the compatibility window, including creation and transfer of Spaces. Keep the existing CIDR constraint through import/export/search compatibility checks.

The VM retains the [Radio 2.3 trial](https://github.com/emsebi/EMS_IPAM/pull/12) pending AP/Station coordinate and uplink save/reload acceptance. RouterOS Full/Read device login remains open. No deployment.

---

# Current checkpoint — same-branch CIDR conflicts (MS-03), 2026-11-11

[PR #26](https://github.com/emsebi/EMS_IPAM/pull/26) merged at `6b2c0814c16fa98834bd05f9ed787a269ca3885c` with expected head `3b0619afc805a4d5617a97cc22bc7fd269d6a24c`. Both [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42901691973) and [push CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42901682406) passed all four gates. Browser logged 30 passing scenarios including selection beyond 40 mixed results without creating a host. [Merge CI 42911053587](https://github.com/emsebi/EMS_IPAM/actions/runs/42911053587) succeeded. The next main commit `535fec9f24c3b47a9e249f19c8bbcad240db87db` changed only the published Radio screenshot.

On `work/ms03-space-cidr-conflict`, the Space editor now explains the same-branch CIDR / separate-VRF limitation on an actual database conflict, preserves form input and distinguishes this 409 from other conflicts. The migration design is in the MS-03 section of the multisite contract. This change ships no DDL and does not enable multiple routing domains. Local HTTP/PGlite: 11 tests passed, including create/update conflicts and retained host/Space identity. Local Chromium was blocked at launch (process-singleton socket denied); the PR body tracks exact CI IDs. Next: inspect the inline-error browser scenario, PostgreSQL multisite test and all four gates on the PR head. If green, merge with the expected SHA. Then rehearse the additive default-domain backfill and retry/rollback in a disposable legacy PostgreSQL fixture before enabling any schema change.

VM still runs the Radio-only 2.3 trial. Main would replace it; GPS and uplink persistence and multi-AP acceptance on [Radio #12](https://github.com/emsebi/EMS_IPAM/pull/12) remain open. RouterOS device login and Full/Read also remain open. No deployment.

---

# Current checkpoint — unregistered IP results in quick search (2026-11-11, Tehran)

[PR #26](https://github.com/emsebi/EMS_IPAM/pull/26) now integrates its existing scoped search API with quick search on main `dc9fcdd364f747855b53bc8979e16bad642e3dcd`. Prior backend head `346cf809d006e8cb67a90df2f223593a35e31c97` passed all four jobs on [PR CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42349722184) and [push CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42349718439). Those runs predate the panel changes.

The mixed search API returns a continuation offset only if another authorized Space contains the queried IPv4 without a registered host. The panel continues at that offset, including zero when other result types occupy all 40 slots. Each page checks current access. The panel retains the existing hits and distinguishes candidates by Space in this exact-IP query. Its Persian/English button uses the existing retry and stale-response handling. Opening a candidate selects its Space. Inventory absence does not verify network availability. No schema changes.

All 227 local Node core tests passed, including the HTTP regression with 43 synthetic branches and both zero and nonzero continuation offsets. The Playwright regression uses 42 overlapping branches, one active registration, two candidates beyond the mixed limit, then checks the selected Space and absence of an unintended write. Local Chromium could not start because the process-singleton socket was denied. The PR description records the new commit's Actions run IDs and test results. Next: check the browser scenario and all four CI jobs on this exact head, recheck current main/PR refs, then merge with the expected head if green and conflict-free. If a check fails, fix the first failing assertion on this branch.

The installed Radio-only 2.3 trial has a [successful deployment run](https://github.com/emsebi/EMS_IPAM/actions/runs/42467626009). Main contains the earlier Radio 2.2 port. A full deployment would replace that multi-AP trial. Preserve it pending AP/Station GPS and uplink save/reload and user acceptance on [draft #12](https://github.com/emsebi/EMS_IPAM/pull/12). RouterOS login and Full/Read still require device evidence. No deployment from this step. Reconcile inherited release manifest drift before packaging.

---

# Checkpoint — Geographic Radio Map and real GitHub screenshots, 2026-11-08

Radio geographic map PR #28 was merged to main at 4c567bb5b00fe625c3b14fbca533aa39b5319390. All four exact-head gates (test, browser, PostgreSQL, Docker/SSH) passed on each PR workflow. The real browser test saved GPS for fixture AP2/Station2, verified location persistence, the map frame pins, the AP–Station line and geographic distance. The map is displayed above the detailed Radio topology list; no network devices are polled automatically.

Main-push CI 42466631002 passed four gates plus the new publish-browser-screenshots job. Six real browser PNG images have been committed in docs/screenshots/real: radio-geographic-map, operations-ipam, operations-sites, operations-radio, operations-radius and operations-network-snapshot. README now embeds all six (commit 3402b5fe0989573fde56a393376a6a97f9e5c39d). Screenshots use temporary fixture records and real API/browser tests, not generated imagery or a capture from the user's physical VM.

VM remains unchanged. Preserve the Radio-only installation and user data; actual AP/Station location Save→reload, GPS link/distance, and AP uplink Save→reload acceptance are still open. RADIUS login/Full/Read on real RouterOS remains OPEN and NAC remains Preview. The legacy draft PR #12 contains historical changes and must not be merged wholesale; Radio module was ported in isolation through PR #28. Main can now include Radio PostgreSQL migrations without reverting that module's code, but do not claim VM validation from CI or replace deployed files without data backup and deployment comparison.

Next: physical VM user acceptance for Radio GPS/AP/Station/uplink and RADIUS RouterOS login. Continue full network discovery, NAC and other mockup-to-functional work as separate bounded increments, each with exact-head CI and actual browser evidence.

---
# Current integration work — five-tab real-data Operations Overview (2026-11-08)

PR #27 (`work/live-ops-dashboard-20261108`) adds an admin-only read-only module under `modules/operations-overview/`, without modifying core schema, NAS/RADIUS policies, existing Radio files or network collection routes. The source reuses existing APIs and has IPAM/Inventory, Sites/Branches, Radio AP–Station relationships, RADIUS groups/NAS Collections/access assignment/events, and saved topology tabs. GPS distance appears only if both endpoints have valid coordinates; ping/scan status is never fabricated. Deep links return to existing management pages.

New Node contract tests and actual Playwright browser checks verify five tabs, AP membership (AP Two shows Station Two, not Station One), reading real RADIUS collection, no automatic network-map write/scan, and screenshots from PGlite-backed HTTP fixtures. Both exact-head runs on `0770a77250a28785fee092e0f55700545cd1b119` had all four gates SUCCESS: Core/tests, browser, real PostgreSQL/multisite and Docker/SSH. Representative browser artifact on [run 42414198797](https://github.com/emsebi/EMS_IPAM/actions/runs/42414198797) contains five `operations-*.png` screenshots. Screenshots are actual app browser tests with synthetic test data, **not current user's VM**. Further docs-only commits need their own exact-head CI before merge.

IMPORTANT: This is a first functional integrated overview, **not** completion of the five conceptual mockups. Full IP utilization/availability, geographic Radio basemap and position persistence, live-status monitoring, active Cisco/MikroTik discovery verification and RouterOS Full/Read acceptance are separate pending milestones. No invention of data, credentials, devices, online state or claimed deployment.

Next:
1. Recheck PR #27 exact-head CI after README/continuation changes, plus fresh main. Merge only if all four checks on the same head succeed and it is conflict-free. The new module can be installed on a fresh isolated test VM via existing README installer, but user VM deployment is **held**.
2. Preserve open Radio PR #12 with installed EACCES fix until user verifies GPS/AP/Station/uplink save–reload on VM; deploying main now could overwrite that correction.
3. Continue the user-requested real functionality in bounded increments: branch IPAM utilization from authoritative allocations; branch contact/detail UI actions; Radio map based on persisted GPS with AP/station lines and distance; richer RADIUS NAS Collection/group policy maps and real RouterOS login acceptance; Smart Network Map using explicit saved/manual discovery and status timestamps. Each step requires test evidence and genuine browser screenshots before presentation.
4. PR #26 unregistered-IP pagination is separate and must be evaluated on its own exact head; preserve its existing behavior.

---
# Scoped unregistered IP search pages (2026-11-07)

PR #25 merged at `8218f8010c202732676c648b40ff9ee198b975ba` with expected head `703ccf8bdb78f9809aa6a7e687cbcafaad4b0312`. Both runs [42345676840](https://github.com/emsebi/EMS_IPAM/actions/runs/42345676840) and [42345659184](https://github.com/emsebi/EMS_IPAM/actions/runs/42345659184) passed all four jobs. The browser job recorded 27 passing scenarios including overlapping host/range pages. [Main merge CI](https://github.com/emsebi/EMS_IPAM/actions/runs/42349370320) also succeeded.

`GET /api/search?kind=free-ip&q=<IPv4>` pages through the authorized Spaces containing that address, most-specific CIDR first with Space ID breaking ties. It excludes active host registrations before applying limit/offset. The mixed endpoint retains its original 40-result limit. Candidate evidence is inventory-only, availability unverified, with no observation or edit time. Alternate decimal spellings of an exact IPv4 query use the stored canonical address. Each page reads current grants. Like existing host/range paging, offsets do not give snapshot isolation during concurrent changes. No schema or UI change.

All 10 local HTTP/PGlite checks passed. The new fixture exercises 43 synthetic overlapping Spaces, registered and soft-deleted hosts, both page boundaries, revoked access, branch/Space metadata and the mixed endpoint. Next: check both exact-head Actions runs recorded in this PR, particularly the multisite test on PostgreSQL 16. Only merge with a fresh base and expected head after all four jobs pass. Next UI step: expose free-IP paging for an exact address even when the mixed list has no candidate in its first 40 rows. Deduplicate by Space and IP, retain other result types, and verify selecting a later candidate opens the correct Space without writing a host.

Radio #12 awaits the user's AP/Station GPS and AP uplink save/reload on the installed lab version. No deployment. Actual RouterOS login and Full/Read remain open. Before packaging, reconcile the inherited SHA256SUMS mismatch for docs/test-results/embedded-server.log (reproduced on the exact merge tree before tests).


---
# Concurrent host and range search pages (2026-11-07)

PR #24 merged at `8cc30ffe28b47d2855341834344b15a3f2c00a14` with expected head `65e4c31c038e349ed1d9c3ac210014c87405d429`. Its PR run [42340841020](https://github.com/emsebi/EMS_IPAM/actions/runs/42340841020) and push run [42340807406](https://github.com/emsebi/EMS_IPAM/actions/runs/42340807406) both passed all four jobs. The browser job logged 26 passing scenarios, including failed first/later pages and successful retry. The [main merge run 42345298002](https://github.com/emsebi/EMS_IPAM/actions/runs/42345298002) also passed all four jobs.

New browser regression on `work/search-page-overlap` uses the existing two synthetic branches and a single IP fragment matching more than 40 hosts and 40 ranges. It delays a real host response on page one and a real range response on page two, processes the other response first each time, then checks every displayed name/address/branch against the full scoped API results and verifies both lists end. No product or schema change. Local syntax check passed. Local Chromium stopped at startup (process_singleton_posix socket, Operation not permitted). Check this PR's exact-head CI and browser assertion before marking the new regression verified. CI run IDs and the local HTTP result are tracked in the PR body.

Next: inspect the browser log for the overlapping-pages scenario and all four gate results. If any fails, fix the first failing assertion on this branch; otherwise merge with freshly verified base and expected head. Then extend scoped typed paging to unregistered IP candidates, using two or more authorized Spaces sharing a CIDR, explicit evidence labels and a grant revoked between pages. Check legacy mixed search and prior host/range pagination. Company/personnel results also remain capped.

VM deployment remains held for actual user acceptance of AP/Station coordinates and AP uplink save/reload on Radio #12. Actual RouterOS login and Full/Read are still open; NAC is preview only.

---

# Current work — retry a failed host or range search page (2026-11-07)

Main de1b02a48362a2a9d2ad8e74937e192b4ac331bc includes PR #23. Both PR-head runs (42309930831 and 42309901018) passed all four jobs, as did main push 42315092457. The existing work/search-page-retry-tests branch still pointed to that merge; resumed the unfinished browser fixture there.

A failed host or range page now exposes a localized, kind-specific retry button. Retrying keeps the displayed candidates and asks for the same query and offset. The browser regression interrupts the first and second page once each for hosts and ranges, checks that the menu and candidates survive the error, clicks retry, and checks the real HTTP response, deduplication and terminal page. Covers the Persian host and English range retry labels. No endpoint or schema change.

Local verification: both JS syntax checks and all nine multisite HTTP/PGlite tests passed. The default parallel full suite had one fixture startup failure (loopback ECONNREFUSED, 206 passed); see the PR for the serial rerun. Local Chromium failed to start (process_singleton_posix socket: Operation not permitted). The browser assertions require the new commit's CI. Exact-head run IDs and latest observed status are tracked in the PR description. Next: check those runs, diagnose any first failing request/assertion, and only merge after all four gates pass on the expected SHA and main is current. Then cover overlapping host/prefix page responses, followed by remaining capped result kinds.

VM gate: PR #12 Radio GPS/AP/Station/uplink save-and-reload still needs actual user acceptance on the deployed fix. No deployment this step. Real RouterOS login/Full-Read remains open; NAC remains Preview.

---

# Current work — prefix load-more UI and stale-page browser regression, 2026-11-07

PR #22 merged with expected head e95bf0099d875c6e4562380265390befc958bf40 as d3701583c903976a43c23a436311e558820970d3. Both CI 42309355874 and 42309320209 completed SUCCESS; all four job lists verified (Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP and Docker/SSH). Fresh main rechecked at that merge before this UI branch. Post-merge runs 42309665853 and 42309592834 both report completed SUCCESS. Radio PR #12 unchanged; actual-user acceptance is still missing.

Quick search now offers Browse all matching ranges / More ranges using kind=prefix. The existing host paging implementation is shared, with independent per-kind page/loading/error state. A first typed page replaces only its own kind; other candidates survive, later pages deduplicate by kind/ID. Query changes/clear/selection invalidate both page identities and generations; disabled loading buttons and outside-click protection are retained. Branch/Space/source/edit time and exact space/prefix navigation remain unchanged. No API/schema change; company/personnel/unregistered pagination remains outstanding and offset pages are not concurrent-edit snapshots.

New real browser fixture: 42 prefixes across the two synthetic branches with matching CIDRs, plus a retained host. Traverse both pages, preserve host/paging controls, require terminal state, select each branch's later-page prefix and assert its exact prefix ID/Space. Hold an actual prefix HTTP response, change query, then verify the stale page cannot replace the new results; assert loading button disabled. Existing host/Radio/RADIUS/browser scenarios retained. Both modified JS files pass syntax checks; all nine local multisite HTTP/PGlite tests passed. The new browser scenario has NOT been verified locally (known Chromium socket restriction); exact-head CI is required.

Exact next step: inspect this PR's exact-head CI IDs/status in its body and the PR #22 merge run. If browser fails, inspect the first concrete assertion/request error without removing coverage. Require all four gates before merging with fresh main and expected SHA. Next bounded tests can cover failed-page retry and concurrent host/prefix responses if not yet covered; then extend typed paging to remaining result kinds. Do not claim all-authorized global search complete while remaining kinds are capped. Same-branch repeated VRF requires safe migration design.

No deployment: preserve installed unmerged Radio fix eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; actual RouterOS login/Full-Read incident OPEN. No live scan, router push, TOTP or VM/public-release acceptance claimed.

---

# Current work — scoped prefix search pagination API, 2026-11-07

Fresh main db909dc7a6da0e1dd9bb2fe9a8a7e2c696c6af15; post-merge/checkpoint CI 42276483123 and 42276616977 verified SUCCESS in all four gates. Only PR #12 was open, unchanged and pending actual-user Radio acceptance. PR #6/#4/#11/#13/#14 already merged. Continued the saved prefix-pagination step; reused existing local draft after comparing against the freshly fetched exact main files.

GET /api/search?kind=prefix now uses the existing typed pagination contract: limit defaults to 40 (1..100), offset defaults to 0 (0..2147483647), hasMore/nextOffset, bounded limit+1 lookup. One shared prefix query preserves legacy mixed callers (20-prefix cap), kind=host compatibility, Branch/Space/source/recordUpdatedAt and explicit absent live observation. Stable CIDR/ID ordering; Space authorization re-evaluated on every page. No schema or UI change. Offset paging is not a concurrent-edit snapshot; company/personnel/unregistered pagination remains outstanding.

A production HTTP fixture creates 64 prefixes in two synthetic branches with identical CIDRs/names. Admin, Company-scoped and Space-scoped readers traverse every page; exact IDs, deterministic order, no duplicates/leaks, metadata, terminal/default/invalid pages and legacy compatibility are checked. Removing a reader's grant after page one denies later-page results. All 215 local npm tests passed, including nine HTTP/PGlite tests and the explicit all-pages ordering assertion; server syntax passed. Exact-head CI/PostgreSQL/browser results are still required; IDs/status are recorded in the PR body after push. Pending CI is not success.

Exact next step: inspect the new PR's exact-head CI run IDs/status in its body; require all four gates (Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP and Docker/SSH) before merge with fresh main and expected SHA. If failing, inspect the first actual failure and retain the assertions. After API validation, extend the explicit load-more UI to prefixes with real later-page branch selection and stale-query coverage, preserving host/company/personnel/unregistered candidates. Do not rebuild Company/Space or change same-branch VRF constraints without safe migration design.

No deployment: preserve installed unmerged Radio fix eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; actual RouterOS login/Full-Read incident OPEN. No live scan, router push, TOTP, VM or public-release acceptance claimed.

---

# Current checkpoint — host load-more UI merged, 2026-11-06

PR #21 merged with expected head as 908d29be52b0378ab9c14aa6d8d56d0c6ab37bb5 after rechecking main 66024922ab47d404402205df311806e408df0ccf. Final head fff0488fd13b0e0f123ac92e656306a09f6a4355 passed all four gates in CI [42267345619](https://github.com/emsebi/EMS_IPAM/actions/runs/42267345619) and [42267334684](https://github.com/emsebi/EMS_IPAM/actions/runs/42267334684): Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP and Docker/SSH. Both job lists verified successful. Browser job 128062596270 reports 24 scenarios passed, including 42 hosts across two branches, retained prefix, later-page South host selection, terminal state and ignored cleared-query response. Merge tree exactly matches the tested head.

Quick search now offers Browse all matching hosts / More hosts using the bounded host API. Rendering no longer lets the paging click dismiss its own dropdown. Branch/Space/evidence and exact spaceId navigation remain; existing non-host candidates are retained. This completes the host load-more increment in GitHub, not VM acceptance. Other result kinds remain capped and offset paging is not a concurrent-edit snapshot.

## Exact next step
1. Inspect merge CI [42276483123](https://github.com/emsebi/EMS_IPAM/actions/runs/42276483123), last observed queued, plus this checkpoint CI (ID/status recorded on PR #21). Pending is not success.
2. Next bounded code/test increment: extend the existing opt-in typed search pagination to prefixes (kind=prefix), keeping legacy mixed callers and kind=host compatible. Reuse the authorized Space query and Branch/Space/source/recordUpdatedAt fields; deterministic CIDR/ID ordering, bounded limit/offset and authorization on every page. Add a real HTTP fixture exceeding the old prefix cap across two synthetic branches with matching CIDRs/names, checking complete authorized IDs, no duplicates/leaks, terminal pages and invalid parameters. Do not rebuild the Company/Address Space model.
3. After the API passes exact-head CI, extend the existing explicit load-more UI to prefixes with browser selection in each branch; do not drop host/company/personnel/unregistered results. Company/personnel/unregistered pagination remains subsequent bounded work. Same-branch repeated VRF still requires safe migration design.
4. No full deployment: PR #12 remains open and unchanged, with no actual-user GPS/AP/Station/uplink save/reload acceptance recorded. Preserve installed Radio correction eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3; main deployment would revert it. PR #6/#4/#11/#13/#14 are already merged. NAC Preview only; actual RouterOS login/Full-Read incident remains OPEN. No live scans, router push, TOTP, VM or public-release acceptance claimed.

---

# Current checkpoint — PR #21 paging click fix, 2026-11-06

Fresh main remains 66024922ab47d404402205df311806e408df0ccf. PR #21 head 882d99909b4dad8e0f605a1cc9070ebf4213bd78 failed browser CI [42249377425](https://github.com/emsebi/EMS_IPAM/actions/runs/42249377425) and [42249368636](https://github.com/emsebi/EMS_IPAM/actions/runs/42249368636); other three gates passed. Both browser logs reached 41 first-page candidates, then timed out waiting for offset=40 at browser.part1.mjs:673. This is not a successful browser run.

Code inspection identified that synchronous renderSearchItems detaches the clicked load-more button before the document outside-click handler tests closest(".searchbox"), hiding the dropdown. Stop propagation on this button before rendering. Browser regression now explicitly asserts the dropdown stays visible after first page; response/click waits are paired with Promise.all so click failures are handled. Existing second-page, prefix preservation, branch navigation and delayed-response assertions remain.

Validation: node --check passed for app.js and browser.part1.mjs; all eight local multisite HTTP tests passed (PGlite, including duplicate-IP branch isolation and 90-host pagination). These do not establish the browser fix: local Chromium is blocked by socket permissions. Exact-head GitHub browser CI is required; new run IDs/status are recorded on PR #21 after push.

Next: inspect the new PR #21 exact-head runs; require all four gates and the new browser assertions before merging with fresh main/expected SHA. If browser fails, inspect the first actual assertion/click error without removing tests. No deployment: PR #12 Radio actual-user acceptance remains pending; preserve the installed Radio fix. NAC Preview only; actual RouterOS login incident remains OPEN.

---

# Current work — host load-more UI and stale-query protection, 2026-11-06

Fresh main 66024922ab47d404402205df311806e408df0ccf; CI 42239302126 and 42239198611 completed SUCCESS. Only PR #12 remains open unchanged, pending actual-user Radio acceptance.

Core quick search now offers explicit Browse all matching hosts, then More hosts. First host page replaces only legacy host candidates, retaining Company/personnel/prefix/unregistered results; subsequent pages deduplicate by host ID and preserve Branch/Space/evidence display/navigation. Loading disables the button; errors preserve results and allow retry. New/cleared queries and selected results invalidate previous responses using generation and page identity. No backend/schema change. Radio/IP-jump callers unchanged. Other result kinds remain capped; this is not complete global pagination. Offset results are not a concurrent-edit snapshot.

Added browser regression after existing Radio/report checks: 42 hosts across two branches plus a matching prefix; first/last page counts, preserved prefix, terminal button removal and later-page South host selection. A delayed real HTTP response (no fabricated payload) verifies clearing the query keeps results hidden. Syntax and eight local HTTP regressions passed. Local Chromium socket restriction still prevents local browser verification; exact-head CI is required for the new UI assertions.

Next: inspect PR CI/run IDs, fix failures without dropping assertions, require all four gates before merge with fresh expected SHA. Add explicit retry/repeated-click and changed-to-another-query timing cases if evidence reveals a gap. Then extend typed pagination to other kinds; preserve all existing candidate kinds. No same-branch VRF constraint changes without migration design.

No deployment: preserve installed unmerged Radio PR #12 fix pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router push, TOTP or VM/public-release claim.

---

# Current checkpoint — scoped host pagination API merged, 2026-11-06

PR #20 merged with expected head as ee9b22d54be8ea08d202cd6bff8d60270d8b9984. Tested head aacea7eb6cb878a6144644cb85ce0b8ab4d15ee8 passed all four gates in CI [42231144528](https://github.com/emsebi/EMS_IPAM/actions/runs/42231144528) and [42231114613](https://github.com/emsebi/EMS_IPAM/actions/runs/42231114613): Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP and Docker/SSH. Both job lists verified successful. PostgreSQL log confirms all eight multisite tests, including 90-host pagination beyond previous caps with no duplicates/cross-branch leakage. Merge tree exactly matches tested head.

Opt-in /api/search?kind=host supports limit (1..100, default 40), offset, hasMore and nextOffset with stable exact-IP/IP/ID ordering and fresh authorization each request. Existing core/IP-jump/Radio mixed search remains compatible and capped. This is host-only API behavior, not complete global search or UI pagination. Offset pages are not a snapshot under concurrent edits.

## Exact next step
1. Inspect merge CI [42239198611](https://github.com/emsebi/EMS_IPAM/actions/runs/42239198611), last observed queued, plus checkpoint CI. Exact IDs/statuses are also recorded on PR #20.
2. Next bounded UI increment: provide an explicit host-results/load-more path using kind=host without dropping existing Company/personnel/prefix/unregistered candidates. Reuse Branch/Space/evidence rendering and exact spaceId navigation. Protect against stale responses after query changes (including clearing the field), repeated load-more clicks and errors; reset pagination on new query and avoid duplicates by host ID.
3. Add real browser fixture exceeding one page, verify later-page host selection in the correct branch, terminal state and stale-query protection; keep fixtures after Radio/report checks and preserve their existing assertions. Require exact-head CI before merge.
4. Other result kinds and mixed legacy caps remain unresolved. Extend typed pagination in bounded subsequent steps before claiming all authorized global results. Same-branch repeated VRF still requires safe migration design.
5. No full deployment: preserve installed unmerged PR #12 Radio correction eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router push, TOTP or VM/public-release acceptance claimed.

---

# Current work — bounded host search pagination API, 2026-11-06

Base main 4d33fe3e01e90d4f31fc5cc4570a628f2c2ec23e; CI 42222590368 and 42222496792 completed SUCCESS. PR #12 remains unchanged pending actual-user Radio acceptance.

GET /api/search?kind=host&q=...&limit=40&offset=0 adds opt-in host-only pagination. Limit defaults to 40, range 1..100; offset defaults to 0, range 0..2147483647; invalid values return 400. Response retains ok/items and adds pagination {kind,limit,offset,hasMore,nextOffset}; nextOffset is null on last page. SQL fetches at most limit+1 rows, ordered by exact-IP priority, IP and host ID. Branch/Space and evidence metadata remain. Authorization is recomputed on each page. Offset pagination is stable for unchanged data, NOT a database snapshot; concurrent edits can shift pages and clients must restart when refreshing.

Existing callers in core search, IP jump and modules/radio keep the legacy mixed response unless kind=host is explicit. Extracted one shared host query, avoiding duplicated search predicates. No UI/schema change. Other kinds and legacy caps remain incomplete; this is not full global search pagination.

All eight local multisite HTTP tests and server syntax passed. New fixture creates 90 hosts across two branches with identical IP sets, traverses pages for admin/Company viewer/Space viewer, checks exact ID sets without duplicates/leaks, stable ordering, metadata, terminal pages, invalid parameters and legacy response compatibility. Exact-head CI/PostgreSQL remains required.

Next: inspect PR CI/run IDs recorded on the PR, require all four gates before merge with fresh expected SHA. Then add deliberate host load-more UI with stale-query protection and real browser coverage. Extend typed pagination to prefixes/companies/personnel/unregistered candidates in bounded steps before claiming all authorized global results; do not hide remaining legacy caps. No same-branch VRF change without migration design.

No deployment: preserve installed unmerged PR #12 Radio fix pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router pushes, TOTP or VM/public-release acceptance claimed.

---

# Current checkpoint — per-Space unregistered search merged, 2026-11-06

PR #19 merged with expected head as b1601dc5660cfa16debc223a5587b413e4bda91e. Final head c7d8a9bf828a401feb2ac982a359576f47a8f8ca passed all four gates in CI [42214392703](https://github.com/emsebi/EMS_IPAM/actions/runs/42214392703) and [42214385456](https://github.com/emsebi/EMS_IPAM/actions/runs/42214385456): Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP and Docker/SSH. Both job lists verified successful. Browser log confirms 23 scenarios, including unregistered/mixed candidate selection and no host creation by opening the form. Merge tree exactly matches tested head.

Exact-IP unregistered candidates now retain each authorized containing Space, even alongside a registered branch. Uncapped exact-IP occupancy query prevents capped host results from falsely implying absence. Branch/Space/source and null observation/edit fields are explicit; availability remains unverified, not a live free-IP claim. No schema change or network scan.

## Exact next step
1. Inspect merge CI [42222496792](https://github.com/emsebi/EMS_IPAM/actions/runs/42222496792), last observed in_progress, and checkpoint CI. Exact IDs/statuses also saved on PR #19; unfinished runs are not success.
2. Next bounded implementation: inspect all /api/search callers and define backward-compatible explicit pagination metadata (hasMore/next cursor or equivalent), stable ordering with ID tie-breakers and authorization on every page. Start with a real HTTP regression exceeding existing host limit 30 and final limit 40 across synthetic authorized/unauthorized branches. Implement one bounded API step that lets the client retrieve remaining results without silently truncating or loading an unbounded dataset. Then a separate UI load-more step with stale-query handling and browser navigation checks. Existing branch identity and evidence fields must survive every page.
3. Current per-kind caps and final slice still mean not all authorized results are reachable; do not claim complete multisite search until the new regression and UI pass. Test duplicate IPs, overlapping Spaces, mixed registered/unregistered results, no duplicates/missing results across pages and denied scope. Do not rebuild Company/Space or change same-branch VRF uniqueness without migration design.
4. No full deployment: preserve installed unmerged PR #12 Radio correction eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router pushes, TOTP or VM/public-release acceptance claim.

---

# Current work — unregistered/mixed IP browser selection, 2026-11-06

Fresh main remains 29ec1efdb8668b97a2a89178fa63b91cd5910daf. PR #19 head 86684bb4d19f21aee80c0e671a3e5597f5e7f20c passed CI 42207006186 and 42206999811. PR #12 unchanged; actual-user Radio acceptance remains absent.

This bounded increment extends the existing synthetic browser fixture after Radio/report checks. In Persian, select both branches when the IP is unregistered in both, then register it only in North and select both mixed results. Assert Branch/Space/source, unavailable live observation, absent record-update time only for unregistered candidates, correct Space HTTP response and host form values. Final inventory assertion proves opening the unregistered South form did not create a host. No production change or removed scenario.

Browser syntax and seven local multisite HTTP tests passed. Local Chromium remains known blocked by socket permissions; new browser scenario is not claimed passed locally. Next: inspect exact-head CI recorded on PR #19, require all four gates and this new scenario before merging with fresh main/expected SHA. Fix failures without removing assertions. Then design explicit pagination/all-authorized-results; current caps remain incomplete.

No deployment: preserve installed unmerged PR #12 Radio fix pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router push, TOTP or VRF schema change. No VM/public-release acceptance claimed.

---

# Current work — unregistered IP candidates per authorized Space, 2026-11-06

Fresh main 29ec1efdb8668b97a2a89178fa63b91cd5910daf; CI 42199807547 and 42199720632 completed SUCCESS. PR #12 remains unchanged and awaiting actual-user Radio acceptance.

Exact-IP search now builds unregistered candidates for each authorized containing Space, even when another branch has a registered host. A separate uncapped exact-IP occupancy query prevents capped host results from falsely implying absence. Candidates carry Branch/Space/source, null recordUpdatedAt/observedAt, and availability=unverified. UI explicitly says absent from inventory, availability unverified. No network probe or invented timestamp. Existing result cap still applies; complete pagination remains outstanding.

Extended the existing HTTP fixture for both branches unregistered, one branch registered, no containing Space, metadata and Company/Space grants. All seven local HTTP tests and UI syntax passed. Initial fixture caught missing branch names in bootstrap Spaces; names now resolve from the same authorized bootstrap companies. Require exact-head CI recorded on this PR before merge. Next bounded validation: browser selection of each unregistered candidate (and mixed registered/unregistered results), then explicit pagination/all-authorized-results design. No duplicate Company/Space model or VRF constraint change.

No deployment: preserve installed unmerged Radio PR #12 fix pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router pushes, TOTP or VM/public-release acceptance claimed.

---

# Current checkpoint — prefix search context merged, 2026-11-06

PR #18 merged with expected head as a1bf8af196f77f6fc696a8bb809e5d9d1d52a658. Tested head 642edfe64c199ac8d8c6def10708a7adba9e050e passed all four gates in CI [42191809105](https://github.com/emsebi/EMS_IPAM/actions/runs/42191809105) and [42191799986](https://github.com/emsebi/EMS_IPAM/actions/runs/42191799986): Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP and Docker/SSH. Both job lists verified successful. Browser log confirms 22 scenarios including duplicate-prefix selection in English and Persian. Merge tree exactly matches tested head.

Prefix results now show Branch/Space, inventory source, record edit time and unavailable live observation. Two synthetic branches with identical prefix name/CIDR and Space name retain separate IDs; each browser selection opens the correct Space and exact prefix. Company- and Space-scoped HTTP regressions remain passing. No schema change, VM test or actual-user acceptance in this increment.

## Exact next step
1. Inspect merge CI [42199720632](https://github.com/emsebi/EMS_IPAM/actions/runs/42199720632), last observed in_progress, plus checkpoint CI. IDs/statuses are also saved on PR #18; pending is not success.
2. Next bounded code/test increment: remove the single-Space assumption for exact-IP unregistered candidates. Inspect current searchData and scoped bootstrap first. Use only authorized containing Spaces and distinguish by companyId/spaceId; do not suppress an unregistered candidate in one Space merely because the same IP is registered elsewhere. Label candidates as absent from inventory, never proven free/live. Reuse the existing two-branch HTTP fixture for no-host and one-branch-host cases, including Company/Space grants. Add Branch/Space/source and honest absent observation/update fields; do not invent timestamps or scan.
3. Search result caps/pagination and all-authorized-results semantics still need an explicit bounded design and tests; avoid claiming complete search while capped. Same-branch repeated VRF needs safe migration design before changing uniqueness.
4. No full deployment: preserve installed unmerged PR #12 Radio correction eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; real RouterOS login/Full-Read OPEN. No scans, router pushes, TOTP or public-release readiness claim.

---

# Current work — duplicate-prefix bilingual browser regression, 2026-11-06

Fresh main remains 8f07725c67775ba8cd4db85ef7993aeadd8a4909. PR #18 head 2bb1c08ff275aed93dfdca512079c892b9db0706 passed CI 42185224473 and 42185187275. PR #12 remains unchanged; no Radio acceptance recorded.

This increment extends the existing isolated browser fixture after Radio/report checks: two branches share prefix name/CIDR and Space name. In both English and Persian, assert Branch/Space, source, nonempty record-edit time and unavailable live observation; select both candidates and require the correct Space HTTP response, exact prefix ID, CIDR and name. No production change or removed scenario. Browser syntax and all six local multisite HTTP tests passed. Local Chromium is known blocked by process_singleton_posix socket permission; new browser scenario requires CI validation, not claimed passed locally.

Next: inspect exact-head PR #18 runs recorded on the PR; require all four CI gates including the new bilingual browser scenario before merging with fresh main/expected SHA. Fix any failure without removing assertions. Then address free-IP ambiguity and pagination/all-authorized-results semantics; these are still incomplete. No same-branch VRF constraint changes without safe migration design.

No deployment: preserve installed unmerged PR #12 Radio fix pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; actual RouterOS login/Full-Read OPEN. No scans, router push, TOTP, VM acceptance or public-release claim.

---

# Current work — scoped prefix search context, 2026-11-06

Base main 8f07725c67775ba8cd4db85ef7993aeadd8a4909; CI 42178360773 and 42178280964 completed SUCCESS. Only PR #12 remains open, unchanged and awaiting actual-user Radio acceptance.

Prefix search now returns companyId/companyName, source=ipam-inventory, recordUpdatedAt from prefixes.updated_at and observedAt=null using existing authorized Space filtering. UI reuses the host context display for prefix candidates. No schema change. The multisite HTTP fixture now creates equal prefix names/CIDRs in two branches and asserts distinct identity/metadata plus Company- and Space-scoped visibility. Initial test expected 201 incorrectly; existing POST prefix contract is 200, now used. All six local HTTP tests passed; UI syntax check passed. Require exact-head CI; UI-specific duplicate-prefix navigation coverage remains to add (host navigation already covered).

Next: inspect this PR CI including real PostgreSQL and browser before merge; preserve all existing scenarios. Add duplicate-prefix selection and Persian label browser assertions in the next bounded UI test step. Free-IP ambiguity and pagination/all-authorized-results remain outstanding. No same-branch VRF constraint change without safe migration design.

No deployment: preserve installed unmerged PR #12 Radio fix pending actual-user GPS/AP/Station/uplink save/reload acceptance. NAC Preview only; actual RouterOS login/Full-Read OPEN. No scans, config pushes or TOTP. No VM/public-release acceptance claimed.

---

# Current checkpoint — host search context UI merged, 2026-11-06

PR #17 merged with expected head as cfa788a4820ab2512397a541a8a4a81cc299db14. Tested head b918d33e4dbd4a6cbf7ddbcb55ee073db8cdeb96 passed all four gates in CI [42172071749](https://github.com/emsebi/EMS_IPAM/actions/runs/42172071749) and [42172065566](https://github.com/emsebi/EMS_IPAM/actions/runs/42172065566): Core/API/RADIUS, browser, real PostgreSQL/multisite HTTP, Docker/SSH. Both job lists verified successful. Browser log confirms 21 scenarios, including two branches with the same CIDR/IP and Space name: selecting each loads its own spaceId and host details. Merge tree exactly matches tested head.

Host candidates now show Branch, Space/CIDR, inventory source, record edit time and unavailable live observation. Local Chromium socket restriction remains an environment limitation; CI exercised the real browser successfully. This is not VM or actual-user acceptance.

## Exact next step
1. Inspect merge CI [42178280964](https://github.com/emsebi/EMS_IPAM/actions/runs/42178280964), last observed in_progress, plus this checkpoint CI (IDs also recorded on PR #17). Do not report pending runs successful.
2. Next bounded increment: extend prefix search with companyId/companyName, source and record-update metadata using existing scoped joins, then render Branch/Space for prefix candidates. Extend the existing multisite HTTP fixture with identical prefix names/CIDRs in two branches and scoped assertions; preserve current host behavior. Inspect schema first; no migration needed unless evidence requires it.
3. Free-IP candidate ambiguity and explicit pagination/all-authorized-results remain outstanding: current caps and first free-IP choice do not satisfy complete search. FA labels exist but new duplicate-IP browser scenario currently exercises English; add Persian coverage in a subsequent bounded UI step.
4. No full deployment: preserve installed PR #12 Radio fix eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 pending actual-user GPS/AP/Station/uplink save/reload acceptance. Main deployment would revert it. NAC Preview only; actual RouterOS login/Full-Read incident OPEN. No scans, config pushes, TOTP or same-branch VRF constraint changes. No public-release readiness claimed.

---

# Current work — host search Branch/Space UI, 2026-11-06

Base main 9b33a1f8ac2011100b3f5f2d65afc89bcb74f893; post-merge CI 42166191120 and 42166133401 completed SUCCESS. Only open PR #12 remains unchanged and awaits actual-user Radio acceptance.

Host search candidates now display Branch, Space/CIDR, inventory source, record edit time and explicit unavailable live observation. Existing spaceId navigation is preserved. Added browser fixture: two synthetic branches with identical CIDR/IP and Space name; select each candidate and require its own Space HTTP response and host details. Fixtures are created after existing Radio/report checks. Local syntax checks and all five multisite HTTP tests passed. Chromium failed before assertions: process_singleton_posix socket() Operation not permitted. Browser behavior is not locally verified. PR #17 code commit: 60ffebe66a2e49dc1992a405dec473c4b8f7cbc7. CI 42172005477 and 42171953071 were in_progress; follow these and the checkpoint-head CI before merging. No pending run is reported successful.

Next: inspect this PR CI and local browser outcome; fix any failures without dropping existing scenarios, then merge only with fresh expected SHA. Prefix/free-IP context and pagination/all-authorized-results remain outstanding. No VRF schema change. No deployment: preserve installed unmerged PR #12 Radio fix pending user acceptance. NAC Preview only; actual RouterOS login remains OPEN. No scans or configuration push; no VM/public-release acceptance claimed.

---

# Current checkpoint — scoped host search metadata merged, 2026-11-06

PR #16 merged with fresh expected head as `09e74bb828f4756c4c114384782f6a0770cd81ef`. Final head `0c1490b6371663c60b9179d95f48dfe99c284935` passed all four gates in CI [42160480606](https://github.com/emsebi/EMS_IPAM/actions/runs/42160480606) and [42160476450](https://github.com/emsebi/EMS_IPAM/actions/runs/42160476450): Core/API/RADIUS, browser, PostgreSQL (including multisite HTTP) and Docker/SSH. Merge tree equals the tested head tree.

Authorized host search results now include companyId/companyName alongside spaceId/spaceName, source=ipam-inventory, recordUpdatedAt and observedAt=null. Existing Company/Space filtering remains enforced. The duplicate-IP fixture checks both branch identities and scoped metadata. This is API behavior only; edit time is not live observation time.

## Exact next step
1. Inspect merge CI [42166133401](https://github.com/emsebi/EMS_IPAM/actions/runs/42166133401), currently in_progress; result pending and the documentation checkpoint CI. Exact run IDs are also recorded on PR #16; do not report unfinished runs as successful.
2. Next bounded UI increment: render Branch/Space and inventory edit time/source for host search candidates; label absent live observations honestly. Add real browser coverage with two branches sharing the same IP AND Space name, select each result and verify navigation uses its own spaceId. Reuse the existing HTTP fixture and avoid altering Radio's branch concurrently.
3. Prefix/free-IP context and explicit pagination/all-authorized-results semantics are still outstanding. Current host/result caps and single free-IP choice remain; do not claim complete multisite search. No same-branch repeated-VRF constraint change without safe migration design.
4. No full deployment: PR #12 Radio fix already installed awaits actual-user acceptance; preserve eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 from 41783898221 atop full release 588ba9f. Main deployment would revert it. NAC Preview only; actual RouterOS login/Full-Read remains OPEN. No scan, config push or TOTP; no public-release or VM acceptance claimed.

---

# Current work — scoped host search context, 2026-11-06

Fresh main 1a479224c1f39bc9f62c5ee729ae3090e2049810; CI 42153565426 and 42153507136 completed SUCCESS. This bounded increment adds companyId/companyName, source=ipam-inventory, recordUpdatedAt and observedAt=null to authorized host search results. Existing spaceId/spaceName and access filters remain. Inventory edit time is explicitly not network observation time. The existing duplicate-IP HTTP fixture verifies distinct branch labels/identities and scoped metadata without a new schema.

Next: require exact-head CI including the real PostgreSQL HTTP fixture, then merge with fresh expected SHA. Follow with UI Branch/Space and source/time display, equivalent prefix/free-IP context and explicit pagination/all-authorized-results semantics. Current result caps and single free-IP choice remain limitations; this API-only increment does not claim complete multisite search.

No deployment: preserve PR #12 installed unmerged Radio fix pending actual-user acceptance. NAC Preview only; real RouterOS login remains OPEN. No scanning, router push, TOTP or VRF schema change.

---

# Current checkpoint — multisite HTTP regression merged, 2026-11-06

PR #15 merged with expected head as `2459df355a74c82b4b8616ffc207a279abd1d3b5`. Final head `583bb63b48c52b8a06bf47e98f79a121b4d0cbb0` passed all four gates in CI [42147121444](https://github.com/emsebi/EMS_IPAM/actions/runs/42147121444) and [42147116481](https://github.com/emsebi/EMS_IPAM/actions/runs/42147116481): Core/API/RADIUS, browser, real PostgreSQL and Docker/SSH. The merge tree exactly matches the tested tree. The previous browser failure did not recur in either final-head run; this is evidence for the readiness correction, not a guarantee against all timing races.

The new HTTP fixture tests existing parent/two branches sharing CIDR/IP, independent host edits, Company/Space grants, scoped inventory/search/CSV export and denied cross-scope reads/writes/deletes/ID spoofing. Five tests pass against PGlite and real PostgreSQL. No production schema or behavior changed; not all MS scenarios/endpoints are certified.

## Exact next step
1. Inspect merge CI [42153507136](https://github.com/emsebi/EMS_IPAM/actions/runs/42153507136), last observed in_progress; result pending and the documentation checkpoint CI. Run IDs are also recorded on PR #15.
2. Next bounded code increment: add companyId/companyName (Branch) alongside spaceId/spaceName to scoped search host/prefix results, with source and record-update time; show Branch/Space in the UI. Extend the existing duplicate-IP HTTP fixture rather than rebuilding it. Search currently caps host/results and picks a single free-IP candidate; follow up with explicit pagination/all-authorized-results semantics instead of silently claiming completeness.
3. No full deployment: PR #12 Radio fix already installed still awaits actual-user GPS/AP/Station/uplink save/reload acceptance. Preserve deployed eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3 (41783898221) atop full release 588ba9f; main deploy would revert it. Keep its shared browser scenarios intact.
4. NAC remains Preview only; real RouterOS login/Full-Read remains OPEN. No scans, config push, TOTP or same-branch VRF schema changes. Public-release/VM acceptance is not claimed.

---

# Current work — multisite PostgreSQL verified; browser readiness correction, 2026-11-06

Fresh main remains 585d3c06265805e4818699984214ea20829bd6d2. PR #15 head 1e8b40a3ed503db949282def5165266431b64b89 passed all four gates in CI 42141332115, including all five multisite HTTP tests against real PostgreSQL 16 (job 127642086625), not only PGlite. Companion CI 42141327224 failed browser job 127642069425 waiting for #nacProfilesTab at browser.part1.mjs:327; its other three gates passed.

The browser test now waits for the restored RADIUS page content (.r-tabs) after reload, as well as module navigation, before clicking Network Access. This addresses a readiness gap: a registered menu does not prove the asynchronous initial route has rendered. No assertion was removed or timeout increased. The explanation is a race hypothesis requiring the new CI result, not a proven resolution. No production code change.

Next: inspect new exact-head PR #15 CI (run IDs recorded on the PR), especially browser; if green, merge with fresh main/expected head. Then add Branch/Space labels and source/time to authorized search results and address result limits. Preserve all shared browser scenarios when PR #12 is integrated; that branch has not been changed here.

No deployment: Radio acceptance is still required; preserve the installed unmerged fix. NAC Preview only. RouterOS real login remains OPEN. No scans, configuration pushes, schema changes or TOTP.

---

# Current work — multisite HTTP regression, 2026-11-06

Base main 585d3c06265805e4818699984214ea20829bd6d2; CI 42099948863 and 42099815442 verified SUCCESS. This increment adds a separate real HTTP test using existing Company/Space/Host routes: parent and two branches share CIDR/IP; editing one preserves the other; Company-granted and Space-granted viewers see only their own inventory/search/export; cross-scope reads, ID spoofing, edits and deletes are denied. The same test is wired into the existing PostgreSQL CI job using a newly created disposable database, removed after testing. Default local execution uses PGlite. No shared browser file or production schema changes.

Next: inspect exact-head CI (run IDs recorded in the PR), especially the new real PostgreSQL execution; do not merge if pending/failed. Then add Branch/Space labels and source/time to search results: current search returns spaceId/spaceName but lacks branch context and caps results. This fixture does not certify every endpoint or all multisite acceptance scenarios. Same-branch repeated VRF needs migration design first.

No deployment: preserve PR #12 Radio correction already on VM pending actual-user acceptance. NAC remains Preview only; RouterOS real-device login remains OPEN. No scanning, config push or TOTP.

---

# Current checkpoint — NAC Preview merged, 2026-11-05

PR #13 integrated fresh main and merged with expected head as `6ff353db76fd980fda15925051a6361f9a56c16e`. Tested head `2f1edf610f46cf2b07028ea9d7a1354454f035c8` passed all four gates in [CI 42099411545](https://github.com/emsebi/EMS_IPAM/actions/runs/42099411545): Core/API/RADIUS, browser, PostgreSQL and full Docker/SSH fixture. Merge tree `efe8b612456cf621221e142d9438ae8c3baa718e` exactly matches the tested tree. Companion run 42099398865 is completed / success; inspect any unfinished result next.

Nine local NAC policy/API/migration tests passed. The new authorization matrix checks all ten endpoint forms for two denied permission combinations before touching protected data. Exact RADIUS row-content preservation is checked. The browser integration retains Map missing-path/root-change scenarios alongside NAC Preview. No live enforcement bridge, router push or scan was added.

## Exact next step

1. Follow [merge CI 42099815442](https://github.com/emsebi/EMS_IPAM/actions/runs/42099815442), last observed in_progress with result pending and the documentation checkpoint CI; their run IDs are also recorded on PR #13. No pending run is being reported as successful.
2. Next independent code increment: a separate real HTTP/PostgreSQL MS-01/MS-02/MS-11 fixture with existing parent Company + two branches holding the same CIDR and IP, companyId/spaceId identity, authorized search results labeled Branch/Space, and denied direct out-of-scope requests. Do not rebuild Company/Address Space or alter same-branch VRF uniqueness before safe migration design.
3. **No full deployment:** PR #12's Radio fix is already installed but unmerged and awaits actual-user GPS/AP/Station/uplink save/reload acceptance. Preserve deployed `eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3` (41783898221) atop full release 588ba9f. A full main deploy would revert it. Integrate Radio's shared browser scenarios sequentially only after acceptance; preserve the recorded #nmSettings timeout evidence.
4. NAC is **Preview only**, not enforced or validated on switch ports. Actual RouterOS login/Full-Read remains **OPEN / unverified**. No VM acceptance or public-release readiness is claimed; no TOTP.

---

# Historical work — P0 NAC Preview integration, 2026-11-05 20:00 UTC

Fresh main `2990f7ad70452c2df020aa45ea8e6a2195e7f35a` and its CI 42091626132 are SUCCESS. Map merge CI 42091453770 and contract merge CI 42090780897 also completed SUCCESS. PR #11 and #14 are merged; the MS-01…MS-12 / P0…P3 contract remains the reference.

This increment merges fresh main into existing PR #13 (`work/nac-switch-profiles-20261104`, previous head `c0012ab10548d89b615a699aabeb7bf706b7b0a6`). Three-way integration of the shared browser file preserves both the 19 Map/main scenarios and NAC's profile/binding/override/CLI preview scenario; no scenario is dropped. No Radio branch files are changed.

Added production-handler authorization regression: each of all 10 NAC endpoints independently requires both module permission and administrator status. Twenty denied requests must fail before database access, body parsing, draft mutation or response data. Existing PGlite lifecycle assertions now compare exact live radcheck/radreply contents, not just row counts, so an accidental overwrite is detected. All **9 NAC policy/API/migration tests passed locally** on the integrated source; browser syntax passed. Full combined CI is still required.

The reviewed NAC backend only changes its own draft tables and reads existing NAS/MAC registry IDs; no switch execution, discovery or runtime RADIUS authorization bridge is added. “Enabled” still means enabled in simulation. Company scopes in existing MAB/NAC remain intact.

## Exact next step

1. Inspect exact-head PR #13 CI (run IDs recorded in the PR and next checkpoint): require Core/API/RADIUS, browser, PostgreSQL and Docker/SSH gates before merge with fresh main/expected head. The historical green CI for c0012ab is not sufficient for this new integration.
2. Preserve the VM Radio fix: **do not run a full deployment** while PR #12 remains unmerged and its actual-user save/reload acceptance is absent. The VM has Radio correction `eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3` from 41783898221 atop full release 588ba9f; deploying main would revert it. PR #12 comments still contain no acceptance. Follow the documented #nmSettings timeout discrepancy when integrating its shared browser tests.
3. After NAC integration, next independent P1 increment is a separate real HTTP/PostgreSQL test for existing parent Company + two branches with identical CIDR/IP, stable companyId/spaceId and denied out-of-scope direct requests. Preserve all authorized search candidates with Branch/Space labels. No same-branch repeated-VRF constraint change before safe migration design.
4. NAC is Preview only, with CLI templates requiring actual model/OS and lab validation before use. No enforcement/release/VM acceptance is claimed. Actual RouterOS login/Full-Read remains OPEN; no network scan, configuration push or TOTP.

---

# Historical checkpoint — P0 Map merged, 2026-11-05 19:11 UTC

PR #14 merged as `ed3a093579aee160585ba495cdfd7dc9fd7585bf`; its multisite contract is the development reference. PR #11 is now merged as `8cff91fe9205811b9d02bcab1eecd6896ce4614e` with a fresh expected head. Integrated head `914da808b497ea930b7ac254ecc5a7b8867c87e5` passed all four gates in [CI 42091202000](https://github.com/emsebi/EMS_IPAM/actions/runs/42091202000) and [42091186003](https://github.com/emsebi/EMS_IPAM/actions/runs/42091186003): Core/API/RADIUS, 19 real HTTP/PGlite browser scenarios, PostgreSQL, and full Docker/SSH fixture. Merge tree `86e9afc9e52809ec6dff0518c18600632a6e660d` exactly equals the tested tree.

This is a code/test integration, not a VM deployment or general-release acceptance. Network Map 0.2.0-lab.4 now labels missing/unavailable/disconnected roots separately from a valid zero-hop observation and clears obsolete trace/impact results after root changes. Existing Radio, RADIUS credential controls, viewer access, Personnel, Client and Donation browser checks passed.

## Exact next step and blockers

1. Follow merge CI [42091453770](https://github.com/emsebi/EMS_IPAM/actions/runs/42091453770), currently **in_progress**, and this documentation checkpoint's CI. Contract merge CI 42090780897 was also in_progress at this check. Do not report either as successful until its completed result is inspected.
2. **Full deployment remains on hold** to preserve PR #12's unmerged Radio fix already installed on the VM (41783898221, `eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3`). Actual-user GPS/AP/Station/uplink save/reload acceptance has not been recorded; do not merge #12 without it. Failed browser job 126421929673 (run 41784038181) timed out after 12 seconds waiting for `#nmSettings` at browser.part1.mjs:350; the same head also has successful 41784045199. Preserve this evidence and investigate/retest the shared browser flow when integrating Radio; a flaky-test diagnosis is not yet proven.
3. Next bounded P0 increment: review/reconcile PR #13 NAC **Preview only** against this new main, preserving Map and Radio scenarios in the shared browser file. Do not modify an actively edited file concurrently or introduce live NAC enforcement.
4. Independent P1 work can use a separate real HTTP/API fixture for MS-01/MS-02/MS-11: existing parent Company/two branches with identical CIDR/IP, stable companyId/spaceId, every authorized search result labeled Branch/Space, direct out-of-scope requests denied. Reuse existing Company/Address Space schema; design a safe migration before same-branch repeated-VRF support.
5. No VM deployment, real-device scan, configuration push or TOTP occurred in this increment. Actual RouterOS login/Full-Read incident stays OPEN; server ACCEPT and signed loopback responses are insufficient.

---

# Historical integration — P0 Map + multisite contract, 2026-11-05 19:08 UTC

Fresh main was `88ec46f6beffd03dfe3523b0dfd3d9c83373de39`. PR #14 final head `242fc686a8cd353f44dfa09c29e7d1504d0e656f` passed all four CI gates (42025816687 / 42025748549) and merged with expected SHA as `ed3a093579aee160585ba495cdfd7dc9fd7585bf`. [MULTISITE-OPERATIONS-ACCEPTANCE-FA.md](docs/MULTISITE-OPERATIONS-ACCEPTANCE-FA.md) is now the MS-01…MS-12 / P0…P3 development contract; it describes required behavior, not completed features.

PR #11 head `55fa43155dff83017c0917494c0edc9e027a9d5b` passed Core/API/RADIUS, browser, PostgreSQL and full Docker/SSH fixture CI 41391456840 / 41391408187. This integration brings fresh main into that branch, retains its real HTTP/PGlite browser tests for all four saved-path states and root-change invalidation, and refreshes checksums for the merged contract. No concurrent edits are made to Radio/NAC branches. Their overlap with Map is `docker-app/tests/browser.part1.mjs`; integrate sequentially and preserve all scenarios.

## Release holds and exact next step

1. Follow the new exact-head PR #11 integration CI (run IDs will be recorded in this PR/checkpoint), inspect all four gates, then merge with fresh main and expected PR head. Old green CI alone does not certify this integrated head. Do not deploy while CI is pending or failed.
2. **Do not run a full main deployment yet:** the VM has a newer Radio-only correction from PR #12, deployed by run [41783898221](https://github.com/emsebi/EMS_IPAM/actions/runs/41783898221) at `eb983f8e69c77dc5cd40a3af8f9d831d5d8649b3`. Deploying main would revert that unmerged correction. Base full release remains `588ba9f86a1731ee12c5308ddef2e755131352dc` (41360114772); installed Radio differs. PR #12 explicitly requires actual-user GPS/AP/Station/uplink save/reload acceptance before merge, and no acceptance comment was present at this check. Its latest head `b8a7f575486ac90d8ce7f406018358a145c459ec` has successful CI 41784045199 but browser failure in 41784038181; inspect that discrepancy before integration.
3. PR #13 head `c0012ab10548d89b615a699aabeb7bf706b7b0a6` has successful CI 41728810342 / 41728799965. It is NAC **Preview only**, with no runtime enforcement bridge. Review and integrate its shared browser tests against new main in a separate increment; do not treat generated CLI as applied configuration.
4. Next independent P1 code/test increment: production HTTP/PostgreSQL fixture using existing parent Company + two branches, identical CIDR and IP, stable companyId/spaceId identity, and direct unauthorized endpoint requests. Assert all permitted results with Branch/Space context; add scoped search only after behavior tests. Repeated VRF inside one branch requires a safe migration design before changing existing uniqueness constraints.
5. RADIUS actual RouterOS login/Full-Read remains **OPEN / unverified**, independently of valid signed loopback replies or server ACCEPT. Preserve credentials, Collections, Inventory links, Core/MAB Company boundaries, all modules, backups/volumes and port 8888. No real-device discovery, router push or TOTP in this increment.

---

# Historical work — explicit saved MAC path status, 2026-11-02 (Tehran)

Fresh main `88ec46f6beffd03dfe3523b0dfd3d9c83373de39`, CI 41386136552 and PR #10 merge CI 41386061955 all verified SUCCESS. PR #6, #4, #9 and #10 are merged. Installed functional release remains `588ba9f` (Lab Deploy 41360114772); actual RouterOS login remains OPEN / unverified.

Branch `work/map-path-status-20261102` advances Network Map to 0.2.0-lab.4. Saved MAC candidate observations now distinguish root not configured, selected root absent from the saved map, no saved root path, and observation on the root itself (zero inter-switch links). No-path explicitly does not confirm a live outage; port/source/time/staleness remain visible. Changing the root invalidates old trace/impact results and highlights, preventing a path for the previous root being relabelled as current.

The browser scenario uses the existing real HTTP/PGlite fixture, with a synthetic disconnected switch and no API mocks. It covers each status, root-change invalidation, IP-selected MAC results, preserved port evidence, screenshots and zero collection writes/snapshots during search. Local syntax/diff checks passed; Chromium is absent locally, so the full browser gate must pass in CI before merge or deployment.

## Exact next step

1. Follow the exact-head PR CI (IDs recorded in the PR body), inspect actual failures, and merge with fresh main/expected SHA only after all four gates pass. Then stage the tested merge through existing EMS-IPAM Lab Deploy and record its run; do not wait indefinitely or claim queued deployment succeeded.
2. Check backup, unchanged RADIUS data/credentials/assignments, port 8888, all installed modules and signed replies after deployment. Preserve Core/MAB Company boundaries and existing accepted UI features. No new migration or router configuration is included.
3. Live discovery needs explicit targets; actual RouterOS login remains open. TOTP and Radio redesign remain out of scope.

---

# Historical checkpoint — failure-impact regression merged, 2026-11-02 (Tehran)

Fresh main: `0fdf5f4796f70ff344913babf6121626b17a7221`; checkpoint CI 41381047520 completed SUCCESS. PR #6, #4 and #9 are merged. Installed functional release remains `588ba9f86a1731ee12c5308ddef2e755131352dc`, with successful Lab Deploy 41360114772. Actual RouterOS login remains OPEN / unverified.

Branch `work/map-impact-regression-20261102` adds six offline production-model scenarios: redundant uplink/transit-node removal, down backup links, existing disconnected components and root removal, distinct parallel links with topology-only uncertainty, MAC paths avoiding down links, and retained MAC evidence when the root path is absent. A seventh production-handler/PGlite API scenario verifies saved impact results, admin enforcement, unchanged topology, zero snapshots and zero collector/probe calls. All 16 related API/model/parser tests pass locally. No defect was reproduced in these cases; production code, module version and deployment remain unchanged.

## Exact next step

1. PR #10 merged with expected head as `35b99d29bb343ef9bd64852dda0b0f4bd969fd4d`. Its final head `fa3d363d1e27cf44c7896c0010f9b1264ab58b3e` passed all four gates in CI [41385945088](https://github.com/emsebi/EMS_IPAM/actions/runs/41385945088) / [41385921446](https://github.com/emsebi/EMS_IPAM/actions/runs/41385921446); the merge tree matches that tested head. Follow merge CI [41386061955](https://github.com/emsebi/EMS_IPAM/actions/runs/41386061955) (in_progress) and the documentation checkpoint CI next. This increment changes tests, this checkpoint and checksums only; do not redeploy the VM.
2. Next bounded UI improvement: distinguish a missing saved MAC path (`links=null`) from a valid zero-hop path (`links=[]`, endpoint at the root). The existing model preserves the port observation even when its root path is disconnected; the UI should state that no saved path is available rather than leaving the distinction implicit. Cover missing root, disconnected endpoint and endpoint-at-root with browser behavior tests; preserve source/time, uncertainty and manual collection.
3. Do not scan real devices without explicit targets, push router configuration, enable TOTP or close the actual-device RADIUS incident based on server ACCEPT.

---

# Verified checkpoint — saved IP/MAC trace deployed, 2026-11-02 (Tehran)

Installed functional release: `588ba9f86a1731ee12c5308ddef2e755131352dc` (PR #9 merge, Network Map 0.2.0-lab.3). Fresh main was this same SHA at verification. PR #6, #4, #7, #8 and #9 are merged; no open PR was found. This checkpoint supersedes the pending/failure notes below.

[Lab Deploy 41360114772](https://github.com/emsebi/EMS_IPAM/actions/runs/41360114772) completed **SUCCESS** at 2026-11-01 23:07:52 UTC (2026-11-02 Tehran). Job `125008502913` confirms the exact SHA, private pre-upgrade database backup, preserved volumes/configuration/credentials, healthy port 8888, all seven modules loaded, unchanged RADIUS records and assignments, valid Message-Authenticator/Response Authenticator and matching permissions on the installed service. Its temporary loopback fixture was removed without changing existing data. The separate disposable Docker/FreeRADIUS smoke also passed, including protocol/profile changes, accounting, restart and database-outage recovery. Actual RouterOS login remains **OPEN / unverified**; these checks do not prove it.

PR #9 final head `2f8a013a0d2a85854e168a8e91476d67072d8d16` passed all four gates in CI [41359956349](https://github.com/emsebi/EMS_IPAM/actions/runs/41359956349) / [41359952039](https://github.com/emsebi/EMS_IPAM/actions/runs/41359952039), including all 18 browser/API scenarios. The merge tree matches that tested head. Merge CI 41360097707 and deployment-branch CI 41360114813 also completed SUCCESS. Radio, RADIUS Show/Copy/Hide, viewer authorization, Personnel, Client and Donation checks remain intact. See [release notes](docs/releases/network-map-0.2.0-lab.3.md).

## Exact next step

1. Follow the CI attached to this documentation/checksum checkpoint; no application code changed, so do not redeploy or repeat completed VM tests merely for the documentation SHA.
2. Next bounded map increment: add offline regression coverage for link/node failure with redundant physical paths, already-down links and nodes outside the root component. Current coverage has only a simple one-uplink impact case. Verify affected/unmapped sets and saved MAC paths; fix only a reproduced defect, preserving the topology-only uncertainty label and manual collection. Continue from the current module rather than rebuilding it.
3. Live Cisco/MikroTik discovery needs explicit targets before any network scan. Keep the RADIUS incident open pending actual-device evidence, and preserve all accepted secrets, Collections, Inventory links and Core/MAB Company boundaries. TOTP and Radio redesign are outside this increment.

---

# Historical work — saved IP trace UI, 2026-11-02 (Tehran)

## Browser fixture correction — 2026-11-02

Fresh main remains `62654e23aad649fb6d04b8062b698cbcdd46cc8a`; PR #6 and #4 are merged. PR #9 head `f5c5d39751b26539afacd1f97c4fa1f824bf7625` CI 41355473173 / 41355469465 completed FAILURE. Browser job 124994464376 confirms the Radio mobile assertion now PASSES, together with RADIUS password reveal/copy/hide. It then rejects the map fixture's POST /api/spaces with HTTP 400 because root CIDRs only allow /16 through /24.

The fixture now uses overlapping `192.0.2.0/23` alongside `192.0.2.0/24`, keeping distinct address spaces and the same duplicate-IP scenario. No production validation or previous assertion was weakened. Local real HTTP verification passed: authenticated space/host creation, two ambiguous IP records, two saved MAC traces and zero snapshots. Syntax check passed. Full browser verification still requires CI (local Chromium is absent).

Next: inspect CI for the new PR #9 head; its run IDs will be recorded in the PR body. Require all four CI jobs to pass, then merge with a fresh expected head and use the existing Lab Deploy workflow. Do not deploy a failed or pending head. Installed release remains `d1c712a`; the real RouterOS login incident remains OPEN.

Follow-up: CI 41359803787 on `e7e31df` passed the complete new IP/MAC browser scenario, Radio, RADIUS credential controls, reports and Donation. It then failed the existing viewer inventory count (9 vs 7) because the two map test hosts remained. The test now deletes exactly its two synthetic hosts and additional space after the map assertions and verifies the original inventory ID set is restored. The existing viewer assertion is unchanged. Core/API, PostgreSQL and Docker/SSH passed; follow the new head's full browser result before merging.

Fresh main `62654e23aad649fb6d04b8062b698cbcdd46cc8a` and API merge `ea9045f` both have successful CI (41339820329 / 41339777691). PR #8 is merged. Installed release is still `d1c712a`; API and UI increments are not yet installed. RADIUS real-device login remains OPEN / unverified.

Branch `work/map-ip-trace-ui-20261102` completes the saved-data search UI on the existing module (version 0.2.0-lab.3). An explicit MAC/IPv4 selector preserves the existing MAC route. IP results display all candidates, address-space identity, inventory edit timestamps and unobserved/uncertain IP bindings. Clicking a candidate opens the existing saved MAC/port/VLAN evidence with its own source/time/staleness. Result requests are guarded against stale responses after search/company changes or clearing. No discovery, device probe or configuration push is added.

Browser coverage uses synthetic embedded database records, not API mocks or real devices: overlapping IP candidates, provenance, selecting a saved MAC/port, no-match, old MAC search, clear, and zero Network Map mutation requests/snapshots during lookup. Local JavaScript syntax and diff checks passed. Local browser execution was BLOCKED before browser launch because Playwright Chromium is absent; no browser pass is claimed. CI installs Chromium and is the required browser gate.

## Exact next step

1. PR #9: https://github.com/emsebi/EMS_IPAM/pull/9. Initial CI 41355085007 / 41355080933 failed the pre-existing Radio mobile-width assertion (395 > 390 pixels), before reaching map tests; Core/API, PostgreSQL and Docker/SSH passed. Runs 41355217689 / 41355213667 cover the intermediate address-space-label change. The latest fix creates overlapping inventory through the real API only at the map test stage, keeping earlier module fixtures unchanged; Radio code and assertions are unchanged. This suspected fixture interference is not yet proven resolved. Follow the newest PR-head CI and record its run ID/outcome; do not deploy while tests are pending or failed.
2. When the exact head passes Core/API/RADIUS, browser, PostgreSQL and Docker/SSH gates, merge with expected SHA and stage through the existing EMS-IPAM Lab Deploy. Preserve backup, volumes, credentials, port 8888 and all accepted modules. Record the actual deployment run and inspect completed data-preservation, installed-module and signed-reply checks; never equate queued with success.
3. Keep live-device discovery out of scope until explicit target addresses are supplied; no TOTP, radio redesign or router push in this increment.

---

# Current work — saved IPv4 trace API, 2026-11-01

Fresh main: `a51503ec1a219489f9498c2eddb346d7e6cdbe55`. Its CI 41334494387, PR #7 merge CI 41334450553 and installed-module recheck 41334450509 all completed SUCCESS. PR #6, #4 and #7 are merged. Installed functional release remains `d1c712a`, with verified deployment 41329218765 and all seven modules available. Real RouterOS login remains OPEN / unverified.

## This increment

Branch `work/map-saved-ip-trace-20261101` adds administrator-only `GET /api/network-map/trace-ip?companyId=…&ip=192.0.2.50`, optionally restricted by `spaceId`. It reads active IPAM inventory assignments only within the selected Company and joins each distinct valid MAC to the existing saved forwarding-table trace. No ARP, ping, SSH, automatic discovery or MAC refresh occurs. No migration or RADIUS changes are included.

Inventory edit time is `recordUpdatedAt`, never a claimed network observation (`observedAt=null`). Switch evidence retains separate source/time/staleness. Missing/invalid MAC, multiple candidate MACs, archived records and a 100-row limit are handled explicitly. Overall IP-to-MAC confidence stays uncertain because no observed ARP binding is available. Missing switch collection time now correctly counts as stale.

Module version is 0.2.0-lab.2. This is an API increment; the existing MAC UI is unchanged. Tests cover scoped IP lookup, duplicate IPs, excluded archived/other-Company records, admin enforcement, no collection/probe, evidence bounds and missing timestamps. The PostgreSQL gate now exercises the new route against saved inventory and checks that the collector count does not change.

## Exact next step

1. PR #8 head `cb907e01e1080d306c9b6e0f0ce70b60d5204d0c` has PR CI [41339657655](https://github.com/emsebi/EMS_IPAM/actions/runs/41339657655) and push CI [41339654845](https://github.com/emsebi/EMS_IPAM/actions/runs/41339654845). The PostgreSQL 16 job `124946766268` passed the new saved-IP lookup without collection. Local results: all 5 discovery/API tests and 4 parser tests passed; syntax/diff checks passed. Both full CI runs completed SUCCESS on the exact PR head, including Core/API/RADIUS, browser, PostgreSQL and Docker/SSH jobs. PR #8 was merged with expected head SHA as `ea9045fb792bc3861c3fc2963dfdc07d4cd77d0c`. This API increment has not been deployed. Automatic merge CI [41339777691](https://github.com/emsebi/EMS_IPAM/actions/runs/41339777691) was in progress at this checkpoint; follow its outcome next run. The merge tree matches the tested PR tree; this continuation follow-up changes only documentation/checksums.
2. Continue from the merged API with an IP/MAC search UI: render every candidate and clearly separate inventory edit time from switch observation time. Preserve the MAC route and saved-password features. Add browser coverage before staging this user-facing increment through the existing Lab Deploy workflow.
3. Do not scan live equipment without an explicit scope, push router configuration, enable TOTP or close the real-device RADIUS incident based on server ACCEPT.

---

# Current checkpoint — map deployed; installed-module gate, 2026-11-01

Fresh main was `58881b3512f85a2f5307d31edcba524774a50d0b`. PR #6 and PR #4 are merged. [Lab Deploy 41329218765](https://github.com/emsebi/EMS_IPAM/actions/runs/41329218765) for `d1c712af0f809144472cde7f0498aa31639bd1cc` is now **completed / success**, not pending. The exact installed commit includes Smart Network Map and signed, Company-free RADIUS. Merge CI [41329180890](https://github.com/emsebi/EMS_IPAM/actions/runs/41329180890), deployment-branch CI [41329218685](https://github.com/emsebi/EMS_IPAM/actions/runs/41329218685), and checkpoint CI [41329331100](https://github.com/emsebi/EMS_IPAM/actions/runs/41329331100) also passed.

Deployment job `124915576374` verifies private backup, preserved database volume/configuration, port 8888, unchanged RADIUS records/credentials/assignments, installed signed reply at 17:01:56 UTC, exact temporary-fixture cleanup and full real Docker RADIUS integration. Required Message-Authenticator, Response Authenticator and assigned permissions all passed. Real RouterOS login remains **OPEN / unverified**; server acceptance is not router acceptance.

## Current bounded change

The existing deployment only required HTTP 200 from /health; a disabled module could be missed. `scripts/installed-modules-check.py` now requires database readiness plus all seven expected modules, including Network Map and RADIUS. Failed module migrations or backend loads remove those IDs from the health response, so this checks runtime availability rather than files merely existing. It sends exactly one GET to 127.0.0.1:8888/health, does not follow redirects, requires no credentials and never scans, probes equipment or changes state. Four offline regression tests passed, including missing-module failure and GET-only/redirect behavior.

The new `EMS-IPAM Installed Modules Check` workflow runs this read-only check on the dedicated VM without reinstalling or restarting containers. It shares the deployment concurrency group without cancelling a running deployment. The existing Lab Deploy also invokes this gate for future releases. This change does not alter app code, stored settings, credentials or volumes.

## Verified gates and exact next step

1. [Installed Modules Check 41334302858](https://github.com/emsebi/EMS_IPAM/actions/runs/41334302858) completed SUCCESS on `4d1f13bab5cda8a72317f1dd3f60d80735bf93f3`: the installed VM reports database ready and all seven modules loaded (including Network Map). Job `124930748508` passed four verifier tests and the fixed loopback GET without discovery or restart. PR #7 contains this gate. Follow PR CI [41334309419](https://github.com/emsebi/EMS_IPAM/actions/runs/41334309419) and push CI [41334302668](https://github.com/emsebi/EMS_IPAM/actions/runs/41334302668); both completed SUCCESS on the exact PR head `4d1f13b`. PR #7 was merged with that expected SHA after both CI and the installed check passed.
Merge commit: `e0442a6a28ecc282edd957b909224136eeebe7c1`. Its automatic CI [41334450553](https://github.com/emsebi/EMS_IPAM/actions/runs/41334450553) and installed recheck [41334450509](https://github.com/emsebi/EMS_IPAM/actions/runs/41334450509) were in progress at this final checkpoint; follow their actual outcomes next run. The merge tree exactly matches tested PR head `4d1f13b`; this follow-up changes documentation/checksums only.

2. No new deployment is needed for this diagnostic-only change: installed functional release remains `d1c712a`. The check is now available for future use, and future Lab Deploy runs require module readiness. Do not repeatedly redeploy or re-run completed verification without a new change or failure.
3. Next independent map milestone: extend existing MAC Trace toward IP lookup from saved evidence, with source/time/uncertainty and tests. Do not add background collection. Live Cisco/MikroTik compatibility still requires an explicit device scope; do not scan a real network or push router configuration.

Preserve administrator RADIUS Show/Copy/Hide and Shared Secret reveal, explicit NAS Collections without Company, credentials/memberships/Inventory links, Core Company and MAB/NAC boundaries, port 8888 and existing modules. TOTP remains deferred.

---

# Historical correction — signed RADIUS replies, 2026-11-01

Head 83d192264b173f2e0a043c6414ff5648fe596286 passed CI 41304146335 / 41304142214 and the full real lab 41304142213. The old installed server had no existing loopback-authorized account, so its read-only probe was skipped, not passed. The deployment check now supports an explicit temporary loopback-only /32 fixture with random credentials, exact cleanup and before/after configuration fingerprints; the real lab exercises it before it is used on the installed VM. Do not claim the old server's signing status until that actual probe returns. The hourly task "پیشرفت مرحله‌ای EMS-IPAM" was freshly created and enabled on November 1 after the old task failed again; verify subsequent runs rather than guaranteeing continuity.

PR #6 now includes response signing for RouterOS require-message-auth=yes-for-request-resp, in addition to removing Company. User evidence is server ACCEPT/Full but RouterOS Accepts=0, Bad Replies=11, Timeouts=15. Do not mistake the server event for a successful login or repeat the earlier unverified exclude-groups hypothesis. See the updated incident record. Preserve all credentials and assignments. Installed release is still 051f77be until deployment succeeds.

Company-free head 59ae4a6471c4de16bcb0f5e9fdaedec4a03f2df5 passed CI 41036116303 and real PostgreSQL/FreeRADIUS/Chromium 41036108311. The new reply-signature changes require a fresh final-head gate before deployment. PR #4 advanced to ffd30b88283da52de48259a951fe07d8b5795212 with successful full Docker/SSH fixture CI 41078690244; integrate it after PR #6. The automation again recorded failed and disabled after producing that map change. Its reported result does not explain the scheduling failure.

---

# Current work — RADIUS 1.1.0-lab, 2026-10-30

Branch `work/radius-collections-only-20261029` removes Company from RADIUS operator forms and API requirements. NAS Collections and explicit permission-profile assignments are the device-access boundary. See [release notes](docs/releases/radius-1.1.0-lab.md). This checkpoint is under test, not yet deployed; installed functional release remains `051f77be2f89bfd1bad90c2a80a495173088f48d` until a successful Lab Deploy is recorded.

Keep administrator Show/Copy/Hide, existing passwords/Shared Secrets, NAS membership, access rules and Inventory links. Migration 013 does not rewrite existing rows. Core IPAM/Inventory Company data and MAB/NAC policy are unchanged.

PR #5 was merged at `327fc335fe135ca6c3983036d82a7166031aea49`; protocol tests do not resolve the separate real RouterOS Full-to-Read incident. PR #4 Smart Network Map is next: head `3dd9ba5e453a1930452c4a344511cea69938ef8a` has PostgreSQL 16 coverage and successful CI 40929415085; full Docker smoke and integration/deployment remain. Continue that work without rebuilding the module.

The hourly automation was resumed on October 29, performed a bounded PR #4 test change, then was recorded failed and disabled again at 18:20 UTC. The task result does not explain the failure or prove continuous operation. Verify actual task state and run history before reporting it as active. No completion date is verified.

---

# Current continuation — RADIUS 1.0.1-lab

Functional release `051f77be2f89bfd1bad90c2a80a495173088f48d` is merged into main and deployed to the dedicated VM. CI 40233050436 and Lab Deploy 40233050403 succeeded, including real PostgreSQL/FreeRADIUS credential reveal, UDP authentication/accounting and outage recovery. Separate Real Lab run 40233050453 was preparing Chromium at this documentation checkpoint; follow its actual result. Documentation-only follow-ups can have a newer SHA than the deployed functional release.

The hourly development automation "تکمیل و تست EMS-IPAM" was found paused and resumed on 2026-10-26. Its obsolete instruction to remove administrator reveal was replaced with the acceptance contract below. The separate completion-only watch does not perform development. Continue actual implementation and report concrete progress or the precise blocker on each development run.

The user explicitly requires existing features to remain available while development continues. Administrator display/copy of saved RADIUS account passwords and NAS Shared Secrets is an accepted feature. Do not remove it or convert regression tests to expect its absence. Normal lists and audit/live logs omit credentials; explicit administrator POST reveal is a separate action.

See [RADIUS correction](docs/releases/radius-1.0.1-lab.md) and [feature acceptance contract](docs/FEATURE-ACCEPTANCE-FA.md). Use the actual current GitHub main HEAD as integration source; preserve in-progress module work. The dedicated user-provided VM is updated through the existing EMS-IPAM Lab Deploy workflow. Record the exact deployed SHA and completed run, not merely a queued job.

Next development priority is Smart Network Map / Network Trace: finish discovery account settings and manual read-only discovery, saved outputs and port-to-port topology, then path/impact analysis. Work from the existing map module and its branch/checkpoint; do not rebuild it from scratch or mix unfinished local changes into a release. Preserve IPAM, Radio, Personnel, client connectivity and donation support.

---

# Current checkpoint — v1.7.0-rc.3

See [release checkpoint](docs/releases/v1.7.0-rc.3.md) for current scope, checks and remaining work. This supersedes the historical Part 1 status below. Continue from the published checkpoint; preserve separate in-progress module branches.

---

# EMS_IPAM continuation checkpoint

Version: 1.7.0-rc.2 — Part 1 — 2026-10-06
Source: EMS_IPAM-v1.6.1-GitHub.zip supplied by the user. Intended repository: emsebi/EMS_IPAM. Publication attempted on 2026-10-06 but GitHub create_blob returned 403 Resource not accessible by integration. Main remains at 6f0cd5d4ced6dbe3931109f0b286fb206618f5b0. The delivered ZIP includes a binary Git patch for atomic user publication; no server deployment was performed.

## User decisions (authoritative)

Build and deliver one module/part at a time; user tests each ZIP. Preserve prior data and deliver source usable together. Target planning scale 100–500 devices, not yet benchmarked. Docker Compose installation. Device Types belongs under IP Manager with CRUD, selectable in IP editor; never in Settings. Personnel belongs beside MAC in Network Access, no standalone personnel menu. Radio view selects one AP and shows only its Stations. MAC collection from switches MUST be manual only; no timer, page load or search-triggered refresh. Future engineer RADIUS access for Cisco/MikroTik, topology/port detail/MAC path, device backups and staged MAB/802.1X VLAN/Reject.

## Implemented now

- Device Types routes and UI: modules/ipam/backend/index.mjs and public/index.mjs.
- Radio UI and single-host Ping route: modules/radio; shared IPAM hosts remain the source of truth.
- modules/network-access/public: two tabs displaying existing IPAM MAC records and personnel; no RADIUS enforcement or switch discovery.
- Core module backend createModule(ctx) loader with apiVersion 1; public assets served from /m/<id>/.
- Transactional baseline migration ledger + advisory lock/checksum. Seeds run only for absent catalogs, not on every startup. Deleted types, type renames and revoked module grants survive restart.
- Health checks database. Personnel pagination/query alias/export/close refresh fixes. Settings nested form removed. Installer avoids deleting optional services during a core update and preserves separately installed module directories.
- Docker PostgreSQL client pinned to major 16; PGDG signed apt repository configured. Docker smoke test includes real backup restore into isolated DB.

## Evidence and gates

60 node tests (mixed static contracts, functional tests, PGlite SQL/migrations); 11 browser/API scenarios passed on temporary PGlite backend and Chromium. Logs/screenshots under docs/test-results. API/browser tests are NOT PostgreSQL TCP, Docker, installer lifecycle, Windows client, live radio, Cisco or MikroTik certification. Docker build/install/backup smoke must run on user's VM. Record user results here before marking Part 1 accepted. No performance or high-availability benchmark exists.

## Remaining architectural limits

Most IPAM, inventory, personnel and core APIs still live in docker-app/server/main.mjs. The module split is started, not complete isolation. Radio read flow currently needs ipam + inventory + radio permissions and assigned company/space. Device type is still a legacy string on hosts, not a type_id FK. MAC owner is legacy text, not a normalized multi-MAC/person/device relation. Baseline schema.sql is checksum-locked; never modify it after release — append a new migration. The optional module migration runner is not implemented. Backend modules are trusted in-process code, not a security sandbox. Removing modules/ipam removes Device Type API; keep it as a required companion to this release.

Do not claim Network Access fully enabled just because the base records page exists. No real switch/RADIUS configuration has been written or sent. No background MAC reader exists. PGlite adapter is test-only, production uses pg/PostgreSQL16.

## Next work

1. User runs START-HERE-FA.md and Docker smoke; resolve concrete Part 1 failures first.
2. Obtain only models/OS versions and planned lab topology for Cisco/MikroTik, not passwords in chat.
3. Part 2: module-specific design/schema/API contracts for NAS profiles, credentials, RADIUS users, accounting; then one installable radius module. Use official model-specific docs.
4. Part 3A topology → 3B MAC path → 3C device backups; Part 4 network access policy; Part 5 complete integration/load/upgrade/restore tests. See docs/ROADMAP-FA.md.

## Developer commands

From docker-app: npm ci; npm test. Browser: npx playwright install chromium; npm run test:browser. Optional CHROMIUM_EXECUTABLE points to an installed Chromium. Temporary test server seeds only documentation IPs 192.0.2.0/24. Docker smoke runs from repository root: sudo bash scripts/docker-release-smoke.sh. It deletes only its own temporary project resources.

Keep every deliverable with a new version, changed-file manifest, results, compatibility notes and updated checkpoint. Do not reset/rewrite the app to change a single module.

## RC2 corrections — 2026-10-06

Client 0.8.0 adds the compiled Windows EXE (C# source and optional rebuild script included), registered application/protocol capabilities, per-user settings preservation, visible errors, default WinBox port -> IP-only target, IPv6 brackets, and an offline acceptance suite. The launcher passes the URI to PowerShell as base64 data; the validated tool arguments never contain the URI. Existing Firefox/Windows user choices can still override protocol registration; the guide explains choosing EMS-IPAM-Client.exe. Do not claim reinstall silently rewrites browser choices.

Only client 0.8.0 remains in downloads. DELETED-PATHS-rc2.txt lists old client archives plus stale files found on GitHub after web uploads. README has embedded real screenshots, one-command install, manual ZIP extraction/install and upgrade instructions. Installer uses the shared official Docker repository setup, supports stdin and defaults Portainer off.

Updated evidence: 60 Node tests; 11 browser/API scenarios; 22 portable PowerShell logic checks; Windows-target C# compilation. Browser tests use synthetic 192.0.2.0/24 data. Real Windows association/WinBox and Docker/PostgreSQL TCP remain acceptance gates. Test.cmd runs 26 checks on Windows (22 logic + 4 launcher/recorder integration assertions); those four Windows checks were NOT run in the build environment.

Latest user decision: finish and test these fixes, deliver a clean current client and GitHub landing page, then after user acceptance deliver RADIUS as an add-on to this project. Follow docs/NEXT-RADIUS-FA.md. Do not rebuild the entire application or implement background MAC polling.
