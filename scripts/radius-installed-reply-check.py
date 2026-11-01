#!/usr/bin/env python3
"""One loopback authentication probe; never print or change installed credentials."""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-signed', action='store_true')
    args = parser.parse_args()
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
    result = subprocess.run(['docker','exec','-i','ems-ipam-db-1','sh','-c',
        'exec psql -X -A -t -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        input=sql, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Installed reply check could not read its private fixture')
    if not result.stdout.strip():
        print('INSTALLED_REPLY_CHECK no existing loopback-authorized account; no configuration changed')
        if args.require_signed:
            raise RuntimeError('Cannot verify installed replies without an existing loopback-authorized account')
        return
    fixture = json.loads(result.stdout)
    probe_source = (Path(__file__).resolve().parents[1]/'modules/radius-ops/freeradius/udp_probe.py').read_text()
    code = 'namespace={"__name__":"installed_probe"};exec('+repr(probe_source)+',namespace)\n'+r'''
import json,sys,socket,struct
f=json.load(sys.stdin)
secret=f['secret'].encode()
packet,request_auth=namespace['request_packet'](f['username'],f['password'],secret,'127.0.0.1',23)
report={}
try:
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
  s.bind(('127.0.0.1',0));s.settimeout(4);s.sendto(packet,('127.0.0.1',1812));reply,peer=s.recvfrom(4096)
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
    check = subprocess.run(['docker','exec','-i','ems-ipam-radius_ops-1','python3','-c',code],
        input=json.dumps(fixture), text=True, capture_output=True, timeout=20)
    if check.returncode:
        raise RuntimeError('Installed reply probe could not execute; credentials were not printed')
    report = json.loads(check.stdout)
    print('INSTALLED_REPLY_CHECK '+json.dumps(report,sort_keys=True))
    if args.require_signed and not (report.get('response')=='Access-Accept' and
            report.get('required_message_authenticator_valid') and report.get('assigned_permissions_match')):
        raise RuntimeError('Installed RADIUS reply failed signature or permission verification')


if __name__ == '__main__':
    main()
