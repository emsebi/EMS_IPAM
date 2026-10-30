#!/usr/bin/env python3
"""Read-only preflight and row-preservation check for the dedicated EMS lab."""
import argparse
import json
import os
from pathlib import Path
import subprocess

TABLES = ('radius_ops_devices', 'radius_ops_accounts', 'radius_ops_groups',
          'radius_ops_collections', 'radius_ops_access_rules',
          'radius_ops_collection_devices', 'radius_ops_secret_profiles',
          'radcheck', 'radreply', 'radgroupreply', 'radusergroup', 'nas')


def query(sql):
    result = subprocess.run([
        'docker', 'exec', '-i', 'ems-ipam-db-1', 'sh', '-c',
        'exec psql -X -A -t -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    ], input="BEGIN READ ONLY; SET LOCAL statement_timeout='30s';\n" + sql + '\nROLLBACK;\n',
        text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError('Installed database compatibility check failed: ' + result.stderr[-1500:])
    return result.stdout.strip()


def fingerprint():
    # Credential contents stay inside PostgreSQL; only aggregate fingerprints
    # reach the private checkpoint file, never the job log.
    rows = [f"SELECT '{t}' AS name, count(*) AS rows, md5(coalesce(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM {t} r" for t in TABLES]
    return json.loads(query('SELECT json_agg(x ORDER BY name) FROM (' + ' UNION ALL '.join(rows) + ') x;'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--snapshot', type=Path)
    group.add_argument('--compare', type=Path)
    args = parser.parse_args()
    applied = query("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE module_id='radius-ops' AND version='013-collections-without-company');") == 't'
    if not applied:
        sql = (Path(__file__).resolve().parents[1] / 'modules/radius-ops/migrations/013-collections-without-company.sql').read_text()
        query(sql.split('\nALTER TABLE', 1)[0])
    if args.compare:
        if not applied:
            raise RuntimeError('RADIUS migration 013 was not applied; health alone is insufficient')
        if fingerprint() != json.loads(args.compare.read_text()):
            raise RuntimeError('RADIUS rows changed during upgrade; inspect the private database backup')
        print('PASS migration 013 applied; existing RADIUS records, credentials and assignments unchanged')
    elif args.snapshot:
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(args.snapshot, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as out:
            json.dump(fingerprint(), out)
        print('PASS legacy compatibility; private RADIUS preservation checkpoint saved')
    else:
        print('PASS installed RADIUS compatibility preflight (read only)')


if __name__ == '__main__':
    main()
