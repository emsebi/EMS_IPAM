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

    def snapshot(self, database='rehearsal'):
        # Preserve full rows (including archived values, hashes, IDs and timestamps).
        # Only the explicitly additive IPAM column is excluded from old-row comparison.
        pairs = ','.join("'%s',(SELECT COALESCE(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM "
                         "(SELECT to_jsonb(t)%s AS r FROM %s t) q)" %
                         (table, "-'inherit_color_to_children'" if table == 'prefixes' else '', table)
                         for table in TABLES)
        return json.loads(self.sql('SELECT jsonb_build_object(' + pairs + ');', database))

    def ledger(self, database='rehearsal'):
        return json.loads(self.sql("SELECT jsonb_object_agg(module_id || '/' || version, checksum) FROM schema_migrations;", database))

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

    def start_app(self, image, broken=False):
        args = ['docker', 'run', '-d', '--name', self.app, '--label', LABEL + '=' + self.owner,
                '--network', self.net, '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:size=64m,mode=1777',
                '--tmpfs', '/backups:size=64m,mode=1777', '-e', 'PGHOST=' + self.db,
                '-e', 'PGUSER=rehearsal', '-e', 'PGPASSWORD=Synthetic-Database-Only', '-e', 'PGDATABASE=rehearsal',
                '-e', 'EMS_ADMIN_USERNAME=rehearsal-admin', '-e', 'EMS_ADMIN_PASSWORD=Synthetic-Admin-Only',
                '-e', 'EMS_MODULES_DIR=/empty-modules', '-e', 'BACKUP_DIR=/backups', image]
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
                '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_USER=rehearsal',
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
        self.phase = 'backup and actual restore to a separate database'
        dump = temp / 'baseline.dump'
        dump.write_bytes(command('docker', 'exec', self.db, 'pg_dump', '-Fc', '-U', 'rehearsal', '-d', 'rehearsal'))
        require(dump.stat().st_size > 0, 'Empty backup')
        self.report['backup_sha256'] = hashlib.sha256(dump.read_bytes()).hexdigest()
        command('docker', 'exec', self.db, 'createdb', '-U', 'rehearsal', 'restored')
        command('docker', 'exec', '-i', self.db, 'pg_restore', '--exit-on-error', '-U', 'rehearsal', '-d', 'restored', data=dump.read_bytes())
        require(self.snapshot('restored') == before and self.ledger('restored') == old_ledger, 'Restored data or ledger differs')
        self.assert_protected()
        self.check('backup restored into separate database; complete fixture rows, grants and ledger match')
        self.phase = 'replace only app with candidate'
        self.remove_app()
        self.start_app(self.new_image)
        require(self.wait_health(), 'Candidate health failed')
        self.verify_candidate_files()
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
        after_writes = self.snapshot()
        require(self.sql('SELECT bool_and(NOT inherit_color_to_children) FROM prefixes;') == 't', 'New default or saved opt-out failed')
        self.phase = 'inject unhealthy candidate and automatically roll back app'
        self.remove_app()
        self.start_app(self.new_image, broken=True)
        if self.wait_health(attempts=3):
            raise RuntimeError('Injected health failure was not detected')
        self.remove_app()
        self.start_app(self.old_image)
        require(self.wait_health(), 'App rollback health failed')
        require(self.identity(self.app)['image'] == self.owned('image', self.old_image)['Id'], 'Rollback used wrong image')
        require(self.snapshot() == after_writes and self.ledger() == new_ledger, 'App rollback changed data or migration ledger')
        require(self.sql('SELECT bool_and(NOT inherit_color_to_children) FROM prefixes;') == 't', 'Rollback changed persisted color choices')
        self.assert_protected()
        self.report['protected_identity_unchanged'] = True
        self.report['data_preserved'] = True
        self.check('injected health failure detected; original app healthy again; new writes and color choices retained without DB restore or protected restart')
        self.report['status'] = 'passed'

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
