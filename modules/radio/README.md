# Radio Management (2.2.0-lab.1)

Documentation-focused AP / Station topology on the existing EMS_IPAM module.
No background device polling, RouterOS scripts, new device credentials, SSH logins,
SNMP polling, signal/CCQ measurements, alert engine or router configuration changes.

## Features
- Select an AP from the existing shared IPAM/Inventory records and display its registered Stations.
- Map: inventory Switch/System -> AP -> Stations. Each node shows available name, IP and location.
- Record an uplink destination from the **same company and accessible Inventory**, plus port/interface. Only panel administrators can change this.
- Persist the link in the module-owned JSON file `<backupDir>/radio-documentation/uplinks.json` (atomic, no secrets). Include this file in operational backups.
- Display recorded `vendor` first; otherwise look up a **limited offline OUI hint** for MikroTik, Ubiquiti and one TP-Link prefix. Unknown and locally-administered MACs are labeled unknown. OUI identifies a MAC registrant, not product model.
- Record each AP and Station geographic latitude/longitude with a map click or manual numeric entry, optionally clear, and display the saved pins in an authenticated OpenStreetMap view. The current Inventory location text and device model remain unchanged.
- Device node shows saved Ping result/time, model, MAC, IP and existing connection methods. **Connect** launches the existing HTTP/HTTPS/WinBox/SSH chooser; no automatic login or secrets are transmitted in the map.
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
Map tiles are fetched by the browser only while the map is displayed, using OSM's standard tile endpoint with visible attribution. The map frame has a dedicated narrow CSP; the Core CSP is unchanged. If internet access is unavailable, existing coordinates remain editable and saved, but map tiles may not load. Saved locations live under `<backupDir>/radio-documentation/locations.json`, next to `uplinks.json`. These module-owned JSON files are persisted in the backup volume **but are not included in the Core database-only tar.gz backup**; include this directory in external backups until a unified backup feature is implemented.

The device-specific live MikroTik discovery is intentionally deferred: no automated
connection is made simply by opening the map.

## Location usage
1. Open Radio, select an AP, then the target AP or Station in **AP and Station locations**.
2. Click the OpenStreetMap background to populate latitude/longitude or type both fields.
3. Save location. Existing pins appear for that AP and its registered Stations; click a pin to select its radio.
4. Open online map links to view the current point on the public OSM website.
5. To rename the physical location label or set Model/Connection methods, use the original Inventory editor.

## Access control and map privacy
- GET locations requires Radio access and limits results to host/space/company visibility.
- Only panel admins may save coordinates; all inputs are range checked. Map iframe HTML requires login.
- Opening OSM loads public tiles based on the currently viewed map area; device identifiers, credentials and inventory are not sent to OSM.
