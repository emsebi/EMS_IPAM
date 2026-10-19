#!/usr/bin/env python3
"""Real Docker/PostgreSQL/FreeRADIUS integration smoke test.

Only runs against a disposable Compose project. Never changes live NAS,
credentials, production networks, Docker volumes or the host's EMS installation.
"""
import contextlib
import http.cookiejar
import json
import os
import re
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FRAGMENT = ROOT / 'modules/radius-ops/compose.module.yml'


def parsed_radtest_reply(output):
    """Require one UDP reply from the expected loopback server and request ID.

    The prior prefix-only parser accepted a fabricated `Received Access-Accept`
    line even when no Access-Request had been sent.  Check both packet IDs and
    the peer address/port reported by radclient, not a mere diagnostic string.
    Retransmissions with the same request ID are permitted.
    """
    requests = re.findall(r'(?m)^Sent Access-Request Id ([0-9]{1,3})\b', output)
    replies = re.findall(
        r'(?m)^Received (Access-Accept|Access-Reject|Access-Challenge) '
        r'Id ([0-9]{1,3}) from 127\.0\.0\.1:1812(?:\s|$)', output)
    if len(replies) != 1 or not requests:
        return None
    kind, response_id = replies[0]
    if any(int(request_id) > 255 for request_id in requests) or int(response_id) > 255:
        return None
    if any(request_id != response_id for request_id in requests):
        return None
    return kind


def port(protocol):
    kind = socket.SOCK_DGRAM if protocol == 'udp' else socket.SOCK_STREAM
    with socket.socket(socket.AF_INET, kind) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def distinct_udp_ports(count=2):
    """Choose distinct host UDP ports while all candidate sockets are bound.

    Consecutive bind(0)/close() calls can return the SAME ephemeral port;
    that creates duplicate Docker Compose port mappings and a false CI failure.
    The sockets are held until the entire set is allocated, then released.
    """
    if not 1 <= count <= 10:
        raise ValueError('Invalid UDP port count')
    sockets = []
    try:
        for _ in range(count):
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sockets.append(sock)
            sock.bind(('127.0.0.1', 0))
        return tuple(sock.getsockname()[1] for sock in sockets)
    finally:
        for sock in sockets:
            sock.close()


def run(command, *, env=None, timeout=180, check=True):
    try:
        r = subprocess.run(command, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        # TimeoutExpired.__str__ includes the entire command, including
        # disposable shared secrets and passwords passed to radtest.
        if not check:
            return subprocess.CompletedProcess([command[0]], 124, stdout='', stderr='')
        raise RuntimeError(f'{os.path.basename(command[0])} timed out after {timeout}s') from None
    if check and r.returncode:
        # Docker/psql stderr can contain credentials or SQL.  Never put raw
        # subprocess output, arguments or environment into CI exceptions.
        executable = os.path.basename(command[0])
        raise RuntimeError(f'{executable} failed (exit={r.returncode}); inspect protected runner logs locally')
    return r


def main():
    if not FRAGMENT.is_file():
        raise RuntimeError('Missing RADIUS module Compose fragment')
    run(['docker', 'info'], timeout=15)
    run(['docker', 'compose', 'version'], timeout=15)
    with tempfile.TemporaryDirectory(prefix='ems-radius-real-') as temp:
        ident = secrets.token_hex(4)
        project = f'emsradius{ident}'
        secret_a, secret_b = secrets.token_hex(22), secrets.token_hex(22)
        password_a, password_b = secrets.token_hex(18), secrets.token_hex(18)
        auth_port, acct_port = distinct_udp_ports()
        env = os.environ.copy()
        env.update({
            'POSTGRES_DB': 'ems_ipam_test', 'POSTGRES_USER': 'ems_ipam_test',
            'POSTGRES_PASSWORD': secrets.token_hex(22),
            'EMS_ADMIN_USERNAME': 'radius-test-admin',
            'EMS_ADMIN_PASSWORD': secrets.token_hex(18),
            'EMS_HTTP_PORT': str(port('tcp')),
            'EMS_RADIUS_AUTH_PORT': str(auth_port),
            'EMS_RADIUS_ACCT_PORT': str(acct_port),
            'EMS_RADIUS_BIND': '127.0.0.1',
            'EMS_STATE_DIR': temp, 'EMS_BACKUP_PATH': temp + '/backups',
            'EMS_DB_VOLUME_NAME': project + '-db',
            'EMS_NETWORK_NAME': project + '-network',
            'COOKIE_SECURE': 'false',
        })
        # Docker runs the Core application as UID 1000, not the CI runner.
        # mkdir(mode=0o777) is restricted by the host umask; chmod explicitly.
        Path(temp, 'backups').mkdir(mode=0o777)
        Path(temp, 'backups').chmod(0o777)
        compose = ['docker', 'compose', '-p', project, '-f', str(ROOT/'compose.yml'), '-f', str(FRAGMENT)]

        def dc(*args, timeout=180, check=True):
            return run(compose + list(args), env=env, timeout=timeout, check=check)

        def sql(query):
            return dc('exec', '-T', 'db', 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                      '-U', env['POSTGRES_USER'], '-d', env['POSTGRES_DB'], '-c', query).stdout.strip()

        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        base = f'http://127.0.0.1:{env["EMS_HTTP_PORT"]}'

        def api(route, method='GET', body=None):
            req = urllib.request.Request(base + route, method=method,
                data=json.dumps(body).encode() if body is not None else None,
                headers={'Content-Type': 'application/json', 'X-EMS-CSRF': '1'})
            with opener.open(req, timeout=15) as response:
                result = json.load(response)
            if not result.get('ok'):
                raise AssertionError(f'API failed: {route}')
            return result

        def wait(predicate, label, seconds=90):
            end = time.monotonic() + seconds
            last_error = None
            while time.monotonic() < end:
                try:
                    if predicate():
                        print('PASS', label, flush=True)
                        return
                except (OSError, ValueError, AssertionError, urllib.error.URLError) as exc:
                    # The app can be running before its optional migration and
                    # readiness probes have completed. Retry transient failures.
                    # Never print exception contents (they may contain secrets).
                    last_error = type(exc).__name__
                time.sleep(2)
            suffix = f' (last error type: {last_error})' if last_error else ''
            raise AssertionError(f'Timeout: {label}{suffix}')

        def nas_udp(source, claimed, username, password, shared_secret, expected,
                    nas_identifier='', calling_station_id='', framed_ip=''):
            # The socket is bound to the *actual* NAS source, not merely the
            # NAS-IP-Address attribute. All traffic remains in the disposable
            # radius_ops container on the 127/8 loopback interface.
            args=['exec','-T','radius_ops','python3','/opt/ems-radius/udp_probe.py',
                  '--source',source,'--claimed',claimed,'--username',username,
                  '--password',password,'--secret',shared_secret]
            if nas_identifier: args += ['--nas-identifier',nas_identifier]
            if calling_station_id: args += ['--calling-station-id',calling_station_id]
            if framed_ip: args += ['--framed-ip',framed_ip]
            r = dc(*args, timeout=30, check=False)
            return r.returncode == 0 and r.stdout.strip() == expected

        radtest_diag = {}
        def radtest(username, password, shared_secret, expected):
            # Test-only secrets are never printed. Emit only protocol-level
            # diagnostics so a failed lab run distinguishes Reject from timeout.
            r = dc('exec', '-T', 'radius_ops', 'radtest', username, password,
                   '127.0.0.1', '0', shared_secret, timeout=30, check=False)
            output = r.stdout + r.stderr
            actual = parsed_radtest_reply(output)
            if actual != expected:
                sent = bool(re.search(r'(?m)^Sent Access-Request Id ', output))
                received = bool(re.search(r'(?m)^Received Access-', output))
                timeout = ('no response' in output.lower() or 'timeout' in output.lower()
                           or (sent and not received))
                key = (username, expected, actual, sent, received, timeout)
                if key not in radtest_diag:
                    radtest_diag[key] = True
                    print('RADIUS PROBE mismatch'
                          f' user={username} expected={expected} actual={actual or "NONE"}'
                          f' sent={sent} received={received} timeout={timeout}'
                          f' exit={r.returncode}', flush=True)
            return actual == expected

        try:
            dc('config', '--quiet', timeout=30)
            dc('build', 'app', 'radius_ops', timeout=600)
            dc('up', '-d', '--wait', 'db', 'app', timeout=300)
            wait(lambda: api('/health')['ok'], 'Core API healthy')
            api('/api/auth/login', 'POST', {'username': env['EMS_ADMIN_USERNAME'],
                                             'password': env['EMS_ADMIN_PASSWORD']})
            print('PASS authenticated admin login')
            # Synthetic data in a disposable database only; never user data.
            sql("""INSERT INTO companies(id,name) VALUES
                 ('lab-company-a','Lab Company A'),('lab-company-b','Lab Company B');
                 INSERT INTO address_spaces(id,company_id,name,cidr) VALUES
                 ('lab-space-a','lab-company-a','Lab A','127.0.0.0/8'),
                 ('lab-space-b','lab-company-b','Lab B','127.0.0.0/8');
                 INSERT INTO hosts(id,space_id,ip,name) VALUES
                 ('lab-host-a','lab-space-a','127.0.0.1','Lab NAS A'),
                 ('lab-host-b','lab-space-b','127.0.0.2','Lab NAS B');""")
            count = sql("SELECT count(*) FROM schema_migrations WHERE module_id='radius-ops'")
            assert count == '12', f'Expected twelve versioned migrations, found {count}'
            print('PASS PostgreSQL migrations 001-012')
            inventory = api('/api/radius-ops/inventory')['items']
            assert {x['id'] for x in inventory} >= {'lab-host-a', 'lab-host-b'}
            assert all('vendor' in x for x in inventory)
            print('PASS real IPAM inventory endpoint and host type compatibility')
            # Exercise both supported client flows: a legacy NAS linked to
            # inventory and the simple v23 direct CIDR flow with no IPAM host.
            nas_a = api('/api/radius-ops/devices', 'POST', {
                'hostId':'lab-host-a','companyId':'lab-company-a',
                'label':'Lab NAS A','vendor':'cisco-legacy',
                'nasIp':'127.0.0.1','secret':secret_a,'enabled':True})['id']
            nas_b = api('/api/radius-ops/devices', 'POST', {
                'hostId':None,'companyId':'lab-company-b',
                'label':'Lab NAS B Range','vendor':'cisco-ios',
                'nasIp':'127.10.20.99/24','secret':secret_b,'enabled':True})['id']
            devices = api('/api/radius-ops/devices')['items']
            direct_b = next(x for x in devices if x['id'] == nas_b)
            assert direct_b['hostId'] is None
            assert direct_b['nasIp'] == '127.10.20.0/24'
            assert 'secret' not in direct_b
            print('PASS direct single-IP and CIDR NAS registration with write-only secrets')
            fallback_secret = secrets.token_hex(22)
            fallback_nas = api('/api/radius-ops/devices', 'POST', {
                'hostId':None,'companyId':'lab-company-a',
                'label':'Dynamic Branch Fallback','nasIp':'0.0.0.0/0',
                'secret':fallback_secret,'enabled':True})['id']
            assert sql("SELECT count(*) FROM radius_ops_devices WHERE nas_ip='0.0.0.0/0'::inet") == '1'
            assert sql("SELECT count(*) FROM radius_ops_secret_profiles p JOIN radius_ops_devices d ON d.secret_profile_id=p.id WHERE d.id='"+fallback_nas+"'") == '1'
            print('PASS reusable secret profile and overlapping /0 NAS registration')

            collection_a = api('/api/radius-ops/collections', 'POST', {
                'companyId':'lab-company-a','name':'Main Routers',
                'description':'Named NAS group, no raw CIDR scope','enabled':True})['id']
            # Assign membership from the NAS object itself.
            api('/api/radius-ops/devices/'+nas_a, 'PUT', {
                'hostId':'lab-host-a','companyId':'lab-company-a',
                'label':'Lab NAS A','vendor':'cisco-legacy','nasIp':'127.0.0.1',
                'secretProfileId':next(x['secretProfileId'] for x in api('/api/radius-ops/devices')['items'] if x['id']==nas_a),
                'collectionIds':[collection_a],'enabled':True})
            cols = api('/api/radius-ops/collections')['items']
            main_col = next(x for x in cols if x['id'] == collection_a)
            assert [m['id'] for m in main_col['members']] == [nas_a]
            assert main_col['members'][0]['nasIp'] == '127.0.0.1'
            assert sql(f"SELECT count(*) FROM radius_ops_collection_devices WHERE collection_id='{collection_a}' AND device_id='{nas_a}'") == '1'
            print('PASS named NAS Collection membership is assigned from the NAS object')

            group_a = api('/api/radius-ops/groups', 'POST', {
                'companyId':'lab-company-a','name':'Network Admin A',
                'description':'Lab Cisco/MikroTik administrators',
                'ciscoPrivilege':15,'mikrotikGroup':'full','enabled':True})['id']
            group_b = api('/api/radius-ops/groups', 'POST', {
                'companyId':'lab-company-b','name':'Network Read B',
                'description':'Lab read-only administrators',
                'ciscoPrivilege':1,'mikrotikGroup':'read','enabled':True})['id']
            api('/api/radius-ops/accounts', 'POST', {
                'companyId':'lab-company-a','username':'testadminA','label':'Admin A',
                'groupId':group_a,'password':password_a,'enabled':True})
            api('/api/radius-ops/accounts', 'POST', {
                'companyId':'lab-company-b','username':'testadminB','label':'Admin B',
                'groupId':group_b,'password':password_b,'enabled':True})
            accounts = api('/api/radius-ops/accounts')['items']
            assert all('password' not in item for item in accounts)
            group_name_a = 'emsgrp_' + group_a.replace('-', '')
            group_name_b = 'emsgrp_' + group_b.replace('-', '')
            assert sql(f"SELECT count(*) FROM radgroupreply WHERE groupname='{group_name_a}' AND attribute='Cisco-AVPair' AND value='shell:priv-lvl=15'") == '1'
            assert sql(f"SELECT count(*) FROM radgroupreply WHERE groupname='{group_name_a}' AND attribute='Mikrotik-Group' AND value='full'") == '1'
            assert sql(f"SELECT count(*) FROM radgroupreply WHERE groupname='{group_name_b}' AND attribute='Cisco-AVPair' AND value='shell:priv-lvl=1'") == '1'
            # v24 keeps profile reply templates in radgroupreply, but device-admin
            # authorization is selected dynamically by NAS Collection.  Static
            # radusergroup membership would leak one privilege level to every NAS.
            assert sql("SELECT count(*) FROM radusergroup WHERE username IN ('testadminA','testadminB')") == '0'
            assert sql(f"SELECT count(*) FROM radius_ops_access_rules ar JOIN radius_ops_accounts a ON a.id=ar.account_id WHERE a.username='testadminA' AND ar.profile_id='{group_a}'") == '1'
            assert sql(f"SELECT count(*) FROM radius_ops_access_rules ar JOIN radius_ops_accounts a ON a.id=ar.account_id WHERE a.username='testadminB' AND ar.profile_id='{group_b}'") == '1'
            assert sql("SELECT collection_name FROM radius_ops_resolve_access('testadminA','127.0.0.1'::inet)") == 'All registered NAS'
            print('PASS Permission Profiles and per-NAS access rules sync to FreeRADIUS SQL policy')

            api('/api/radius-ops/macs', 'POST', {
                'companyId':'lab-company-a','mac':'02:aa:bb:cc:dd:ee',
                'label':'Test station','vlan':30,'enabled':True})
            print('PASS authenticated NAS/Group/User/MAB API CRUD')
            # Browser coverage is optional for the first real-runtime pass;
            # the dedicated browser job can enable it after RADIUS is healthy.
            if os.environ.get('EMS_RADIUS_SKIP_BROWSER') == '1':
                print('SKIP real-backend Chromium (EMS_RADIUS_SKIP_BROWSER=1)')
            else:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as browser_tools:
                    browser = browser_tools.chromium.launch(headless=True)
                    for width, height in ((1440, 900), (390, 844)):
                        context = browser.new_context(viewport={'width': width, 'height': height})
                        context.add_cookies([{'name': cookie.name, 'value': cookie.value, 'url': base}
                                             for cookie in jar])
                        page = context.new_page()
                        page.goto(base + '/module/radius', wait_until='domcontentloaded')
                        page.get_by_role('button', name='Clients / NAS').wait_for(timeout=15000)
                        assert 'Lab NAS A' in page.locator('main').inner_text()
                        assert 'Lab NAS B Range' in page.locator('main').inner_text()
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 5')
                        context.close()
                    browser.close()
                print('PASS real-backend Chromium desktop/mobile simple RADIUS UI')
            dc('up', '-d', '--wait', 'radius_ops', timeout=300)
            wait(lambda: api('/api/radius-ops/health').get('running'), 'FreeRADIUS daemon stable')
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 't'
            # The explicit company-A /0 fallback intentionally covers sources
            # not claimed by a more-specific NAS. A /24 for company B must win
            # over it and preserve tenant isolation.
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.2'::inet)") == 't'
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.10.20.2'::inet)") == 'f'
            assert sql("SELECT radius_ops_identity_allowed('02:aa:bb:cc:dd:ee','127.0.0.2'::inet)") == 't'
            assert sql("SELECT radius_ops_identity_allowed('02:aa:bb:cc:dd:ee','127.10.20.2'::inet)") == 'f'
            assert sql("SELECT radius_ops_identity_allowed('02:aa:bb:cc:dd:ee','127.0.0.1'::inet)") == 't'
            print('PASS SQL /0 fallback, longest-prefix company isolation and MAB policy')
            # Verify the same tenant decision is exposed through the authenticated
            # UI API, without transmitting passwords or sending test packets.
            for identity, nas_ip, expected in (
                ('testadminA', '127.0.0.1', True),
                ('testadminA', '127.10.20.2', False),
                ('02:aa:bb:cc:dd:ee', '127.0.0.1', True),
                ('02:aa:bb:cc:dd:ee', '127.10.20.2', False),
                ('unknownUser', '127.0.0.1', False),
            ):
                check = api('/api/radius-ops/precheck', 'POST',
                            {'identity': identity, 'nasIp': nas_ip})
                assert check['allowed'] is expected
                assert check['udpTested'] is False
            print('PASS real SQL policy precheck and company isolation')

            wait(lambda: radtest('testadminA',password_a,secret_a,'Access-Accept'),
                 'UDP Access-Accept from registered NAS', seconds=35)
            assert not radtest('testadminA',password_a,fallback_secret,'Access-Accept'), 'Specific /32 secret must override /0 fallback'
            assert nas_udp('127.20.0.2','127.20.0.2','testadminA',password_a,fallback_secret,'Access-Accept')
            print('PASS longest-prefix NAS secret selection (/32 overrides /0 fallback)')
            live = api('/api/radius-ops/live/start', 'POST', {})
            live_token = live['token']
            bad_password = 'definitely-wrong-password'
            assert nas_udp('127.0.0.1','127.0.0.1','testadminA',bad_password,
                           secret_a,'Access-Reject',
                           nas_identifier='LAB-NAS-A',
                           calling_station_id='127.0.0.44',
                           framed_ip='127.0.0.44')
            live_event = None
            end = time.monotonic() + 10
            while time.monotonic() < end:
                snap = api('/api/radius-ops/live/events', 'POST',
                           {'token':live_token,'after':0})
                for item in snap.get('items', []):
                    if (item.get('type') == 'authentication'
                            and item.get('username') == 'testadminA'
                            and item.get('result') == 'REJECT'):
                        live_event = item
                        break
                if live_event:
                    break
                time.sleep(.25)
            api('/api/radius-ops/live/stop', 'POST', {'token':live_token})
            assert live_event, 'Live log must capture the rejected authentication'
            assert 'attemptedPassword' not in live_event
            assert 'passwordAvailable' not in live_event
            assert bad_password not in json.dumps(snap)
            assert live_event.get('sourceIp') == '127.0.0.1'
            assert live_event.get('nasIdentifier') == 'LAB-NAS-A'
            assert live_event.get('callingStationId') == '127.0.0.44'
            assert live_event.get('framedIpAddress') == '127.0.0.44'
            assert live_event.get('deviceLabel') == 'Lab NAS A'
            print('PASS live log captures NAS metadata without attempted passwords')
            assert radtest('testadminB',password_b,secret_a,'Access-Reject')
            print('PASS cross-company credentials rejected by the real RADIUS listener')
            # Real UDP packets from NAS B (127.0.0.2), including a spoofed
            # NAS-IP-Address of NAS A. This tests Packet-Src-IP-Address
            # isolation at the network layer, not just a SQL function call.
            assert nas_udp('127.10.20.2', '127.10.20.2', 'testadminB',
                           password_b, secret_b, 'Access-Accept')
            assert nas_udp('127.10.20.2', '127.10.20.2', 'testadminA',
                           password_a, secret_b, 'Access-Reject')
            assert nas_udp('127.10.20.2', '127.0.0.1', 'testadminA',
                           password_a, secret_b, 'Access-Reject')
            assert nas_udp('127.0.0.1', '127.0.0.2', 'testadminA',
                           password_a, secret_a, 'Access-Accept')
            print('PASS two real UDP NAS sources and spoofed NAS-IP-Address isolation')
            wait(lambda: radtest('02:aa:bb:cc:dd:ee','02:aa:bb:cc:dd:ee',secret_a,'Access-Accept'),
                 'MAB allowed MAC authenticates through UDP', seconds=35)
            wait(lambda: sql("SELECT count(*) FROM radpostauth WHERE username='testadminA' AND sourceipaddress='127.0.0.1' AND pass=''") != '0',
                 'Authentication audit uses packet source and stores no password', seconds=20)
            # Archive IPAM host: NAS must fail closed even if SQL client is still cached.
            sql("UPDATE hosts SET deleted_at=now() WHERE id='lab-host-a'")
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 'f'
            assert radtest('testadminA', password_a, secret_a, 'Access-Reject'), 'Archived host must deny real UDP'
            sql("UPDATE hosts SET deleted_at=NULL WHERE id='lab-host-a'")
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 't'
            wait(lambda: radtest('testadminA', password_a, secret_a, 'Access-Accept'),
                 'Restored host allows real UDP', seconds=30)
            sql("UPDATE hosts SET space_id='lab-space-b' WHERE id='lab-host-a'")
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 'f'
            assert radtest('testadminA', password_a, secret_a, 'Access-Reject'), 'Moved host must deny real UDP'
            sql("UPDATE hosts SET space_id='lab-space-a' WHERE id='lab-host-a'")
            sql("UPDATE companies SET deleted_at=now() WHERE id='lab-company-a'")
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 'f'
            assert radtest('testadminA', password_a, secret_a, 'Access-Reject'), 'Archived company must deny real UDP'
            sql("UPDATE companies SET deleted_at=NULL WHERE id='lab-company-a'")
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 't'
            wait(lambda: radtest('testadminA', password_a, secret_a, 'Access-Accept'),
                 'Restored company allows real UDP', seconds=30)
            print('PASS archived/moved host and company revoke actual UDP authentication')
            api('/api/radius-ops/devices/'+nas_a, 'PUT', {
                'label':'Lab NAS A','vendor':'cisco-legacy','nasIp':'127.0.0.1',
                'enabled':False})
            # A disabled specific NAS remains in FreeRADIUS as a client shadow,
            # so a broader /0 secret can never take over this source.
            assert sql("SELECT count(*) FROM nas WHERE nasname='127.0.0.1'") == '1'
            assert sql("SELECT radius_ops_identity_allowed('testadminA','127.0.0.1'::inet)") == 'f'
            assert radtest('testadminA',password_a,secret_a,'Access-Reject')
            assert not radtest('testadminA',password_a,fallback_secret,'Access-Accept')
            print('PASS disabled /32 NAS shadows /0 fallback and rejects authentication')
            api('/api/radius-ops/devices/'+nas_a, 'PUT', {
                'label':'Lab NAS A','vendor':'cisco-legacy','nasIp':'127.0.0.1',
                'enabled':True})
            wait(lambda: radtest('testadminA',password_a,secret_a,'Access-Accept'),
                 'NAS reactivation restores authorization', seconds=30)
            # Secret rotation must invalidate the previous shared secret and
            # reload the live SQL client list without a manual daemon restart.
            old_secret_a = secret_a
            rotated_secret_a = secrets.token_hex(22)
            api('/api/radius-ops/devices/'+nas_a, 'PUT', {
                'label':'Lab NAS A','vendor':'cisco-legacy','nasIp':'127.0.0.1',
                'secret':rotated_secret_a,'enabled':True})
            wait(lambda: radtest('testadminA',password_a,rotated_secret_a,'Access-Accept'),
                 'NAS secret rotation reloads the real FreeRADIUS client', seconds=45)
            assert not radtest('testadminA',password_a,old_secret_a,'Access-Accept'), \
                'Old NAS secret must no longer authorize after rotation'
            secret_a = rotated_secret_a
            print('PASS rotated NAS shared secret revokes old secret without device push')
            dc('restart', 'app', 'radius_ops', timeout=90)
            wait(lambda: api('/api/radius-ops/health').get('running'), 'Services healthy after restart')
            assert sql("SELECT count(*) FROM radius_ops_accounts WHERE username='testadminA'") == '1'
            assert sql("SELECT count(*) FROM schema_migrations WHERE module_id='radius-ops'") == '12'
            print('PASS persistent data and migration ledger after restart')
            # A database outage must stop the UDP listener, not merely set a
            # dashboard warning.  This only stops a disposable Compose DB.
            dc('stop', 'db', timeout=60)
            def radius_is_unhealthy():
                check = dc('exec', '-T', 'radius_ops', 'python3', '-c',
                    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18120/health', timeout=2)",
                    timeout=10, check=False)
                return check.returncode != 0
            wait(radius_is_unhealthy, 'FreeRADIUS health fails closed on PostgreSQL loss', seconds=35)
            # Allow the watcher to terminate the listener (one poll interval).
            time.sleep(8)
            assert not radtest('testadminA', password_a, secret_a, 'Access-Accept')
            print('PASS UDP listener stops on PostgreSQL outage')
            dc('start', 'db', timeout=60)
            wait(lambda: api('/health')['ok'], 'Core API recovered after PostgreSQL restart', seconds=80)
            wait(lambda: api('/api/radius-ops/health').get('running'),
                 'FreeRADIUS listener recovered after PostgreSQL restart', seconds=80)
            assert radtest('testadminA', password_a, secret_a, 'Access-Accept')
            print('PASS UDP authentication recovered after database restart')
            print('REAL DOCKER RADIUS INTEGRATION: PASS')
        except Exception:
            print('Diagnostic logs (test-only values redacted):', file=sys.stderr)
            sensitive = [
                secret_a, secret_b, password_a, password_b,
                env.get('POSTGRES_PASSWORD',''), env.get('EMS_ADMIN_PASSWORD',''),
            ]
            def redact_log(value):
                text = value
                for item in sensitive:
                    if item:
                        text = text.replace(item, '<redacted>')
                text = re.sub(r'(?i)((?:password|secret)\\s*[=:]\\s*)\\S+', r'\\1<redacted>', text)
                return text
            for service in ('app', 'radius_ops'):
                with contextlib.suppress(Exception):
                    result = dc('logs', '--tail=100', service, timeout=15, check=False)
                    safe = redact_log((result.stdout or '') + '\\n' + (result.stderr or ''))
                    lines = safe.splitlines()[-100:]
                    print(f'--- {service} redacted tail ({len(lines)} lines) ---', file=sys.stderr)
                    for line in lines:
                        print(line[:1000], file=sys.stderr)
            raise
        finally:
            dc('down', '-v', '--remove-orphans', timeout=90, check=False)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'FAIL: {type(exc).__name__}: {str(exc)[:450]}', file=sys.stderr)
        sys.exit(1)
