# IP Manager companion — 1.7.0-rc.2

Required companion module for Core 1.7.0-rc.2. Provides Device Types backend CRUD and the independent catalog UI. Main IPAM/inventory APIs still belong to Core. Uses module API 1 and the shared database. See docs/MODULE-SDK-FA.md for replacement and migration rules.

## Device Types responsive compact layout (1.7.0-rc.2+device-types.1)
The admin-only Device Types catalog now presents the type name, swatch, inventory count and inline Edit/Delete controls in the same short row. The list uses a responsive grid with multiple cards per row on desktops and a single column on mobile. The editor is compact; the underlying `device_types` schema and CRUD/rename/delete protections remain unchanged. No new dependencies or database/API changes. The module manifest version was bumped to refresh its client JS/CSS caches. Shared Core CSS is updated separately for the density of /24 IP cells and other IPAM tables.

## Shared IPAM compact tables (Core CSS, 2026-11-21)
The same compact spacing applies to the /16 overview and /24 **vertical** and **graphical** views. The /24 vertical IP row is designed around 34px, while the graphical IP/host tile is 43px tall to preserve the octet and one truncated host name line. The /24 picker, inventory table, prefix list, and shared management rows have reduced redundant padding. Long text is not forced to overlap controls; ellipsis / horizontal scrolling remain available. The stylesheet query version in `docker-app/public/index.html` is updated to prevent stale cached spacing. UI acceptance measures the real browser row heights and label containment for both /24 display modes.
