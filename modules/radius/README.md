# RADIUS / MAB offline preview
This module is a **pure offline simulation** of a MAB authorization policy, not a RADIUS server.
It does not accept network authentication, provision credentials, change device configuration, or enforce network access.
The caller must supply an explicitly enabled policy and MAC inventory. Invalid and ambiguous inputs fail closed.
MAB identities can be spoofed. Do not connect this preview directly to a production Access-Accept path.
Run: `node --test docker-app/tests/radius-policy-preview.test.mjs`.
Operational deployment requires authenticated tenant-scoped APIs, audit logs, secure NAS secrets, FreeRADIUS/EAP integration, accounting and lab tests.
