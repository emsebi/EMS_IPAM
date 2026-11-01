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
