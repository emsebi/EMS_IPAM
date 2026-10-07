# Radio Management module

This module provides a simple AP/Station relationship view. It deliberately does **not** monitor signal, performance, or device credentials.

- AP and Station records reuse the shared `hosts`/IPAM inventory records.
- Search supports partial Name, IP, MAC and SSID.
- Each Station points to a parent AP.
- Edit, IPAM navigation and one-host Ping are separate actions.
- The last Ping result is shown as Online, Offline or Unknown.
- Stations without a parent AP remain visible in a dedicated section.
- IP details remain editable from IPAM/Inventory by administrators; read-only users can inspect and Ping.
- Removing this module folder disables the Radio navigation after restart/update.

Version 2.0.0-rc.1 uses API 1. Select one AP to view its stations, with pagination and an orphan group. `backend/index.mjs` owns manual host Ping; `public/index.mjs` owns this page. For non-admin users, the current shared-data flow requires IPAM, Inventory and Radio grants plus assigned company/space access. Core 1.7.0-rc.2 is required for this loader. See docs/MODULE-SDK-FA.md.
