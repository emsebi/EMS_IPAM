# EMS_IPAM continuation checkpoint

Version: 1.7.0-rc.1 — Part 1 — 2026-09-29
Source: EMS_IPAM-v1.6.1-GitHub.zip supplied by the user. Intended repository: emsebi/EMS_IPAM. This release has not been pushed or deployed by the assistant.

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

56 node tests (mixed static contracts, functional tests, PGlite SQL/migrations); 10 browser/API scenarios passed on temporary PGlite backend and Chromium. Logs/screenshots under docs/test-results. API/browser tests are NOT PostgreSQL TCP, Docker, installer lifecycle, Windows client, live radio, Cisco or MikroTik certification. Docker build/install/backup smoke must run on user's VM. Record user results here before marking Part 1 accepted. No performance or high-availability benchmark exists.

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
