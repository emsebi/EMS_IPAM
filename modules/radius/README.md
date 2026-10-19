# RADIUS module — stage 2 / 0.1.0-alpha.1

**Development checkpoint only: NOT production-ready; RADIUS authentication is NOT working yet.**

This commit introduces additive PostgreSQL tables and admin-only endpoints for NAS inventory, basic profiles, and event viewing. NAS shared secrets are encrypted with AES-256-GCM using `EMS_RADIUS_ENCRYPTION_KEY` (64 hex characters) and are never returned in API responses. Do not reuse panel admin accounts as engineer identities.

## Current endpoints
- GET/POST /api/radius/nas
- PUT/DELETE /api/radius/nas/:uuid
- GET/POST /api/radius/profiles
- GET /api/radius/events

## Integration requirements (not yet implemented)
1. Apply `migrations/001_radius_management.sql` to the existing PostgreSQL database under an audited, versioned module migration runner **before activating this module**. Existing Core does not automatically migrate module SQL.
2. Pass `EMS_RADIUS_ENCRYPTION_KEY` to the app container from a protected environment/secret store; do not commit actual keys.
3. Implement and test FreeRADIUS SQL integration, isolated engineer password provisioning, authenticated accounting ingestion, rate limiting, user/profile CRUD, NAS export/reload and vendor attributes.
4. Integrate route and UI into main panel navigation, compose.module.yml, lifecycle/backups and deterministic smoke tests.
5. Lab-test Cisco and MikroTik authentication, privilege/group mapping, reject, accounting, and server-outage behavior prior to deployment.

Do not expose RADIUS UDP ports or change production NAS devices until integration and lab acceptance. Preserve existing IPAM data and never edit checksum-locked baseline schema.
