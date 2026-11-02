# Smart Network Map — 0.2.0-lab.4

MAC observations now explicitly distinguish an unset root, a root absent from the saved map, no saved path from the root, and an observation on the root itself (zero inter-switch links). A missing saved path does not claim a live outage or discard the port/source/time evidence. These labels apply equally to direct MAC searches and MAC candidates selected from IPv4 results. Collection remains manual.

The search form now offers MAC or IPv4 lookup. IPv4 results show every saved inventory candidate, its address space and inventory edit time, and explicitly mark the binding uncertain/unobserved. Selecting a MAC opens its saved switch/port/VLAN evidence with separate observation source/time and stale status. Searching, choosing a candidate and clearing results perform no collection. The original MAC lookup and registration remain available.

## Saved IPv4 trace API

Administrator-only `GET /api/network-map/trace-ip?companyId=…&ip=192.0.2.50` reuses active IPAM host records and saved MAC forwarding tables. Optional API `spaceId` disambiguates overlapping address spaces inside the selected Company; records from other Companies and archived hosts/spaces are excluded. The existing MAC trace API remains compatible.

The result contains bounded inventory `records` (up to 100) and `matches` with a MAC trace for each distinct valid MAC. `recordUpdatedAt` describes an inventory edit, **not** a network observation; inventory `observedAt` is null. Switch observations retain their own source/time/staleness. Resolution is `not-found`, `missing-mac`, `ambiguous` or `inventory-match`; overall confidence remains `uncertain` because no observed ARP binding is available. Missing switch observation times are stale. This endpoint never performs ARP, SSH, ping, discovery or automatic MAC refresh. IPv6 lookup is not included in this increment.

This increment adds an isolated, administrator-only **manual read-only discovery** flow. It does not push configuration and does not poll automatically.

- The administrator saves an SSH read account, explicit device list and/or bounded IPv4 ranges. The password is AES-256-GCM encrypted with a file key outside PostgreSQL and is never returned by the API.
- **Create Map** is the only full discovery trigger. It runs a fixed allowlist of Cisco or MikroTik read commands; no arbitrary CLI endpoint exists.
- The first SSH host key is remembered per company/address/port. A changed key blocks collection.
- LLDP/CDP/MikroTik neighbors produce port-to-port links. Device status distinguishes unreachable, login failure, changed host key and incomplete reads.
- Saved node data includes ports, VLAN/trunk evidence, selected capabilities and MAC forwarding observations. MAC trace includes source and collection time and marks uncertainty/staleness.
- Map positions and an optional background image are stored independently of topology data. Impact analysis is a physical-topology estimate and explicitly does not claim STP/LAG/routing certainty.
- Each successful manual run stores one readable JSON snapshot; only the latest 20 are retained. Configuration text is optional and credential-bearing lines are removed before it reaches the archive.
- Module tables and files are separate from IPAM and RADIUS. Registering a MAC here never enables MAB and never changes access policy.

Validation includes offline parser fixtures and a PGlite-backed API scan with an injected collector. Version 0.2.0-lab.3 passed full CI and was deployed to the dedicated lab VM; see the [release evidence](../../docs/releases/network-map-0.2.0-lab.3.md). Live Cisco/MikroTik compatibility remains unverified and requires an explicit device scope.

CI also runs the module migration, encrypted settings, explicit manual scan, snapshot archive and restart persistence against an isolated PostgreSQL 16 service. This validates the production database driver and SQL types without contacting network equipment. These checks and the full Docker Compose gate passed for the released SHA; the deployment separately verified installed module readiness and data preservation.

The full Compose gate adds an isolated synthetic Cisco-like SSH service on the temporary project network. It verifies that the production app image loads the module, stores a read-only account without starting discovery, runs only after the explicit Create Map request, records port/VLAN/MAC and LLDP/CDP evidence, removes configuration secrets from the readable snapshot and preserves settings, topology and files after an app-container restart. The fixture has no host port and never contacts a real device.
