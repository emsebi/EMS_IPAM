# Current work — P0 NAC Preview integration, 2026-11-05 20:00 UTC

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
