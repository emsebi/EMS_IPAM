"""Sidecar unit checks without Docker or a live FreeRADIUS daemon."""
import importlib.util
import http.client
import json
import os
import socket
import time
import stat
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from threading import Thread

path = Path(__file__).parents[1] / 'freeradius/supervisor.py'
spec = importlib.util.spec_from_file_location('radius_supervisor', path)
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class SidecarTest(TestCase):
    def test_nas_fingerprint_does_not_return_plaintext_secret(self):
        digest = 'abcdef0123456789abcdef0123456789'
        with patch.object(supervisor.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=digest+'\n')) as run:
            self.assertEqual(supervisor.fingerprint(), digest)
            sql = run.call_args.args[0][-1]
            self.assertIn('md5(coalesce(jsonb_agg(jsonb_build_array(', sql)
            self.assertIn('ORDER BY nasname,id', sql)
            for field in ('nasname','shortname','type','ports','secret','server','community','description'):
                self.assertIn(field, sql)
            self.assertNotIn('string_agg', sql)

    def test_empty_or_malformed_psql_output_fails_closed(self):
        for output in ('', 'empty\n', 'WARNING: db not ready\n', 'a'*31, 'z'*32, 'a'*32+'\n'+ 'b'*32):
            with self.subTest(output=output), patch.object(supervisor.subprocess, 'run',
                return_value=SimpleNamespace(returncode=0, stdout=output)):
                self.assertIsNone(supervisor.fingerprint())

    def test_valid_empty_nas_digest_is_not_confused_with_disconnected_database(self):
        # md5('[]') is the normal PostgreSQL result for a reachable, empty nas table.
        import hashlib
        digest=hashlib.md5(b'[]').hexdigest()
        with patch.object(supervisor.subprocess, 'run',
            return_value=SimpleNamespace(returncode=0, stdout=digest+'\n')):
            self.assertEqual(supervisor.fingerprint(), digest)

    def test_database_unavailable_is_not_an_empty_nas_table(self):
        with patch.object(supervisor.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
            self.assertIsNone(supervisor.fingerprint())

    def test_health_returns_false_when_radius_is_not_running(self):
        old = supervisor.RUNNING
        supervisor.RUNNING = False
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), supervisor.Health)
        worker = Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            client = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=2)
            client.request('GET', '/health')
            response = client.getresponse()
            self.assertEqual(response.status, 503)
            self.assertIn(b'"running":false', response.read())
            client.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            supervisor.RUNNING = old

    def test_sql_config_writes_real_private_file_without_chown(self):
        env={'PGHOST':'db','PGPORT':'5432','PGUSER':'ems','PGPASSWORD':'a"quoted-secret','PGDATABASE':'ems_ipam'}
        with tempfile.TemporaryDirectory() as td, patch.dict(os.environ,env):
            supervisor.sql_config(td)
            p=Path(td)/'ems-radius-sql.conf'
            contents=p.read_text()
            self.assertIn('read_clients = yes',contents)
            self.assertIn('read_groups = yes',contents)
            self.assertIn('a\\"quoted-secret',contents)
            self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
            self.assertEqual(stat.S_IMODE((Path(td)/'freeradius').stat().st_mode),0o700)
            self.assertNotIn('os.chown(',Path(supervisor.__file__).read_text())


class StableHealthTest(TestCase):
    def test_newly_started_child_does_not_report_healthy(self):
        old_running, old_since, old_child = supervisor.RUNNING, supervisor.RUNNING_SINCE, supervisor.CHILD
        supervisor.RUNNING = True
        supervisor.RUNNING_SINCE = time.monotonic()
        supervisor.CHILD = SimpleNamespace(poll=lambda: None)
        server = ThreadingHTTPServer(('127.0.0.1', 0), supervisor.Health)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            client = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
            client.request('GET', '/health')
            response = client.getresponse()
            self.assertEqual(response.status, 503)
            response.read()
            client.close()
        finally:
            server.shutdown();server.server_close()
            supervisor.RUNNING,supervisor.RUNNING_SINCE,supervisor.CHILD = old_running,old_since,old_child


class DeadProcessHealthTest(TestCase):
    def test_crashed_daemon_cannot_appear_healthy(self):
        old = supervisor.RUNNING,supervisor.RUNNING_SINCE,supervisor.CHILD
        supervisor.RUNNING=True
        supervisor.RUNNING_SINCE=time.monotonic()-30
        supervisor.CHILD=SimpleNamespace(poll=lambda: 1)
        server=ThreadingHTTPServer(('127.0.0.1',0),supervisor.Health)
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            conn.request('GET','/health')
            resp=conn.getresponse()
            self.assertEqual(resp.status,503)
            self.assertIn(b'"running":false',resp.read())
            conn.close()
        finally:
            server.shutdown();server.server_close()
            supervisor.RUNNING,supervisor.RUNNING_SINCE,supervisor.CHILD=old


class DatabaseHealthTest(TestCase):
    def test_running_daemon_with_disconnected_postgres_is_unhealthy(self):
        old = (supervisor.RUNNING, supervisor.RUNNING_SINCE,
               supervisor.CHILD, supervisor.DB_READY, supervisor.CONFIG_READY)
        supervisor.RUNNING=True
        supervisor.RUNNING_SINCE=time.monotonic()-30
        supervisor.CHILD=SimpleNamespace(poll=lambda: None)
        supervisor.DB_READY=False
        server=ThreadingHTTPServer(('127.0.0.1',0),supervisor.Health)
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            client.request('GET','/health')
            response=client.getresponse()
            self.assertEqual(response.status,503)
            self.assertIn(b'"running":false',response.read())
            client.close()
            supervisor.DB_READY=True
            supervisor.CONFIG_READY=True
            with patch.object(supervisor, 'udp_listeners_ready', return_value=True):
                client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                client.request('GET','/health')
                response=client.getresponse()
                self.assertEqual(response.status,200)
                self.assertIn(b'"running":true',response.read())
                client.close()
        finally:
            server.shutdown();server.server_close()
            (supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY,supervisor.CONFIG_READY)=old

class DatabaseOutageLifecycleTest(TestCase):
    def test_listener_is_terminated_on_postgres_loss_and_not_restarted_without_db(self):
        """A health-only 503 is not enough: the UDP daemon must stop."""
        class Child:
            terminated = False
            def poll(self): return 0 if self.terminated else None
            def terminate(self): self.terminated = True
            def wait(self, timeout=None): return 0
        child = Child()
        old = (supervisor.STOP, supervisor.RUNNING, supervisor.CHILD,
               supervisor.DB_READY, supervisor.RUNNING_SINCE)
        supervisor.STOP = False
        calls = iter(['initial-fingerprint', None, None])
        def tick(_seconds):
            # After the listener has been terminated, finish the test without
            # starting a new process or sleeping for real.
            if child.terminated:
                supervisor.STOP = True
        try:
            with patch.object(supervisor, 'fingerprint', side_effect=lambda: next(calls)), \
                 patch.object(supervisor, 'sql_config'), \
                 patch.object(supervisor, 'freeradius_config_check', return_value=True), \
                 patch.object(supervisor.threading, 'Thread') as thread, \
                 patch.object(supervisor.subprocess, 'Popen', return_value=child) as launch, \
                 patch.object(supervisor.time, 'sleep', side_effect=tick):
                supervisor.main()
            self.assertTrue(child.terminated, 'Database outage must close the UDP listener')
            self.assertFalse(supervisor.DB_READY)
            self.assertEqual(launch.call_count, 1)
            self.assertGreaterEqual(thread.call_count, 1)
        finally:
            (supervisor.STOP, supervisor.RUNNING, supervisor.CHILD,
             supervisor.DB_READY, supervisor.RUNNING_SINCE) = old

    def test_does_not_launch_listener_if_database_is_unavailable(self):
        old = supervisor.STOP, supervisor.DB_READY
        supervisor.STOP = False
        def tick(_seconds): supervisor.STOP = True
        try:
            with patch.object(supervisor, 'fingerprint', return_value=None), \
                 patch.object(supervisor, 'sql_config'), \
                 patch.object(supervisor, 'freeradius_config_check', return_value=True), \
                 patch.object(supervisor.threading, 'Thread'), \
                 patch.object(supervisor.subprocess, 'Popen') as launch, \
                 patch.object(supervisor.time, 'sleep', side_effect=tick):
                supervisor.main()
            launch.assert_not_called()
            self.assertFalse(supervisor.DB_READY)
        finally:
            supervisor.STOP, supervisor.DB_READY = old

class NasReloadLifecycleTest(TestCase):
    def test_changed_client_fingerprint_terminates_listener_for_reload(self):
        """A rotated secret or any SQL client field change must stop the old daemon."""
        class Child:
            terminated = False
            def poll(self): return 0 if self.terminated else None
            def terminate(self): self.terminated = True
            def wait(self, timeout=None): return 0
        child = Child()
        old = (supervisor.STOP, supervisor.RUNNING, supervisor.CHILD,
               supervisor.DB_READY, supervisor.RUNNING_SINCE)
        supervisor.STOP = False
        calls = iter(['a'*32, 'b'*32])
        def tick(_seconds):
            if child.terminated:
                supervisor.STOP = True
        try:
            with patch.object(supervisor, 'fingerprint', side_effect=lambda: next(calls)), \
                 patch.object(supervisor, 'sql_config'), \
                 patch.object(supervisor, 'freeradius_config_check', return_value=True), \
                 patch.object(supervisor.threading, 'Thread'), \
                 patch.object(supervisor.subprocess, 'Popen', return_value=child) as launch, \
                 patch.object(supervisor.time, 'sleep', side_effect=tick):
                supervisor.main()
            self.assertTrue(child.terminated)
            self.assertEqual(launch.call_count, 1)
            self.assertTrue(supervisor.DB_READY, 'NAS reload is not a DB outage')
        finally:
            (supervisor.STOP, supervisor.RUNNING, supervisor.CHILD,
             supervisor.DB_READY, supervisor.RUNNING_SINCE) = old


class UdpListenerHealthTest(TestCase):
    def test_detects_both_real_bound_udp_ports_and_loss_of_one(self):
        import socket
        first=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        second=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        try:
            first.bind(('127.0.0.1',0))
            second.bind(('127.0.0.1',0))
            ports=(first.getsockname()[1],second.getsockname()[1])
            self.assertTrue(supervisor.udp_listeners_ready(ports,pid=os.getpid()))
            second.close()
            self.assertFalse(supervisor.udp_listeners_ready(ports,pid=os.getpid()))
        finally:
            first.close()
            second.close()

    def test_ports_bound_only_to_other_loopback_ip_are_not_healthy(self):
        # Both ports exist and belong to this PID, but 127.0.0.1 cannot
        # reach them: a port/inode-only health probe would return false OK.
        sockets=[socket.socket(socket.AF_INET,socket.SOCK_DGRAM) for _ in range(2)]
        try:
            for sock in sockets:sock.bind(('127.0.0.2',0))
            ports=tuple(sock.getsockname()[1] for sock in sockets)
            self.assertFalse(supervisor.udp_listeners_ready(ports,pid=os.getpid()))
        finally:
            for sock in sockets:sock.close()

    def test_wildcard_udp_bind_is_reachable_and_healthy(self):
        sockets=[socket.socket(socket.AF_INET,socket.SOCK_DGRAM) for _ in range(2)]
        try:
            for sock in sockets:sock.bind(('0.0.0.0',0))
            ports=tuple(sock.getsockname()[1] for sock in sockets)
            self.assertTrue(supervisor.udp_listeners_ready(ports,pid=os.getpid()))
        finally:
            for sock in sockets:sock.close()

    def test_missing_or_malformed_proc_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'udp'
            self.assertFalse(supervisor.udp_listeners_ready(proc_file=str(p),pid=os.getpid()))
            p.write_text('header\n0: invalid nonsense\n')
            self.assertFalse(supervisor.udp_listeners_ready(proc_file=str(p),pid=os.getpid()))

    def test_ports_owned_by_another_process_cannot_make_child_healthy(self):
        # A bound UDP port is not proof that FreeRADIUS owns that socket.
        import subprocess
        import sys
        sockets=[socket.socket(socket.AF_INET,socket.SOCK_DGRAM) for _ in range(2)]
        child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],
                               stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for sock in sockets:sock.bind(('127.0.0.1',0))
            ports=tuple(sock.getsockname()[1] for sock in sockets)
            self.assertTrue(supervisor.udp_listeners_ready(ports,pid=os.getpid()))
            self.assertFalse(supervisor.udp_listeners_ready(ports,pid=child.pid))
            self.assertFalse(supervisor.udp_listeners_ready(ports,pid=None))
            self.assertFalse(supervisor.udp_listeners_ready(ports,pid=99999999))
        finally:
            child.terminate()
            child.wait(timeout=3)
            for sock in sockets:sock.close()

    def test_health_denies_ports_owned_by_supervisor_not_daemon(self):
        old=(supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY,supervisor.CONFIG_READY)
        sockets=[socket.socket(socket.AF_INET,socket.SOCK_DGRAM) for _ in range(2)]
        try:
            for sock in sockets:sock.bind(('127.0.0.1',0))
            ports=tuple(sock.getsockname()[1] for sock in sockets)
            supervisor.RUNNING=True
            supervisor.RUNNING_SINCE=time.monotonic()-30
            supervisor.DB_READY=True
            supervisor.CONFIG_READY=True
            supervisor.CHILD=SimpleNamespace(pid=99999999,poll=lambda: None)
            real_udp_check=supervisor.udp_listeners_ready
            with patch.object(supervisor,'udp_listeners_ready',
                              side_effect=lambda **kwargs: real_udp_check(ports=ports,pid=kwargs.get('pid'))):
                server=ThreadingHTTPServer(('127.0.0.1',0),supervisor.Health)
                Thread(target=server.serve_forever,daemon=True).start()
                try:
                    conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                    conn.request('GET','/health')
                    response=conn.getresponse()
                    self.assertEqual(response.status,503)
                    response.read();conn.close()
                finally:
                    server.shutdown();server.server_close()
        finally:
            for sock in sockets:sock.close()
            (supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY,supervisor.CONFIG_READY)=old

    def test_healthy_process_without_bound_udp_ports_reports_unhealthy(self):
        old=(supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY,supervisor.CONFIG_READY)
        supervisor.RUNNING=True
        supervisor.RUNNING_SINCE=time.monotonic()-30
        supervisor.CHILD=SimpleNamespace(poll=lambda: None)
        supervisor.DB_READY=True
        server=ThreadingHTTPServer(('127.0.0.1',0),supervisor.Health)
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            with patch.object(supervisor,'udp_listeners_ready',return_value=False):
                conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                conn.request('GET','/health')
                response=conn.getresponse()
                self.assertEqual(response.status,503)
                self.assertIn(b'"running":false',response.read())
                conn.close()
        finally:
            server.shutdown();server.server_close()
            (supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY,supervisor.CONFIG_READY)=old


class VolatileLiveMonitorTest(TestCase):
    def setUp(self):
        with supervisor.LIVE_LOCK:
            supervisor.LIVE_EVENTS.clear()
            supervisor.LIVE_SUBSCRIBERS.clear()
            supervisor.LIVE_SEQ=0

    def tearDown(self):
        with supervisor.LIVE_LOCK:
            supervisor.LIVE_EVENTS.clear()
            supervisor.LIVE_SUBSCRIBERS.clear()

    def test_events_exist_only_for_active_subscriber_and_stop_clears(self):
        self.assertFalse(supervisor.live_add({'type':'service','message':'discard me'}))
        token,seq=supervisor.live_start()
        self.assertEqual(seq,0)
        self.assertTrue(supervisor.live_add({'type':'authentication','result':'REJECT','attemptedPassword':'bad'}))
        data=supervisor.live_snapshot(token,0)
        self.assertNotIn('attemptedPassword',data['items'][0])
        self.assertNotIn('bad',str(data['items'][0]))
        supervisor.live_stop(token)
        self.assertEqual(list(supervisor.LIVE_EVENTS),[])

    def test_freeradius_line_does_not_decode_failed_pap_value(self):
        hx=lambda text:text.encode().hex()
        line='|'.join(['AUTH','REJECT',hx('ali'),hx('WrongPass!'),hx('127.0.0.1'),
                       hx('127.0.0.1'),hx('QAZVIN-RTR'),hx('10.0.0.5'),hx('router'),
                       hx('10.0.0.5'),hx('1'),hx('ether1'),hx('PAP'),hx('ems_test'),
                       hx('pap failed')])
        event=supervisor.parse_live_line(line)
        self.assertEqual(event['username'],'ali')
        self.assertNotIn('attemptedPassword',event)
        self.assertNotIn('WrongPass!',str(event))
        self.assertEqual(event['sourceIp'],'127.0.0.1')
        self.assertEqual(event['nasIdentifier'],'QAZVIN-RTR')
        self.assertEqual(event['callingStationId'],'10.0.0.5')
        self.assertEqual(event['framedIpAddress'],'10.0.0.5')
        self.assertEqual(event['clientShortname'],'ems_test')

    def test_hex_decoder_accepts_freeradius_0x_prefix(self):
        self.assertEqual(supervisor._hex_text('0x616c69'),'ali')
        self.assertEqual(supervisor._hex_text('616c69'),'ali')

    def test_http_live_session_is_short_lived_and_no_store(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),supervisor.Health)
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            conn.request('POST','/live/start',body='{}',headers={'Content-Type':'application/json'})
            response=conn.getresponse();self.assertEqual(response.status,200)
            self.assertEqual(response.getheader('Cache-Control'),'no-store')
            token=json.loads(response.read())['token'];conn.close()
            supervisor.live_add({'type':'service','message':'ready','result':'INFO'})
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            body=json.dumps({'token':token,'after':0})
            conn.request('POST','/live/events',body=body,headers={'Content-Type':'application/json'})
            response=conn.getresponse();payload=json.loads(response.read())
            self.assertNotIn('message',payload['items'][0]);conn.close()
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            conn.request('POST','/live/stop',body=json.dumps({'token':token}),headers={'Content-Type':'application/json'})
            self.assertEqual(conn.getresponse().status,200);conn.close()
        finally:
            server.shutdown();server.server_close()




class NativeAuthLogParserTest(TestCase):
    def setUp(self):
        with supervisor.LIVE_LOCK:
            supervisor.LIVE_EVENTS.clear()
            supervisor.LIVE_SUBSCRIBERS.clear()
            supervisor.LIVE_SEQ=0

    def tearDown(self):
        with supervisor.LIVE_LOCK:
            supervisor.LIVE_EVENTS.clear()
            supervisor.LIVE_SUBSCRIBERS.clear()

    def test_native_line_with_distro_prefix_and_no_reason(self):
        msg=('Oct 18 19:50:00 radiusd[42]: Auth: (11) Login incorrect: '
             '[ali/WrongPass!] (from client ems_test port 0) '
             'EMSMETA src=10.1.1.240;nasip=;nasid=;calling=;called=;framed=;method=PAP')
        event=supervisor.parse_native_auth_line(msg)
        self.assertEqual(event['username'],'ali')
        self.assertNotIn('attemptedPassword',event)
        self.assertNotIn('WrongPass!',str(event))
        self.assertEqual(event['sourceIp'],'10.1.1.240')
        self.assertEqual(event['clientShortname'],'ems_test')

    def test_native_badpass_decodes_operator_fields(self):
        msg=('Sun Oct 18 12:00:00 2026 : Auth: (7) Login incorrect '
             '(pap: CLEAR TEXT password check failed): [ali/WrongPass!] '
             '(from client ems_test port 1 cli 10.1.1.161) '
             'EMSMETA src=10.1.1.240;nasip=10.1.1.240;nasid=EMS-VM;'
             'calling=10.1.1.161;called=router-login;framed=10.1.1.161;method=PAP')
        event=supervisor.parse_native_auth_line(msg)
        self.assertEqual(event['result'],'REJECT')
        self.assertEqual(event['username'],'ali')
        self.assertNotIn('attemptedPassword',event)
        self.assertEqual(event['sourceIp'],'10.1.1.240')
        self.assertEqual(event['nasIdentifier'],'EMS-VM')
        self.assertEqual(event['callingStationId'],'10.1.1.161')
        self.assertEqual(event['framedIpAddress'],'10.1.1.161')
        self.assertEqual(event['clientShortname'],'ems_test')
        self.assertEqual(event['authMethod'],'PAP')

    def test_native_goodpass_decodes_accept(self):
        msg=('Auth: (8) Login OK: [ali/GoodPass] '
             '(from client ems_test port 2 cli 10.1.1.161) '
             'EMSMETA src=10.1.1.240;nasip=10.1.1.240;nasid=EMS-VM;'
             'calling=10.1.1.161;called=router-login;framed=10.1.1.161;method=PAP')
        event=supervisor.parse_native_auth_line(msg)
        self.assertEqual(event['result'],'ACCEPT')
        self.assertEqual(event['username'],'ali')
        self.assertNotIn('attemptedPassword',event)
        self.assertEqual(event['sourceIp'],'10.1.1.240')

    def test_no_user_password_placeholder_is_not_presented_as_password(self):
        msg=('Auth: (9) Login incorrect: [ali/<no User-Password attribute>] '
             '(from client ems_test port 0) EMSMETA src=10.1.1.240;'
             'nasip=10.1.1.240;nasid=EMS-VM;calling=;called=;framed=;method=CHAP')
        event=supervisor.parse_native_auth_line(msg)
        self.assertEqual(event['username'],'ali')
        self.assertNotIn('attemptedPassword',event)
        self.assertNotIn('passwordAvailable',event)
        self.assertEqual(event['authMethod'],'CHAP')

    def test_unknown_client_transport_error_exposes_source(self):
        event=supervisor.parse_native_auth_line(
            'Ignoring request to auth address * port 1812 bound to server default from unknown client 192.0.2.9 port 41234 proto udp')
        self.assertEqual(event['type'],'transport')
        self.assertEqual(event['result'],'DROP')
        self.assertEqual(event['sourceIp'],'192.0.2.9')

    def test_service_reader_never_exposes_native_password(self):
        token,_=supervisor.live_start()
        line=('Auth: (10) Login incorrect: [ali/WrongPass!] '
              '(from client ems_test port 0 cli 10.0.0.5) '
              'EMSMETA src=127.0.0.1;nasip=127.0.0.1;nasid=QAZVIN-RTR;'
              'calling=10.0.0.5;called=;framed=10.0.0.5;method=PAP\n')
        old_ready=supervisor.LIVE_COLLECTOR_READY
        try:
            supervisor.service_output_reader(iter([line]))
            data=supervisor.live_snapshot(token,0)
            self.assertTrue(data['items'])
            self.assertNotIn('attemptedPassword',data['items'][0])
            self.assertNotIn('WrongPass!',str(data['items'][0]))
            self.assertEqual(data['items'][0]['username'],'ali')
        finally:
            supervisor.LIVE_COLLECTOR_READY=old_ready
            supervisor.live_stop(token)

    def test_event_without_subscriber_is_not_retained(self):
        self.assertFalse(supervisor.live_add({'type':'authentication','result':'REJECT',
                                              'username':'nobody','attemptedPassword':'bad'}))
        self.assertEqual(list(supervisor.LIVE_EVENTS),[])
