import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch


spec = importlib.util.spec_from_file_location(
    "import_installed_check", Path(__file__).parents[1] / "import-installed-check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
SOURCE_SHA = "a" * 40
IDENTITY = {"id": "b" * 64, "image": "sha256:" + "c" * 64,
            "running": True, "started_at": "2026-11-22T00:00:00.123Z", "restart_count": 0}


class ImportInstalledCheckTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.contents = {}
        for relative in check.FILES:
            content = ("fixture " + relative).encode()
            path = self.root / "docker-app" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            self.contents[relative] = content
        self.identities = [IDENTITY.copy(), IDENTITY.copy()]
        self.installed = {name: hashlib.sha256(body).hexdigest()
                          for name, body in self.contents.items()}
        self.responses = {url: (200, self.contents[name]) for name, url in check.HTTP_PATHS.items()}
        self.responses["/health"] = (200, b'{"ok":true,"database":"ready","modules":["ipam"]}')
        self.commands = []
        self.requests = []
        self.connections = []

    def run_command(self, args, **kwargs):
        self.commands.append(args)
        self.assertEqual(kwargs, {"check": True, "stdout": subprocess.PIPE,
                                  "stderr": subprocess.PIPE, "timeout": 8})
        if args == ["docker", "container", "inspect", "--format", check.IDENTITY_FORMAT, check.APP]:
            output = json.dumps(self.identities.pop(0))
        else:
            self.assertEqual(args[:5], ["docker", "exec", check.APP, "sha256sum", "--"])
            self.assertEqual(len(args), 6)
            relative = args[5].removeprefix("/app/")
            self.assertIn(relative, check.FILES)
            if self.installed[relative] is None:
                raise subprocess.CalledProcessError(1, args, stderr=b"DO NOT EXPOSE private failure")
            output = self.installed[relative] + "  " + args[5]
        return subprocess.CompletedProcess(args, 0, stdout=(output + "\n").encode())

    def connection(self, host, port, timeout):
        self.assertEqual((host, port, timeout), ("127.0.0.1", 8888, 5))
        conn = MagicMock()
        self.connections.append(conn)

        def request(method, path):
            self.assertEqual(method, "GET")
            self.requests.append(path)
            status, body = self.responses[path]
            response = MagicMock(status=status)
            response.read.side_effect = lambda length: body[:length]
            conn.getresponse.return_value = response
        conn.request.side_effect = request
        return conn

    def inspect(self):
        with patch.object(check.subprocess, "run", side_effect=self.run_command), \
                patch.object(check.http.client, "HTTPConnection", side_effect=self.connection):
            report, code = check.inspect_installed(self.root, SOURCE_SHA)
        for conn in self.connections:
            conn.close.assert_called_once_with()
        return report, code

    def test_matching_files_are_not_runtime_or_operator_acceptance(self):
        report, code = self.inspect()
        self.assertEqual(code, 0)
        self.assertEqual(report["status"], "files_match_runtime_unverified")
        self.assertEqual(report["expected_source_sha"], SOURCE_SHA)
        self.assertIsNone(report["deployed_sha"])
        self.assertFalse(report["runtime_backend_verified"])
        self.assertEqual(report["acceptance"], "pending")
        self.assertEqual(self.requests, ["/health", "/", "/app.js", "/ipam-import-format.mjs"])
        self.assertEqual(len(self.commands), 11)

    def test_healthy_ui_only_rollout_with_old_backend_is_blocked(self):
        self.installed["server/portable.mjs"] = "d" * 64
        report, code = self.inspect()
        self.assertEqual(code, 2)
        self.assertTrue(report["health"]["ready"])
        self.assertTrue(all(row["status"] == "match" for row in report["served_assets"].values()))
        self.assertEqual(report["container_files"]["server/portable.mjs"]["status"], "mismatch")
        self.assertEqual(report["status"], "blocked")

    def test_missing_shared_module_and_html_fallback_are_blocked(self):
        self.installed["public/ipam-import-format.mjs"] = None
        self.responses["/ipam-import-format.mjs"] = (200, b"<html>fallback</html>")
        report, code = self.inspect()
        self.assertEqual(code, 2)
        self.assertEqual(report["container_files"]["public/ipam-import-format.mjs"]["status"], "unavailable")
        self.assertEqual(report["served_assets"]["/ipam-import-format.mjs"]["status"], "mismatch")
        self.assertNotIn("private failure", json.dumps(report))

    def test_served_asset_must_match_even_when_disk_matches(self):
        self.responses["/app.js"] = (200, b"stale frontend")
        report, code = self.inspect()
        self.assertEqual(code, 2)
        self.assertEqual(report["served_assets"]["/app.js"]["status"], "mismatch")

    def test_restart_or_replacement_during_observation_blocks_evidence(self):
        for field, value in [("id", "d" * 64), ("image", "sha256:" + "e" * 64),
                             ("started_at", "2026-11-22T00:01:00Z"), ("restart_count", 1)]:
            with self.subTest(field=field):
                self.identities = [IDENTITY.copy(), {**IDENTITY, field: value}]
                self.connections = []
                report, code = self.inspect()
                self.assertEqual(code, 2)
                self.assertFalse(report["app_identity_stable"])

    def test_stopped_or_invalid_identity_does_not_pass(self):
        for identity in [{**IDENTITY, "running": False}, {**IDENTITY, "id": "bad"},
                         {**IDENTITY, "restart_count": True}, {**IDENTITY, "env": "secret"}]:
            with self.subTest(identity=identity):
                self.identities = [identity, identity]
                self.connections = []
                report, code = self.inspect()
                self.assertEqual(code, 2)
                self.assertNotIn("secret", json.dumps(report))

    def test_health_failure_is_blocked_without_emitting_body(self):
        for body in [b"private not JSON", b'{}', b'{"ok":false}',
                     b'{"ok":true,"database":"ready","modules":"ipam"}',
                     b'{"ok":true,"database":"ready","modules":[]}']:
            with self.subTest(body=body):
                self.responses["/health"] = (200, body)
                self.identities = [IDENTITY.copy(), IDENTITY.copy()]
                self.connections = []
                report, code = self.inspect()
                self.assertEqual(code, 2)
                self.assertFalse(report["health"]["ready"])
                self.assertNotIn("private not JSON", json.dumps(report))

    def test_redirect_and_missing_asset_are_not_followed(self):
        self.responses["/app.js"] = (302, b"do not follow")
        self.responses["/ipam-import-format.mjs"] = (404, b"missing")
        report, code = self.inspect()
        self.assertEqual(code, 2)
        self.assertEqual(len(self.requests), 4)
        self.assertEqual(report["served_assets"]["/app.js"]["http_status"], 302)
        self.assertEqual(report["served_assets"]["/ipam-import-format.mjs"]["status"], "unavailable")
        self.connections[2].getresponse.return_value.read.assert_not_called()

    def test_oversized_response_is_rejected(self):
        self.responses["/app.js"] = (200, b"x" * (check.MAX_RESPONSE_BYTES + 1))
        report, code = self.inspect()
        self.assertEqual(code, 2)
        self.assertEqual(report["served_assets"]["/app.js"]["status"], "unavailable")

    def test_invalid_reference_fails_before_any_vm_access(self):
        with patch.object(check, "app_identity") as identity, patch.object(check, "get_local") as request:
            with self.assertRaises(ValueError):
                check.inspect_installed(self.root, "short")
            (self.root / "docker-app" / "server/portable.mjs").unlink()
            with self.assertRaises(FileNotFoundError):
                check.inspect_installed(self.root, SOURCE_SHA)
            identity.assert_not_called()
            request.assert_not_called()

    def test_non_allowlisted_http_or_container_paths_are_rejected_before_access(self):
        with patch.object(check, "command") as command, patch.object(check.http.client, "HTTPConnection") as factory:
            for path in ["/api/imports/subnet/preview", "http://10.1.1.5/", "/api/auth/login"]:
                with self.assertRaises(ValueError):
                    check.get_local(path)
            for path in ["../.env", "server/../../secret", "modules/radius/config"]:
                with self.assertRaises(ValueError):
                    check.installed_hash(path)
            command.assert_not_called()
            factory.assert_not_called()

    def test_timeout_closes_connection_and_returns_no_body(self):
        with patch.object(check.http.client, "HTTPConnection") as factory:
            factory.return_value.request.side_effect = TimeoutError("private details")
            self.assertEqual(check.get_local("/health"), (None, None))
            factory.return_value.close.assert_called_once_with()

    def test_docker_failure_does_not_expose_stderr(self):
        with patch.object(check.subprocess, "run", side_effect=FileNotFoundError("private details")):
            self.assertIsNone(check.app_identity())
            self.assertIsNone(check.installed_hash("server/main.mjs"))

    def test_sha256_output_must_name_the_requested_file(self):
        with patch.object(check, "command", return_value="a" * 64 + "  /app/other"):
            self.assertIsNone(check.installed_hash("server/main.mjs"))


if __name__ == "__main__":
    unittest.main()
