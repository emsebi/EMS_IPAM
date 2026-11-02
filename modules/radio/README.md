# Radio Management (2.1.0-lab.1)

Documentation-focused AP / Station topology on the existing EMS_IPAM module.
No background device polling, RouterOS scripts, new device credentials, SSH logins,
SNMP polling, signal/CCQ measurements, alert engine or router configuration changes.

## Features
- Select an AP from the existing shared IPAM/Inventory records and display its registered Stations.
- Map: inventory Switch/System -> AP -> Stations. Each node shows available name, IP and location.
- Record an uplink destination from the **same company and accessible Inventory**, plus port/interface. Only panel administrators can change this.
- Persist the link in the module-owned JSON file `<backupDir>/radio-documentation/uplinks.json` (atomic, no secrets). Include this file in operational backups.
- Display recorded `vendor` first; otherwise look up a **limited offline OUI hint** for MikroTik, Ubiquiti and one TP-Link prefix. Unknown and locally-administered MACs are labeled unknown. OUI identifies a MAC registrant, not product model.
- Keep old selection, paginated station rows, filters, edit/IPAM links, orphan stations and manual Ping in place.
- Frontend uses the existing Inventory endpoint; the only new API is `GET/PUT /api/radio/uplink`. No database migration or core change.

## How to use
1. Register the AP as `Radio Mode: AP` using existing Inventory.
2. Register station devices as `Radio Mode: Station` and select their AP.
3. Register the destination switch or system as an ordinary Inventory device.
4. Open Radios, select the AP, choose the destination and port, then Save link.
5. If a Station has no known manufacturer, enter its Vendor in Inventory. Unregistered stations are not auto-discovered.

## Verification and deployment safety
`node --test docker-app/tests/radio-documentation.test.mjs`.
Deploy only after CI passes, back up database and current module folder, preserve existing
RADIUS secrets/configuration and volumes, and verify installed APIs and browser routes.
The device-specific live MikroTik discovery is intentionally deferred: no automated
connection is made simply by opening the map.
