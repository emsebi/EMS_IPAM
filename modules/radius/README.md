# RADIUS / MAB offline preview
This module is a **pure offline simulation** of a MAB authorization policy, not a RADIUS server.
It does not accept network authentication, provision credentials, change device configuration, or enforce network access.
The caller must supply an explicitly enabled policy and MAC inventory. Invalid and ambiguous inputs fail closed.
MAB identities can be spoofed. Do not connect this preview directly to a production Access-Accept path.
Run: `node --test docker-app/tests/radius-policy-preview.test.mjs`.
Operational deployment requires authenticated tenant-scoped APIs, audit logs, secure NAS secrets, FreeRADIUS/EAP integration, accounting and lab tests.

## Panel integration — 0.2.0-rc.1
The module now has its own manifest, backend preview endpoints, panel UI, styles and English/Persian catalogs under `modules/radius`. It uses the generic panel-module contract and therefore does not require a dedicated RADIUS route in Core. The panel endpoints remain preview-only and admin-only; they do not store secrets, listen for RADIUS packets, or push configuration.

## 802.1X authorization preview
`dot1x-policy-preview.mjs` is deliberately offline-only. It models authorization after an external trusted EAP verification and is not exposed as a caller-controlled authentication API. Failed EAP never falls back to MAB or guest access.
