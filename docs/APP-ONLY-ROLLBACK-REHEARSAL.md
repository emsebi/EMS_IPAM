# Isolated app-only rollback rehearsal

This is a CI test, **not a VM deployment command**. It accepts two local checkouts and creates uniquely named, labelled Docker resources on an internal network. It publishes no ports, mounts no live files, loads no optional modules, and never runs RADIUS or contacts a device. The protected component is an inert sentinel; passing this test is not evidence of live RADIUS acceptance.

The baseline is pinned to `f3995f6f75a258d63e6f93ec252825799e7a8de2`, the earlier app source referenced by the VM update. The candidate is the exact PR/push head. Both use their complete Dockerfile/server/public/dependency source; no UI-only copy. Existing CI still covers full application, browser, modules and native PostgreSQL independently.

The rehearsal actually performs these operations in disposable Docker:

1. Start the baseline app and PostgreSQL 16; seed only synthetic Company/Space/Host/Prefix/users/grants and a protected-table sentinel. Record DB/sentinel ID, image, start time, restart count and running state.
2. Create a custom-format `pg_dump`, restore it with `pg_restore --exit-on-error` into a second database, and compare complete fixture rows and migration ledger. Merely listing the dump is insufficient.
3. Replace only the app with the candidate, require health, compare every runtime file and the served Import classifier with source, and verify existing values and grants. Only the known additive core color migration is allowed to extend the ledger; old checksums must match. Legacy colors backfill and new default OFF are checked.
4. Create synthetic records after upgrade and save a color opt-out. Start a deliberately unhealthy process in the candidate image, detect the failed health check, then recreate only the original app. Require the original image and healthy app, unchanged ledger, all pre/post-upgrade records and color choices preserved, and stable protected identities. No database restore occurs during rollback, so acknowledged new writes survive.
5. Delete only resources with this run's ownership label. Upload a small JSON result containing source SHAs, checkpoint results, backup hash and cleanup status; do not upload database dumps or fixture rows.

The workflow runs on GitHub-hosted `ubuntu-24.04`, never the self-hosted VM runner. Run locally only on a disposable Docker development host:

```sh
python3 scripts/app-only-rollback-rehearsal.py --baseline /path/to/pinned-baseline --candidate /path/to/candidate --evidence /tmp/app-only-rollback.json
```

## Limits and next gate

This checks app rollback compatibility and backup restoration for the declared fixture and additive migration. It does not test every error branch of the separate operational workflow, all module migrations, real RADIUS data, traffic continuity, concurrent production writes, VM UI, or user-PC launchers. Future migrations must extend the reviewed compatibility expectations instead of silently passing this gate.

Historical runs `45652142411` (isolated VM preview) and `46016912440` (main app-only update to source `613c217` on port 8888) succeeded. The latter kept installed non-map modules and checked DB/RADIUS container identities; it recorded a mixed installed source rather than a uniformly deployed repository tree. Its `pg_restore --list` is not restore rehearsal, and a green health endpoint is not UI acceptance. Do not repeat that rollout or invoke the older `lab-deploy` path. Before another permitted rollout, review the exact operational script, protected-module migration compatibility, persistent compose/image/mount configuration, backup/restore and rollback evidence, then require fresh VM health/data/UI evidence without violating the RADIUS freeze. All acceptance remains separate in Issue #89.
