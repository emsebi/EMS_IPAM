# RADIUS authorization investigation — 2026-10-28

Status update, 2026-11-01: the user's RouterOS screenshot shows zero accepted replies, 11 bad replies and 15 timeouts while the server logs Access-Accept with Full. This is a response-validation incident; previous authorization-only checks did not establish successful login. The screenshot has require-message-auth=yes-for-request-resp. Do not publish the screenshot: it contains a credential.

The default virtual server did not explicitly add Message-Authenticator. The UDP test verifier checked HMAC only when that attribute happened to be present, so it could accept a reply rejected by strict RouterOS clients. The pending correction adds Message-Authenticator before any authorization rejection and verifies its presence and cryptographic validity in real UDP replies. Missing/forged signatures are regression cases. An installed loopback probe reports only signature and permission booleans before/after deployment; no existing credential is changed or logged.

A mismatched shared secret can also produce MS-CHAP server Accept plus RouterOS Bad Replies. The supplied screenshot's profile label alone does not prove the stored value matches. Keep the real-device incident open until a new login succeeds. Do not disable RouterOS reply validation as a workaround.

References: [FreeRADIUS response signing](https://www.freeradius.org/security/), [RouterOS RADIUS client](https://manual.mikrotik.com/docs/authentication-authorization-accounting/radius/), [RFC 3579 response HMAC](https://www.freeradius.org/rfc/rfc3579.html).

## Previous investigation (before the Bad Replies screenshot)

The user reports that an account assigned Full/Write is accepted through MS-CHAP but receives read access on the home lab router. This is an authorization incident, not a saved-password display issue.

## Installed VM evidence

Read-only diagnostic run [40610839484](https://github.com/emsebi/EMS_IPAM/actions/runs/40610839484) and its follow-up [40611603236](https://github.com/emsebi/EMS_IPAM/actions/runs/40611603236) confirmed:

- The affected account's stored access rule and `radius_ops_resolve_access` both select `Mikrotik-Group=full` and Cisco privilege 15.
- Successful authentication occurred after the account assignment changed.
- No static user/group reply was present to override that assignment.
- The running FreeRADIUS site and supervisor fingerprints match the current source. The persistent app and RADIUS containers have remained running since the previous deployment.
- Diagnostics use a read-only transaction and do not select credentials or raw audit details.

No production policy, credentials, data, router configuration or running container was changed during this investigation.

## Additional protocol regression coverage

The prior smoke checked authorization attributes primarily through PAP. The updated `scripts/radius-ops-docker-smoke.py` creates an account using the current UI's explicit `accessRules` path, without a legacy `group_id`, and changes its profile without restarting FreeRADIUS:

`read → full → write → read`

For each assignment it verifies exact Cisco and MikroTik attributes in real UDP replies for PAP, CHAP, MS-CHAP and MS-CHAPv2. MS-CHAPv2 uses the public RFC 2759 section 9.2 fixture, encoded according to RFC 2548 section 2.3.2. A corrupted proof must receive Access-Reject. Response checks reject request-only echoes, mismatched response IDs and conflicting duplicate attributes.

All 16 positive protocol/profile combinations and the invalid-proof rejection passed in disposable Docker/PostgreSQL/FreeRADIUS resources on the dedicated runner. Protocol run [40611603236](https://github.com/emsebi/EMS_IPAM/actions/runs/40611603236) and general CI [40611603119](https://github.com/emsebi/EMS_IPAM/actions/runs/40611603119) succeeded for diagnostic commit `d10f2615b8b4aa06ebe37373d0c081a19f79642d`. This follow-up carries the same smoke-test implementation; documentation and branch-specific diagnosis files differ.

`EMS_RADIUS_PROTOCOL_ONLY=1` ends after this protocol matrix and cleans up the disposable project. It does not claim the later accounting/outage tests ran. The ordinary smoke continues through those tests when this variable is absent.

## Remaining evidence

The disposable protocol test is not a capture of the affected router's response or proof of the permissions applied by RouterOS. Obtain the affected router's read-only `/user aaa print`, the policies of the selected local group, and active-session details. In particular, RouterOS replaces a group listed in `exclude-groups` with `default-group`; the current value on this router has not been verified. Do not mark the incident fixed until the real device applies the intended permissions.

References: [MikroTik remote AAA](https://help.mikrotik.com/docs/spaces/ROS/pages/8978504/User), [MikroTik RADIUS attributes](https://help.mikrotik.com/docs/spaces/ROS/pages/328097/RADIUS), [RFC 2759](https://www.rfc-editor.org/rfc/rfc2759.html), [RFC 2548](https://www.rfc-editor.org/rfc/rfc2548.html).
