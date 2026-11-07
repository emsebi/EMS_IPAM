# Operations Overview — 0.1.0-lab.1

Admin-only, read-only **real-data** dashboard with five sections.

- **IPAM + Inventory:** Reads authorized inventory records and registered address spaces. Does not invent free IP counts.
- **Sites/Branches:** Reads company/site details, contacts, people and ranges from the existing Company API.
- **Radio links:** Displays saved AP→Station membership and last manual ping. A diagram is not a geographic basemap. GPS distance only appears when both endpoints contain valid coordinates.
- **RADIUS:** Reads NAS, permission profiles, NAS Collections, assignments and real recorded events; no passwords or secret values.
- **Network Map:** Reads the last saved topology and its links. No scanning or periodic polling; the original Network Map retains explicit manual discovery.

All edit links lead to the existing pages. No new database migration, router command, RADIUS policy, automatic SSH, or TOTP is introduced.

## Acceptance checklist (test VM, not production)

1. Admin sidebar shows the new Operations Overview entry. All five tabs load.
2. Adding a real IPAM host changes inventory counts only after refresh; no dummy records appear.
3. Switching branches shows each branch's own contacts, ranges and devices; stale responses cannot overwrite the selected branch.
4. Selecting an AP shows only its saved stations. No GPS gives no distance, and missing ping remains unknown.
5. RADIUS tables match persisted NAS Collections/profiles, access assignments and recent authentication events; no credential reveal.
6. The map tab reads saved nodes/links only for the selected site; opening it does not trigger discovery.
7. Existing RADIUS, IPAM, Radio and Network Map workflows and browser tests still pass.

**Status:** first implemented integration increment, **not** full parity with the prior concept images. No VM deployment or acceptance asserted. Do not use generated concept images as screenshots.
