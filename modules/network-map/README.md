# Smart Network Map — 0.2.0-lab.1

This increment adds an isolated, administrator-only **manual read-only discovery** flow. It does not push configuration and does not poll automatically.

- The administrator saves an SSH read account, explicit device list and/or bounded IPv4 ranges. The password is AES-256-GCM encrypted with a file key outside PostgreSQL and is never returned by the API.
- **Create Map** is the only full discovery trigger. It runs a fixed allowlist of Cisco or MikroTik read commands; no arbitrary CLI endpoint exists.
- The first SSH host key is remembered per company/address/port. A changed key blocks collection.
- LLDP/CDP/MikroTik neighbors produce port-to-port links. Device status distinguishes unreachable, login failure, changed host key and incomplete reads.
- Saved node data includes ports, VLAN/trunk evidence, selected capabilities and MAC forwarding observations. MAC trace includes source and collection time and marks uncertainty/staleness.
- Map positions and an optional background image are stored independently of topology data. Impact analysis is a physical-topology estimate and explicitly does not claim STP/LAG/routing certainty.
- Each successful manual run stores one readable JSON snapshot; only the latest 20 are retained. Configuration text is optional and credential-bearing lines are removed before it reaches the archive.
- Module tables and files are separate from IPAM and RADIUS. Registering a MAC here never enables MAB and never changes access policy.

Validation in this phase uses offline parser fixtures and a PGlite-backed API scan with an injected collector. Live Cisco/MikroTik compatibility and production PostgreSQL/Docker deployment remain separate acceptance gates.

CI also runs the module migration, encrypted settings, explicit manual scan, snapshot archive and restart persistence against an isolated PostgreSQL 16 service. This validates the production database driver and SQL types without contacting network equipment. Full Docker Compose installation on the dedicated VM and live Cisco/MikroTik compatibility remain separate acceptance gates.
