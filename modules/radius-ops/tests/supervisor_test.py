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
            self.assertIn(b'"running": false', response.read())
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
            self.assertIn(b'"running": false',resp.read())
            conn.close()
        finally:
            server.shutdown();server.server_close()
            supervisor.RUNNING,supervisor.RUNNING_SINCE,supervisor.CHILD=old


class DatabaseHealthTest(TestCase):
    def test_running_daemon_with_disconnected_postgres_is_unhealthy(self):
        old = (supervisor.RUNNING, supervisor.RUNNING_SINCE,
               supervisor.CHILD, supervisor.DB_READY)
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
            self.assertIn(b'"running": false',response.read())
            client.close()
            supervisor.DB_READY=True
            with patch.object(supervisor, 'udp_listeners_ready', return_value=True):
                client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                client.request('GET','/health')
                response=client.getresponse()
                self.assertEqual(response.status,200)
                self.assertIn(b'"running": true',response.read())
                client.close()
        finally:
            server.shutdown();server.server_close()
            (supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY)=old

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
                 patch.object(supervisor.threading, 'Thread') as thread, \
                 patch.object(supervisor.subprocess, 'Popen', return_value=child) as launch, \
                 patch.object(supervisor.time, 'sleep', side_effect=tick):
                supervisor.main()
            self.assertTrue(child.terminated, 'Database outage must close the UDP listener')
            self.assertFalse(supervisor.DB_READY)
            self.assertEqual(launch.call_count, 1)
            self.assertGreaterEqual(thread.call_count, 2)
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
             supervisor.CHILD,supervisor.DB_READY)
        sockets=[socket.socket(socket.AF_INET,socket.SOCK_DGRAM) for _ in range(2)]
        try:
            for sock in sockets:sock.bind(('127.0.0.1',0))
            ports=tuple(sock.getsockname()[1] for sock in sockets)
            supervisor.RUNNING=True
            supervisor.RUNNING_SINCE=time.monotonic()-30
            supervisor.DB_READY=True
            supervisor.CHILD=SimpleNamespace(pid=99999999,poll=lambda: None)
            real_udp_check=supervisor.udp_listeners_ready
            with patch.object(supervisor,'udp_listeners_ready',
                              side_effect=lambda **kwargs: real_udp_check(ports=ports,**kwargs)):
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
             supervisor.CHILD,supervisor.DB_READY)=old

    def test_healthy_process_without_bound_udp_ports_reports_unhealthy(self):
        old=(supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY)
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
                self.assertIn(b'"running": false',response.read())
                conn.close()
        finally:
            server.shutdown();server.server_close()
            (supervisor.RUNNING,supervisor.RUNNING_SINCE,
             supervisor.CHILD,supervisor.DB_READY)=old


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
        self.assertEqual(data['items'][0]['attemptedPassword'],'bad')
        supervisor.live_stop(token)
        self.assertEqual(list(supervisor.LIVE_EVENTS),[])

    def test_freeradius_line_decodes_failed_pap_value_without_persistence(self):
        hx=lambda s:s.encode().hex()
        line='|'.join(['AUTH','REJECT',hx('ali'),hx('WrongPass!'),hx('127.0.0.1'),
                       hx('127.0.0.1'),hx('QAZVIN-RTR'),hx('10.0.0.5'),'',
                       hx('1'),hx('ether1'),hx('PAP'),hx('pap failed')])
        event=supervisor.parse_live_line(line)
        self.assertEqual(event['username'],'ali')
        self.assertEqual(event['attemptedPassword'],'WrongPass!')
        self.assertEqual(event['nasIdentifier'],'QAZVIN-RTR')
        self.assertEqual(event['callingStationId'],'10.0.0.5')

    def test_http_live_session_is_short_lived_and_no_store(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),supervisor.Health)
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            conn.request('POST','/live/start',body='{}',headers={'Content-Type':'application/json'})
            response=conn.getresponse();self.assertEqual(response.status,200)
            self.assertEqual(response.getheader('Cache-Control'),'no-store')
            token=json.loads(response.read())['token'];conn.close()
            supervisor.live_add({'type':'service','message':'ready'})
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            body=json.dumps({'token':token,'after':0})
            conn.request('POST','/live/events',body=body,headers={'Content-Type':'application/json'})
            response=conn.getresponse();payload=json.loads(response.read())
            self.assertEqual(payload['items'][0]['message'],'ready');conn.close()
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            conn.request('POST','/live/stop',body=json.dumps({'token':token}),headers={'Content-Type':'application/json'})
            self.assertEqual(conn.getresponse().status,200);conn.close()
        finally:
            server.shutdown();server.server_close()


class LiveUdpTransportTest(TestCase):
    def setUp(self):
        with supervisor.LIVE_LOCK:
            supervisor.LIVE_EVENTS.clear()
            supervisor.LIVE_SUBSCRIBERS.clear()
            supervisor.LIVE_SEQ=0

    def tearDown(self):
        with supervisor.LIVE_LOCK:
            supervisor.LIVE_EVENTS.clear()
            supervisor.LIVE_SUBSCRIBERS.clear()

    def test_udp_datagram_feed_is_best_effort_and_memory_only(self):
        token,_=supervisor.live_start()
        server=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        server.bind(('127.0.0.1',0))
        address=server.getsockname()
        server.close()
        old_stop=supervisor.STOP
        supervisor.STOP=False
        thread=Thread(target=supervisor.live_udp_listener,args=(address,),daemon=True)
        thread.start()
        sender=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        try:
            hx=lambda s:s.encode().hex()
            line='|'.join(['AUTH','REJECT',hx('ali'),hx('WrongPass!'),hx('127.0.0.1'),
                           hx('127.0.0.1'),hx('QAZVIN-RTR'),hx('10.0.0.5'),'',
                           hx('1'),hx('ether1'),hx('PAP'),hx('pap failed')])
            for _ in range(10):
                sender.sendto((line+'\n').encode(),address)
                time.sleep(.02)
                data=supervisor.live_snapshot(token,0)
                if data and data['items']:
                    break
            self.assertTrue(data['items'])
            self.assertEqual(data['items'][0]['attemptedPassword'],'WrongPass!')
        finally:
            sender.close()
            supervisor.STOP=True
            thread.join(1)
            supervisor.STOP=old_stop
            supervisor.live_stop(token)
