#!/usr/bin/env python3
"""Disposable Docker rehearsal, never a VM deployment tool.

All containers/networks are newly named and owner-labelled, with no host ports,
no live mounts, no RADIUS modules, and no external device connections. The frozen
component is an inert sentinel, not RADIUS. Its result cannot prove live safety.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid
from app_only_transition import AppBaseline, TransitionFailure, execute_app_transition

BASELINE_SHA = 'f3995f6f75a258d63e6f93ec252825799e7a8de2'
LABEL = 'ems.app-only-rehearsal'
TABLES = ('companies', 'routing_domains', 'address_spaces', 'prefixes', 'hosts',
          'users', 'user_company_access', 'user_space_access', 'user_module_access',
          'personnel', 'company_contacts', 'company_connections', 'frozen_fixture_guard')


def command(*args, data=None, timeout=180):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Never include environment values, SQL rows, a dump or Docker inspect in logs.
        raise RuntimeError('Command failed: ' + ' '.join(args[:3]))
    return result.stdout


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


class Rehearsal:
    def __init__(self, baseline, candidate, evidence):
        self.baseline, self.candidate, self.evidence = baseline, candidate, evidence
        self.owner = uuid.uuid4().hex
        self.prefix = 'ems-rollback-test-' + self.owner
        self.app, self.db, self.frozen = [self.prefix + '-' + x for x in ('app', 'db', 'frozen')]
        self.net = self.prefix + '-net'
        self.old_image, self.new_image = [self.prefix + ':' + x for x in ('baseline', 'candidate')]
        self.report = {'status': 'running', 'baseline_sha': BASELINE_SHA,
                       'candidate_sha': command('git', '-C', str(candidate), 'rev-parse', 'HEAD').decode().strip(),
                       'environment': 'disposable Docker; inert frozen sentinel, no RADIUS service',
                       'deployed_sha': None, 'vm_acceptance': 'not tested', 'checks': []}
        self.phase = 'initialization'
        self.protected = None
        self.backup_verified = False
        self.backup_state = None
        self.expected_rows = self.expected_ledger = None
        self.expect_colors_off = False
        self.report['transitions'] = []
        self.report['backups'] = []
        self.app_configurations = {}
        self.report['baseline_identity_mismatches'] = []

    def check(self, name):
        self.report['checks'].append(name)
        print('PASS ' + name, flush=True)

    def inspect(self, kind, name):
        return json.loads(command('docker', kind, 'inspect', name))[0]

    def owned(self, kind, name):
        obj = self.inspect(kind, name)
        labels = obj.get('Config', {}).get('Labels') if kind in ('container', 'image') else obj.get('Labels')
        require((labels or {}).get(LABEL) == self.owner, 'Refusing to mutate a resource not owned by this rehearsal')
        return obj

    def remove_app(self):
        self.owned('container', self.app)
        command('docker', 'rm', '-f', '-v', self.app)

    def remove_app_if_present(self):
        if subprocess.run(['docker', 'container', 'inspect', self.app],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            self.remove_app()

    def app_baseline(self):
        obj = self.owned('container', self.app)
        # Hash only reproducible launch configuration, never emit Env/credentials.
        # Hostname, assigned IP, container ID and start time change on recreation.
        config = {k: obj['Config'].get(k) for k in ('Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Volumes', 'Labels')}
        host = {k: obj['HostConfig'].get(k) for k in ('Binds', 'Mounts', 'Tmpfs', 'ReadonlyRootfs', 'CapDrop',
                'CapAdd', 'SecurityOpt', 'NetworkMode', 'PortBindings', 'RestartPolicy')}
        fields = {**{'config.' + k: v for k, v in config.items()}, **{'host.' + k: v for k, v in host.items()}}
        digest = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()
        self.app_configurations[digest] = fields
        return AppBaseline(obj['Image'], digest)

    def preserved_data(self):
        return (self.snapshot() == self.expected_rows and self.ledger() == self.expected_ledger
                and (not self.expect_colors_off
                     or self.sql('SELECT bool_and(NOT inherit_color_to_children) FROM prefixes;') == 't'))

    def identity(self, name):
        obj = self.owned('container', name)
        return {k: v for k, v in [('id', obj['Id']), ('image', obj['Image']),
                ('started_at', obj['State']['StartedAt']), ('restarts', obj['RestartCount']),
                ('running', obj['State']['Running'])]}

    def assert_protected(self):
        require(self.protected == {n: self.identity(n) for n in (self.db, self.frozen)},
                'Protected component identity or running state changed')

    def sql(self, sql, database='rehearsal'):
        return command('docker', 'exec', '-i', self.db, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1',
                       '-U', 'rehearsal', '-d', database, data=sql.encode()).decode().strip()

    def snapshot(self, database='rehearsal', include_additive=False):
        # Preserve full rows (including archived values, hashes, IDs and timestamps).
        # Only the explicitly additive IPAM column is excluded from old-row comparison.
        pairs = ','.join("'%s',(SELECT COALESCE(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM "
                         "(SELECT to_jsonb(t)%s AS r FROM %s t) q)" %
                         (table, "-'inherit_color_to_children'" if table == 'prefixes' and not include_additive else '', table)
                         for table in TABLES)
        return json.loads(self.sql('SELECT jsonb_build_object(' + pairs + ');', database))

    def ledger(self, database='rehearsal'):
        return json.loads(self.sql("SELECT jsonb_object_agg(module_id || '/' || version, checksum) FROM schema_migrations;", database))

    def current_backup_state(self, database='rehearsal'):
        return {'rows': self.snapshot(database, include_additive=True), 'ledger': self.ledger(database)}

    def prepare_backup(self, case):
        self.phase = 'backup and isolated restore before ' + case
        self.backup_verified = False
        self.assert_protected()
        before = self.current_backup_state()
        dump = self.temp / 'baseline.dump'
        dump.write_bytes(command('docker', 'exec', self.db, 'pg_dump', '-Fc', '-U', 'rehearsal', '-d', 'rehearsal'))
        require(dump.stat().st_size > 0, 'Empty backup')
        digest = hashlib.sha256(dump.read_bytes()).hexdigest()
        # Both databases belong to this disposable owned test container. The
        # running app database is never restored, dropped or replaced.
        self.owned('container', self.db)
        command('docker', 'exec', self.db, 'dropdb', '--if-exists', '-U', 'rehearsal', 'restored')
        command('docker', 'exec', self.db, 'createdb', '-U', 'rehearsal', 'restored')
        command('docker', 'exec', '-i', self.db, 'pg_restore', '--exit-on-error', '-U', 'rehearsal', '-d', 'restored', data=dump.read_bytes())
        require(self.current_backup_state('restored') == before, 'Restored complete rows or ledger differs')
        require(self.current_backup_state() == before, 'Data changed while preparing backup')
        self.assert_protected()
        self.backup_state, self.backup_verified = before, True
        self.report['backup_sha256'] = digest
        self.report['backups'].append({'case': case, 'sha256': digest, 'restored_and_compared': True})
        self.check('current backup restored with complete rows, grants, color values and ledger before ' + case)

    def health(self):
        try:
            payload = command('docker', 'exec', self.app, 'node', '-e',
                              "fetch('http://127.0.0.1:8080/health',{signal:AbortSignal.timeout(1500)})"
                              ".then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())})"
                              ".catch(()=>process.exit(1))", timeout=5)
            obj = json.loads(payload)
            return obj.get('ok') is True and obj.get('database') == 'ready' and obj.get('modules') == []
        except (RuntimeError, subprocess.TimeoutExpired, ValueError):
            return False

    def wait_health(self, attempts=45):
        for _ in range(attempts):
            if self.health():
                return True
            time.sleep(1)
        return False

    def start_app(self, image, broken=False, wrong_config=False):
        args = ['docker', 'run', '-d', '--name', self.app, '--label', LABEL + '=' + self.owner,
                '--network', self.net, '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:size=64m,mode=1777',
                '--tmpfs', '/backups:size=64m,mode=1777', '-e', 'PGHOST=' + self.db,
                '-e', 'PGUSER=rehearsal', '-e', 'PGPASSWORD=Synthetic-Database-Only', '-e', 'PGDATABASE=rehearsal',
                '-e', 'EMS_ADMIN_USERNAME=rehearsal-admin', '-e', 'EMS_ADMIN_PASSWORD=Synthetic-Admin-Only',
                '-e', 'EMS_MODULES_DIR=/empty-modules', '-e', 'BACKUP_DIR=/backups']
        if wrong_config:
            args += ['-e', 'EMS_REHEARSAL_RUNTIME_MARKER=wrong']
        args += [image]
        if broken:
            # Real unhealthy process in the candidate image; no synthetic success stub.
            args += ['node', '-e', "require('http').createServer((q,r)=>{r.writeHead(503);r.end('unhealthy')}).listen(8080)"]
        command(*args)

    def verify_candidate_files(self):
        root = self.candidate / 'docker-app'
        paths = sorted(str(p.relative_to(root)) for d in ('public', 'server')
                       for p in (root / d).rglob('*') if p.is_file())
        actual = command('docker', 'exec', self.app, 'find', '/app/public', '/app/server', '-type', 'f', '-print0')
        require(set(p.decode().removeprefix('/app/') for p in actual.split(b'\0') if p) == set(paths),
                'Candidate file inventory differs')
        paths += ['package.json', 'package-lock.json']
        hashes = command('docker', 'exec', self.app, 'sha256sum', '--', *('/app/' + p for p in paths)).decode().splitlines()
        require(len(hashes) == len(paths), 'Candidate file hash count differs')
        for rel, line in zip(paths, hashes):
            require(line.split()[0] == hashlib.sha256((root / rel).read_bytes()).hexdigest(), 'Candidate file hash differs')
        served = command('docker', 'exec', self.app, 'node', '-e',
                         "fetch('http://127.0.0.1:8080/ipam-import-format.mjs').then(async r=>{"
                         "if(!r.ok)process.exit(1);process.stdout.write(Buffer.from(await r.arrayBuffer()))})")
        require(served == (root / 'public/ipam-import-format.mjs').read_bytes(), 'Served Import classifier differs')
        self.report['verified_candidate_files'] = len(paths)

    def run(self, temp):
        self.temp = temp
        require(command('git', '-C', str(self.baseline), 'rev-parse', 'HEAD').decode().strip() == BASELINE_SHA,
                'Baseline must be the explicitly pinned former app source')
        command('docker', 'info')
        for kind, name in [('container', x) for x in (self.app, self.db, self.frozen)] + [('network', self.net)]:
            existing = subprocess.run(['docker', kind, 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            require(existing.returncode != 0, 'Refusing an existing resource name')
        self.phase = 'build only disposable app images'
        for source, image in [(self.baseline, self.old_image), (self.candidate, self.new_image)]:
            command('docker', 'build', '--label', LABEL + '=' + self.owner, '-t', image, str(source / 'docker-app'), timeout=600)
        command('docker', 'pull', 'postgres:16-alpine')
        command('docker', 'network', 'create', '--internal', '--label', LABEL + '=' + self.owner, self.net)
        command('docker', 'run', '-d', '--name', self.db, '--label', LABEL + '=' + self.owner, '--network', self.net,
                '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-e', 'POSTGRES_USER=rehearsal',
                '-e', 'POSTGRES_DB=rehearsal', '-e', 'POSTGRES_PASSWORD=Synthetic-Database-Only', 'postgres:16-alpine')
        command('docker', 'run', '-d', '--name', self.frozen, '--label', LABEL + '=' + self.owner, '--network', 'none',
                '--read-only', '--cap-drop', 'ALL', '--entrypoint', 'sh', 'postgres:16-alpine',
                '-c', 'while :; do sleep 3600; done')
        self.phase = 'start baseline and seed synthetic rows'
        self.start_app(self.old_image)
        require(self.wait_health(), 'Baseline health failed')
        self.sql("""UPDATE app_settings SET value='{"enabled":false}'::jsonb WHERE key='backup';
          INSERT INTO companies(id,name) VALUES('test-company','Synthetic rollback company');
          INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('test-space','test-company','Synthetic LAN','192.0.2.0/24');
          INSERT INTO prefixes(id,space_id,cidr,name,color) VALUES('test-prefix','test-space','192.0.2.0/25','Legacy white','#ffffff');
          INSERT INTO hosts(id,space_id,ip,name,mac) VALUES('test-host','test-space','192.0.2.7','Synthetic host','02:00:00:00:00:07');
          INSERT INTO users(id,username,password_hash,role) VALUES('test-reader','synthetic-reader','not-a-real-password-hash','viewer');
          INSERT INTO user_space_access(user_id,space_id) VALUES('test-reader','test-space');
          INSERT INTO user_module_access(user_id,module_id) VALUES('test-reader','ipam');
          CREATE TABLE frozen_fixture_guard(id text PRIMARY KEY,payload jsonb NOT NULL);
          INSERT INTO frozen_fixture_guard VALUES('inert-sentinel','{"must":"remain byte-identical","value":42}');""")
        before, old_ledger = self.snapshot(), self.ledger()
        require('core/004-prefix-color-inheritance' not in old_ledger, 'Baseline unexpectedly includes candidate migration')
        self.protected = {n: self.identity(n) for n in (self.db, self.frozen)}
        require(all(v['running'] and v['restarts'] == 0 for v in self.protected.values()), 'Fixture is not stable')
        self.check('baseline running with synthetic data and isolated protected sentinel')
        self.expected_rows, self.expected_ledger = before, old_ledger

        def upgraded_writes():
            require(self.snapshot() == before, 'Upgrade changed legacy fixture rows or grants')
            new_ledger = self.ledger()
            require({k: v for k, v in new_ledger.items() if k != 'core/004-prefix-color-inheritance'} == old_ledger,
                    'Unexpected migration or changed old checksum')
            require(new_ledger.get('core/004-prefix-color-inheritance') == hashlib.sha256(
                (self.candidate / 'docker-app/server/migrations/004-prefix-color-inheritance.sql').read_bytes()).hexdigest(), 'Missing expected migration')
            require(self.sql("SELECT inherit_color_to_children FROM prefixes WHERE id='test-prefix';") == 't', 'Legacy color backfill lost')
            require(self.sql("SELECT column_default FROM information_schema.columns WHERE table_name='prefixes' AND column_name='inherit_color_to_children';") == 'false', 'New prefix default is not OFF')
            self.assert_protected()
            self.check('candidate healthy; complete runtime files and served Import asset match; additive upgrade preserves data')
            self.sql("""INSERT INTO prefixes(id,space_id,cidr,name,color)
              VALUES('new-prefix','test-space','192.0.2.128/26','Created after upgrade','#ffffff');
              UPDATE prefixes SET inherit_color_to_children=false WHERE id='test-prefix';
              INSERT INTO hosts(id,space_id,ip,name) VALUES('new-host','test-space','192.0.2.8','Created after upgrade');""")
            self.expected_rows, self.expected_ledger = self.snapshot(), new_ledger
            self.expect_colors_off = True
            require(self.preserved_data(), 'New default or saved opt-out failed')

        self.transition_case('candidate-health-failure', 'rolled_back', on_candidate=upgraded_writes)
        self.transition_case('stale-backup-blocked', 'blocked', skip_backup=True)
        self.transition_case('candidate-creation-failure', 'rolled_back')
        for fault, failed_check in (
            ('rollback-command-failure', 'restore-baseline'),
            ('rollback-unhealthy', 'rollback-health'),
            ('rollback-wrong-image', 'rollback-identity'),
            ('rollback-wrong-config', 'rollback-identity'),
            ('protected-inspection-failure', 'protected-after-rollback'),
        ):
            self.transition_case(fault, 'rollback_failed', failed_check=failed_check)
        self.transition_case('successful-apply', 'applied')
        require(self.identity(self.app)['image'] == self.owned('image', self.new_image)['Id'], 'Successful candidate not installed in fixture')
        # The current baseline is now the new image, not the historical pinned old one.
        self.transition_case('repeat-candidate-health-failure', 'rolled_back')
        require(self.identity(self.app)['image'] == self.owned('image', self.new_image)['Id'], 'Repeated rollback did not retain current fixture baseline')
        self.assert_protected()
        self.report['protected_identity_unchanged'] = True
        self.report['data_preserved'] = True
        self.check('all transition cases preserve acknowledged writes, color choices and protected identities without DB restore')
        self.report['status'] = 'passed'

    def transition_case(self, fault, expected, on_candidate=None, failed_check=None, skip_backup=False):
        if not skip_backup:
            self.prepare_backup(fault)
        self.phase = 'transition: ' + fault
        adapter = RehearsalTransitionAdapter(self, fault, on_candidate)
        baseline = adapter.capture_baseline()
        app_identity = self.identity(self.app)
        try:
            result = execute_app_transition(adapter)
        except TransitionFailure as error:
            result = error.report
        # Persist the actual result even when the test's expected outcome differs.
        self.report['transitions'].append({'case': fault, 'expected': expected, 'result': result})
        require(result['status'] == expected, 'Unexpected transition outcome: ' + fault)
        if expected == 'blocked':
            require(self.identity(self.app) == app_identity and not result['rollback']['attempted'],
                    'Blocked preflight mutated the app')
        if failed_check:
            require(failed_check in [item['phase'] for item in result['rollback']['errors']],
                    'Injected rollback failure was not explicitly detected')
        if expected == 'rolled_back':
            require(self.app_baseline() == baseline, 'Rollback differs from captured current baseline')
            require(all(name in result['checks'] for name in ('rollback-identity', 'rollback-health', 'rollback-data', 'protected-after-rollback')),
                    'Rollback was accepted without all recovery evidence')
        self.assert_protected()
        require(self.preserved_data(), 'Transition changed acknowledged data')
        self.check(fault + ': ' + expected + ' with explicit evidence')
        if expected == 'rollback_failed':
            # Test-harness reset only, AFTER asserting failed recovery. This is
            # never an implicit retry/repair in the controller or a VM operation.
            recovery = RehearsalTransitionAdapter(self)
            require(recovery.restore_baseline(baseline) and recovery.verify_baseline_identity(baseline)
                    and recovery.baseline_healthy() and recovery.verify_preserved_data(), 'Isolated fixture recovery failed')
            self.assert_protected()

    def cleanup(self):
        failures = []
        for kind, names in [('container', [self.app, self.frozen, self.db]), ('network', [self.net]), ('image', [self.new_image, self.old_image])]:
            for name in names:
                try:
                    if subprocess.run(['docker', kind, 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                        continue
                    self.owned(kind, name)
                    args = ['docker', kind, 'rm'] + (['-f', '-v'] if kind == 'container' else []) + [name]
                    command(*args)
                except Exception:
                    failures.append(kind + ':cleanup-failed')
        self.report['cleanup_failures'] = failures
        if failures:
            self.report['status'] = 'failed'
        self.evidence.parent.mkdir(parents=True, exist_ok=True)
        self.evidence.write_text(json.dumps(self.report, indent=2) + '\n')


class RehearsalTransitionAdapter:
    """Disposable owned resources only; deliberately not a VM/Compose adapter."""
    def __init__(self, rehearsal, fault=None, on_candidate=None):
        self.r, self.fault, self.on_candidate = rehearsal, fault, on_candidate
        self.mutated = self.restoring = False

    def capture_baseline(self):
        return self.r.app_baseline()

    def protected_identity(self):
        if self.mutated and self.fault == 'protected-inspection-failure':
            raise RuntimeError('Injected unreadable protected evidence; no protected mutation')
        return {n: self.r.identity(n) for n in (self.r.db, self.r.frozen)}

    def verify_preconditions(self, baseline):
        self.r.assert_protected()
        self.r.owned('image', baseline.image_id)
        self.r.owned('image', self.r.new_image)
        require(self.r.owned('network', self.r.net)['Internal'], 'Fixture network must be internal')
        return (self.r.backup_verified and self.r.backup_state == self.r.current_backup_state()
                and self.r.preserved_data())

    def verify_baseline_identity(self, baseline):
        current = self.r.app_baseline()
        if current != baseline:
            old = self.r.app_configurations[baseline.configuration_sha256]
            new = self.r.app_configurations[current.configuration_sha256]
            changed = [key for key in old if old[key] != new[key]]
            # Field names and order-equivalence only, never values or Env hashes.
            order_only = [key for key in changed if isinstance(old[key], list) and isinstance(new[key], list)
                          and sorted(map(repr, old[key])) == sorted(map(repr, new[key]))]
            self.r.report['baseline_identity_mismatches'].append({'case': self.fault,
                'image_matches': current.image_id == baseline.image_id, 'changed_fields': changed, 'order_only_fields': order_only})
        return current == baseline

    def baseline_healthy(self):
        short = self.restoring and self.fault in ('rollback-command-failure', 'rollback-unhealthy')
        return self.r.wait_health(attempts=3 if short else 45)

    def verify_preserved_data(self):
        return self.r.preserved_data()

    def install_candidate(self):
        self.mutated = True
        self.r.remove_app_if_present()
        if self.fault == 'candidate-creation-failure':
            raise RuntimeError('Injected create failure after removing only the owned app')
        self.r.start_app(self.r.new_image)
        return True

    def verify_candidate(self):
        require(self.r.wait_health(), 'Candidate health failed before injection')
        require(self.r.identity(self.r.app)['image'] == self.r.owned('image', self.r.new_image)['Id'], 'Wrong candidate image')
        self.r.verify_candidate_files()
        if self.on_candidate:
            self.on_candidate()
        if self.fault != 'successful-apply':
            self.r.remove_app()
            self.r.start_app(self.r.new_image, broken=True)
            return self.r.wait_health(attempts=3)
        return True

    def restore_baseline(self, baseline):
        self.restoring = True
        if self.fault == 'rollback-command-failure':
            raise RuntimeError('Injected restore command failure')
        self.r.remove_app_if_present()
        image = self.r.new_image if self.fault == 'rollback-wrong-image' else baseline.image_id
        self.r.start_app(image, broken=self.fault == 'rollback-unhealthy', wrong_config=self.fault == 'rollback-wrong-config')
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    rehearsal = Rehearsal(args.baseline.resolve(), args.candidate.resolve(), args.evidence.resolve())
    try:
        with tempfile.TemporaryDirectory(prefix='ems-rollback-rehearsal-') as temp:
            rehearsal.run(Path(temp))
    except Exception as error:
        rehearsal.report.update(status='failed', failed_phase=rehearsal.phase, error=str(error))
        print('FAIL ' + rehearsal.phase + ': ' + str(error), flush=True)
    finally:
        rehearsal.cleanup()
    return 0 if rehearsal.report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
