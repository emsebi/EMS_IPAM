#!/usr/bin/env python3
"""Probe installed replies; never print or replace existing credentials.

An explicitly requested temporary fixture is limited to a fresh loopback /32.
Its records are removed in finally and existing configuration is fingerprinted.
"""
import argparse
import contextlib
import json
from pathlib import Path
import secrets
import signal
import subprocess
import uuid


def db(args, sql):
    result = subprocess.run(['docker','exec','-i',args.db_container,'sh','-c',
        'exec psql -X -A -t -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        input=sql, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Installed reply check database operation failed; credentials were not printed')
    return result.stdout.strip()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def fingerprint(args):
    tables = ('radius_ops_devices','radius_ops_accounts','radius_ops_groups',
              'radius_ops_collections','radius_ops_collection_devices',
              'radius_ops_access_rules','radius_ops_secret_profiles',
              'radcheck','radreply','radgroupreply','radusergroup','nas')
    rows = [f"SELECT '{t}' AS name, md5(coalesce(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY to_jsonb(r)::text),'')) AS digest FROM {t} r" for t in tables]
    return db(args, 'BEGIN READ ONLY; SELECT json_agg(x ORDER BY name) FROM ('+' UNION ALL '.join(rows)+') x; ROLLBACK;')


@contextlib.contextmanager
def temporary_fixture(args):
    before = fingerprint(args)
    key = str(uuid.uuid4())
    name = 'ems_probe_' + key.replace('-', '')
    shortname = 'ems_' + key.replace('-', '')
    source = '127.253.' + str(1+secrets.randbelow(253)) + '.' + str(1+secrets.randbelow(253))
    secret, password = secrets.token_hex(32), secrets.token_hex(24)
    # The same isolated fixture works before migration 013. No Company is
    # created, changed or reactivated, and every legacy link uses the same ID.
    company = "(SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY id LIMIT 1)"
    v = literal
    cleanup = f"""BEGIN;
DELETE FROM radcheck WHERE username={v(name)};
DELETE FROM radius_ops_accounts WHERE id={v(key)};
DELETE FROM radius_ops_collections WHERE id={v(key)};
DELETE FROM nas WHERE shortname={v(shortname)};
DELETE FROM radius_ops_devices WHERE id={v(key)};
DELETE FROM radius_ops_groups WHERE id={v(key)};
DELETE FROM radius_ops_secret_profiles WHERE id={v(key)};
COMMIT;"""
    try:
        db(args, f"""BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM radius_ops_devices WHERE nas_ip={v(source)}::inet)
OR EXISTS(SELECT 1 FROM nas WHERE nasname={v(source)})
THEN RAISE EXCEPTION 'Loopback fixture address already exists'; END IF; END $$;
INSERT INTO radius_ops_secret_profiles(id,company_id,name,secret) VALUES({v(key)},{company},{v(name)},{v(secret)});
INSERT INTO radius_ops_groups(id,company_id,name,cisco_privilege,mikrotik_group) VALUES({v(key)},{company},{v(name)},15,'full');
INSERT INTO radius_ops_collections(id,company_id,name) VALUES({v(key)},{company},{v(name)});
INSERT INTO radius_ops_devices(id,company_id,nas_ip,label,vendor,secret,secret_profile_id) VALUES({v(key)},{company},{v(source)},{v(name)},'other',{v(secret)},{v(key)});
INSERT INTO radius_ops_collection_devices(id,collection_id,device_id) VALUES({v(key)},{v(key)},{v(key)});
INSERT INTO radius_ops_accounts(id,company_id,username,label,vendor) VALUES({v(key)},{company},{v(name)},{v(name)},'generic');
INSERT INTO radius_ops_access_rules(id,account_id,collection_id,profile_id) VALUES({v(key)},{v(key)},{v(key)},{v(key)});
INSERT INTO radcheck(username,attribute,op,value) VALUES({v(name)},'Cleartext-Password',':=',{v(password)});
INSERT INTO nas(nasname,shortname,type,secret,description) VALUES({v(source)},{v(shortname)},'other',{v(secret)},'Temporary loopback reply check');
COMMIT;""")
        yield {'username':name,'password':password,'secret':secret,'group':'full','privilege':15,'source':source}
    finally:
        db(args, cleanup)
        if fingerprint(args) != before:
            raise RuntimeError('Installed configuration changed during the probe; inspect the private backup')
        print('PASS temporary loopback fixture removed; existing configuration and credentials unchanged')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-signed', action='store_true')
    parser.add_argument('--temporary-loopback-fixture', action='store_true')
    parser.add_argument('--db-container', default='ems-ipam-db-1')
    parser.add_argument('--radius-container', default='ems-ipam-radius_ops-1')
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise RuntimeError('Installed reply check interrupted; removing its temporary fixture')
    signal.signal(signal.SIGTERM, interrupted)
    if args.temporary_loopback_fixture:
        with temporary_fixture(args) as fixture:
            verify(args, fixture)
        return
    sql = """BEGIN READ ONLY;
SELECT json_build_object('username',a.username,'password',rc.value,'secret',ns.secret,
 'group',r.mikrotik_group,'privilege',r.cisco_privilege)
FROM radius_ops_resolve_nas('127.0.0.1'::inet) n
JOIN nas ns ON ns.shortname='ems_'||replace(n.device_id::text,'-','')
JOIN radius_ops_accounts a ON a.enabled
JOIN radcheck rc ON rc.username=a.username AND rc.attribute='Cleartext-Password'
JOIN LATERAL radius_ops_resolve_access(a.username,'127.0.0.1'::inet) r ON true
WHERE n.active ORDER BY (a.username='rr') DESC,a.username LIMIT 1;
ROLLBACK;"""
    result = db(args, sql)
    if not result:
        print('INSTALLED_REPLY_CHECK no existing loopback-authorized account; no configuration changed')
        if args.require_signed:
            raise RuntimeError('Cannot verify installed replies without an existing loopback-authorized account')
        return
    verify(args, json.loads(result))


def verify(args, fixture):
    probe_source = (Path(__file__).resolve().parents[1]/'modules/radius-ops/freeradius/udp_probe.py').read_text()
    code = 'namespace={"__name__":"installed_probe"};exec('+repr(probe_source)+',namespace)\n'+r'''
import json,sys,socket,struct,time
f=json.load(sys.stdin)
secret=f['secret'].encode()
source=f.get('source','127.0.0.1')
packet,request_auth=namespace['request_packet'](f['username'],f['password'],secret,source,23)
report={}
try:
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
  s.bind((source,0));s.settimeout(3)
  deadline=time.monotonic()+45
  while True:
   s.sendto(packet,('127.0.0.1',1812))
   try:
    reply,peer=s.recvfrom(4096)
    # Allow the NAS reload supervisor to pick up a new loopback /32.
    namespace['verify_response'](reply,request_auth,secret,23,require_message_authenticator=False)
    break
   except (OSError,ValueError):
    if time.monotonic()>=deadline:raise
    time.sleep(1)
 if peer!=('127.0.0.1',1812):raise ValueError('unexpected peer')
 report['response']=namespace['verify_response'](reply,request_auth,secret,23,require_message_authenticator=False)
 report['response_authenticator_valid']=True
 try:
  namespace['verify_response'](reply,request_auth,secret,23)
  report['required_message_authenticator_valid']=True
 except ValueError:
  report['required_message_authenticator_valid']=False
 found={};offset=20
 while offset<len(reply):
  kind,size=reply[offset],reply[offset+1];value=reply[offset+2:offset+size]
  if kind==26 and len(value)>=6:
   vendor=struct.unpack('!I',value[:4])[0];sub=4
   while sub<len(value):
    length=value[sub+1]
    if length<2 or sub+length>len(value):raise ValueError('bad vendor attribute')
    found.setdefault((vendor,value[sub]),[]).append(value[sub+2:sub+length]);sub+=length
  offset+=size
 report['assigned_permissions_match']=(found.get((14988,3))==[f['group'].encode()] and found.get((9,1))==[('shell:priv-lvl='+str(f['privilege'])).encode()])
except (OSError,ValueError):
 report={'probe_failed':True}
print(json.dumps(report))
'''
    check = subprocess.run(['docker','exec','-i',args.radius_container,'python3','-c',code],
        input=json.dumps(fixture), text=True, capture_output=True, timeout=65)
    if check.returncode:
        raise RuntimeError('Installed reply probe could not execute; credentials were not printed')
    report = json.loads(check.stdout)
    print('INSTALLED_REPLY_CHECK '+json.dumps(report,sort_keys=True))
    if args.require_signed and not (report.get('response')=='Access-Accept' and
            report.get('required_message_authenticator_valid') and report.get('assigned_permissions_match')):
        raise RuntimeError('Installed RADIUS reply failed signature or permission verification')


if __name__ == '__main__':
    main()
