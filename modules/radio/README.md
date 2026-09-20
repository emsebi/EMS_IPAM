# Radio Management module

This module provides a simple AP/Station relationship view. It deliberately does **not** monitor signal, performance, or device credentials.

- AP and Station records reuse the shared `hosts`/IPAM inventory records.
- Search supports partial Name, IP, MAC and SSID.
- Each Station points to a parent AP.
- IP details remain editable from IPAM/Inventory.
- Removing this module folder disables the Radio navigation after restart/update.
