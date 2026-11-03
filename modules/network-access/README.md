# EMS_IPAM module 05 — Network Access / NAC (0.2.0-lab.1)

This remains the original \`network-access\` module, not a second NAC or RADIUS engine. The original MACs and Personnel views are preserved. A separate panel in the existing sidebar provides **draft** NAC profiles.

## Shipped in this increment

- Independent profile definitions: registered-MAC behavior (reject, existing port VLAN, dynamic VLAN) and unknown-MAC behavior (reject, switch-side guest VLAN).
- Different NAS/switches can select different profiles; a profile can be reused.
- Per-NAS per-MAC exception (reject or allow, optional VLAN). Allow exceptions only work in the simulation when MAC credentials are already registered/enabled in the radius-ops registry.
- Admin-only CRUD API under \`/api/nac\`, policy preview and model-specific **review-only** CLI drafts (Catalyst legacy/IOS and RouterOS). Every update is auditable.
- No changes to the live FreeRADIUS SQL auth policy, radcheck, radreply, NAS secrets, 802.1X/EAP, port configuration, background collection or existing device-login authorization.
- Original MAC/Personnel interfaces remain at their old routes; the new generic page is at \`#/module/network-access\`.

**IMPORTANT: "Enabled" means included in the planning simulator, NOT enabled in RADIUS.** A simulated Access-Accept is never authorization proof or a test with real network devices. Guest/reject VLAN outcomes require a matching switch feature/configuration. CLI drafts contain placeholders, not real secrets, and are not executed.

## Boundaries & preparation for full NAC

- FreeRADIUS server-side MAB and device-admin live flows remain owned by \`radius-ops\`. This module reads its NAS and MAC registry IDs, but does not duplicate credentials.
- A per-switch binding requires a host-specific `/32` NAS; a shared fallback CIDR is unsafe because different physical switches would otherwise silently inherit one policy.
- The current live MAB path still scopes the existing MAC registry to legacy Company metadata. Company-free NASes can therefore have **no effective live MAB authorization** until a separate, tested runtime migration is made. The preview does not misreport this case as authorized.
- Module migration runs alphabetically before \`radius-ops\` on clean installations, so this module intentionally has no cross-module foreign keys. All target NAS/profile IDs are checked before writing through the API. Orphan NAS rows are inert until that NAS ID is valid again.
- Importing an observed MAC from IPAM/Network Map never automatically authorizes it. Deliberate approval through the RADIUS MAC registry is required.
- A disabled registered MAC fails closed even if the unknown-MAC profile points to a guest VLAN.
- MAC-based authorization can be spoofed; 802.1X EAP-TLS, managed certificates, CoA, guest portals, posture/endpoint inspection, multi-host/voice VLAN and high-availability are **not** implemented.
- Unknown MAB device: RADIUS still sends Access-Reject with current runtime. Catalyst 3750 (IOS 12.2(55)SE) can assign a configured guest VLAN after failed MAB in supported single-host mode. RouterOS 7.2+ provides \`reject-vlan-id\` for RADIUS Access-Reject; \`guest-vlan-id\` is different and cannot simply substitute for mac-auth rejection. In both cases a nonresponding RADIUS server is a *separate* failure policy.
- Do not deploy unverified templates to uplinks, trunk, AP, management, voice or mixed-host ports. Before rollout validate switch hardware, IOS/RouterOS version, syntax, existing VLANs, voice design, AAA source IP/secret, host mode, RADIUS failover/critical VLAN, management recovery, reauth/rollback.
- Policy precedence for a future live engine: disabled NAS/binding/profile => deny; disabled or cross-scope MAC => deny; known MAC with enabled per-NAS override => override; otherwise known MAC => known profile; unknown MAC => unknown profile. Unknown guest is **RADIUS reject + switch guest mapping**, not Access-Accept.
- Runtime enforcement requires a separately tested bridge in \`radius-ops\` using authenticated UDP packet source, atomic RADIUS SQL authorization and PostgreSQL tests. The bridge must not change admin-login / Full-Read permissions or NAS Collections. Until then **no deployment should claim NAC enforcement**.

## API surface (admin only)

\`GET /api/nac/overview\`; \`POST /api/nac/profiles\`; \`PUT|DELETE /api/nac/profiles/:id\`;
\`PUT /api/nac/nas/:id\` (binding);
\`GET /api/nac/nas/:id/rules\`; \`PUT|DELETE /api/nac/nas/:id/rules/:mac\`;
\`GET /api/nac/preview?nasId=...&mac=...\`;
\`GET /api/nac/nas/:id/config?radiusIp=...&interface=...\`.
No endpoint directly writes network equipment.

## Acceptance gate before live rollout

1. Per-switch guest/deny, known MAC dynamic/static VLAN, MAC-specific block, disabled profiles and tenant isolation.
2. Genuine RADIUS Access-Request/Reject/Accept (PAP and supported MAB formats) with source-IP NAS match; confirm approved MAC resolves correctly without authorizing unregistered MACs. RADIUS EAP is out of scope until a proper TLS/certificate deployment.
3. Full/Read device login unchanged, NAS collections unchanged, password reveal/copy/hide unchanged.
4. Catalyst legacy and RouterOS version-specific port tests including guest/reject, voice, multi-host, server-down and restart/rollback on a non-uplink test port.
5. UI/admin authorization, migration checksum/restart, PostgreSQL, browser, Docker and VM validation on the **same** commit before any real-enforcement release.

References (CLI planning only):
- https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst3750/software/release/12-2_55_se/configuration/guide/scg3750/sw8021x.html
- https://help.mikrotik.com/docs/spaces/ROS/pages/328090/Dot1X
