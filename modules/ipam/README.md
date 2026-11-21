# IP Manager companion — 1.7.0-rc.2

Required companion module for Core 1.7.0-rc.2. Provides Device Types backend CRUD and the independent catalog UI. Main IPAM/inventory APIs still belong to Core. Uses module API 1 and the shared database. See docs/MODULE-SDK-FA.md for replacement and migration rules.

## Device Types responsive compact layout (1.7.0-rc.2+device-types.1)
The admin-only Device Types catalog now presents the type name, swatch, inventory count and inline Edit/Delete controls in the same short row. The list uses a responsive grid with multiple cards per row on desktops and a single column on mobile. The editor is compact; the underlying `device_types` schema and CRUD/rename/delete protections remain unchanged. No new dependencies or Core changes. The module manifest version was bumped to refresh client JS/CSS caches.
