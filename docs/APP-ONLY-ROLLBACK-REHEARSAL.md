# Isolated app-only rollback rehearsal

This is a CI test, **not a VM deployment command**. It accepts two local checkouts and creates uniquely named, labelled Docker resources on an internal network. It publishes no ports, mounts no live files, loads no optional modules, and never runs RADIUS or contacts a device. The protected component is an inert sentinel; passing this test is not evidence of live RADIUS acceptance.

The baseline is pinned to `f3995f6f75a258d63e6f93ec252825799e7a8de2`, the earlier app source referenced by the VM update. The candidate is the exact PR/push head. Both use their complete Dockerfile/server/public/dependency source; no UI-only copy. Existing CI still covers full application, browser, modules and native PostgreSQL independently.

The rehearsal actually performs these operations in disposable Docker:

1. Start the baseline app and PostgreSQL 16; seed only synthetic Company/Space/Host/Prefix/users/grants and a protected-table sentinel. Record DB/sentinel ID, image, start time, restart count and running state.
2. Create a custom-format `pg_dump`, restore it with `pg_restore --exit-on-error` into a second database, and compare complete fixture rows and migration ledger. Merely listing the dump is insufficient.
3. Replace only the app with the candidate, require health, compare every runtime file and the served Import classifier with source, and verify existing values and grants. Only the known additive core color migration is allowed to extend the ledger; old checksums must match. Legacy colors backfill and new default OFF are checked.
4. Create synthetic records after upgrade and save a color opt-out. Exercise the shared app transition controller with an unhealthy candidate and partial creation failure, then require the captured original image/configuration, healthy app, unchanged ledger, all pre/post-upgrade records and color choices, and stable protected identities. Additional negative recovery cases must be classified as `rollback_failed`, never successful recovery. No database restore occurs during rollback, so acknowledged new writes survive.
5. Delete only resources with this run's ownership label. Upload a small JSON result containing source SHAs, checkpoint results, backup hash and cleanup status; do not upload database dumps or fixture rows.

The workflow runs on GitHub-hosted `ubuntu-24.04`, never the self-hosted VM runner. Run locally only on a disposable Docker development host:

```sh
python3 scripts/app-only-rollback-rehearsal.py --baseline /path/to/pinned-baseline --candidate /path/to/candidate --evidence /tmp/app-only-rollback.json
```

## Limits and next gate

This checks app rollback compatibility and backup restoration for the declared fixture and additive migration. It does not test every error branch of the separate operational workflow, all module migrations, real RADIUS data, traffic continuity, concurrent production writes, VM UI, or user-PC launchers. Future migrations must extend the reviewed compatibility expectations instead of silently passing this gate.

Historical runs `45652142411` (isolated VM preview) and `46016912440` (main app-only update to source `613c217` on port 8888) succeeded. The latter kept installed non-map modules and checked DB/RADIUS container identities; it recorded a mixed installed source rather than a uniformly deployed repository tree. Its `pg_restore --list` is not restore rehearsal, and a green health endpoint is not UI acceptance. Do not repeat that rollout or invoke the older `lab-deploy` path. Before another permitted rollout, review the exact operational script, protected-module migration compatibility, persistent compose/image/mount configuration, backup/restore and rollback evidence, then require fresh VM health/data/UI evidence without violating the RADIUS freeze. All acceptance remains separate in Issue #89.

## App transition controller and negative recovery tests

`scripts/app_only_transition.py` contains the apply/recovery control flow used by the disposable Docker adapter. It has no CLI, Docker dependency, VM adapter, database restore operation or operation to restart/repair protected components. Preconditions must confirm the backup, current baseline health/configuration, preserved data and stable protected identities before the first app mutation. Verification must return literal `True`; missing evidence does not pass. The mutation is marked attempted **before** invoking app replacement, so failure after removing the app still enters recovery.

Each mutable Docker case takes a fresh backup, restores it in the separate test database, and compares complete rows (including the additive color column once present), grants and ledger. Preflight rejects that backup if the current data no longer matches. A specific stale-backup case after new acknowledged writes must remain `blocked` with the original app container untouched. The running app database is never restored during these transitions.

The baseline comes from the currently installed test app's immutable image ID and a hash of its reproducible launch configuration, not a hard-coded old tag. The fixture hash covers command/entrypoint, environment, user, work directory, volume/bind/tmpfs declarations, network mode, port bindings, capabilities, security options, labels and restart policy. It excludes generated hostname/container ID/IP/start time; raw environment and credentials never enter evidence. This fingerprint is a fixture contract, not a complete VM mount/Compose compatibility proof.

The first Docker run correctly refused to certify recovery because the configuration fingerprint differed. Value-free diagnostics identified only `config.Env`, with identical entries in a different order. Environment comparison now canonicalizes unique names and their complete values; missing/changed values still fail and duplicate/malformed keys are rejected. Command/entrypoint order is not normalized. Diagnostics list differing field names only, never environment values or their individual hashes.

An apply failure always raises `TransitionFailure`, including when recovery succeeds. The report distinguishes `blocked` (no mutation), `applied`, `rolled_back` and `rollback_failed`. Recovery independently requires recreation, captured image/configuration, health, preserved data and unchanged protected identities. All recovery checks run even when recreation fails; a later healthy endpoint cannot hide a failed restore command. Only fixed phase/error categories enter the report, not exception text or inspect/row data.

| Disposable Docker case | Required outcome |
|---|---|
| Candidate returns actual HTTP 503 after successful upgrade and acknowledged new writes | `rolled_back`; old app healthy, new writes and color OFF choices retained |
| Reuse the preceding backup after new acknowledged writes | `blocked`; no app replacement or rollback is attempted |
| Candidate creation raises after removing only the owned app | `rolled_back`; absent app recreated from captured baseline |
| Restore command fails | `rollback_failed`; error retained even if other checks pass |
| Restored process returns actual HTTP 503 | `rollback_failed`; health is mandatory |
| Restore uses a different healthy image | `rollback_failed`; image identity is mandatory |
| Restore uses correct image with different environment | `rollback_failed`; launch configuration is mandatory |
| Protected-identity inspection becomes unavailable | `rollback_failed`; no protected component is mutated to simulate this fault |
| Candidate checks all pass | `applied`; no rollback |
| Another unhealthy transition after the successful install | `rolled_back` to the newly captured current image, not the first historical baseline |

After asserting a deliberately failed recovery, the **test harness only** restores its own disposable fixture so later cases can run. This is not an implicit controller retry and never involves a VM. The artifact retains each actual status and the expected status separately. Unit tests additionally cover changed protected IDs/images/start times/restart counts/running state, preflight drift, indeterminate checks, interrupted/partial mutations, secret-free errors and data preservation.

## Operational rollout still blocked

The historical [updater at 1800cc1](https://github.com/emsebi/EMS_IPAM/blob/1800cc119166ee65cd90cbc810cf7d52d733cf1c/.github/workflows/main-panel-guarded-update.yml) is **not modified or invoked** by this change. It still requires `$LIVE/modules` before an update but leaves the app on `$BACK/modules`, does not persist that selection in the normal Compose configuration, and suppresses restore-command failure without requiring recovery health/identity. The new controller validates a replacement for the last behavior in isolation; it is not wired into that unsafe historical workflow.

Before VM rollout, implement and rehearse a reviewed app-only adapter that captures the actual installed mounts/configuration, persists a durable lifecycle selection, holds a deployment lock, records crash-recovery state, preserves the exact frozen modules, validates all startup/migration compatibility and restores a real permitted backup in isolation. In-process exception/interrupt handling does not claim power-loss, SIGKILL or deployment-host restart recovery. Direct VM access was previously unavailable from this workspace; no new access or install is attempted here. Continue independent #89 work while this operational gate is blocked. No new real RADIUS test is requested.
