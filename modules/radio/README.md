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
