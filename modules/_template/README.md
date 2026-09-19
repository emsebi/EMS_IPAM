# EMS IPAM module template

A real module lives in `modules/<module-id>/` and contains at minimum:

- `module.env`
- `compose.module.yml`
- its own application source/Dockerfile

The installer discovers modules automatically. No edit to core `compose.yml` is required.
The service must stay on the internal `ems_internal` network and should not publish a host port.
The core proxies `/m/<module-id>/...` to `EMS_MODULE_UPSTREAM` after authenticating the user.
The module receives `X-EMS-User-Id`, `X-EMS-User-Role`, `X-EMS-User-Name` and `X-EMS-Module-Prefix` headers from the core.
