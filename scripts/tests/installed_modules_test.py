import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("installed_modules", Path(__file__).parents[1] / "installed-modules-check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class InstalledModulesTest(unittest.TestCase):
    def health(self):
        return {"ok": True, "database": "ready", "modules": sorted(check.REQUIRED_MODULES)}

    def test_healthy_panel_with_missing_backend_fails(self):
        for module in check.REQUIRED_MODULES:
            payload = self.health()
            payload["modules"].remove(module)
            with self.subTest(module=module), self.assertRaises(ValueError):
                check.validate_health(payload)

    def test_invalid_health_fails(self):
        for payload in [None, {}, {**self.health(), "ok": False},
                        {**self.health(), "database": "unavailable"},
                        {**self.health(), "modules": "network-map"}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                check.validate_health(payload)

    @patch.object(check.http.client, "HTTPConnection")
    def test_only_loopback_get_and_close(self, factory):
        connection = factory.return_value
        connection.getresponse.return_value = MagicMock(status=200)
        connection.getresponse.return_value.read.return_value = json.dumps(self.health()).encode()
        check.check_installed()
        factory.assert_called_once_with("127.0.0.1", 8888, timeout=5)
        connection.request.assert_called_once_with("GET", "/health")
        connection.close.assert_called_once_with()

    @patch.object(check.http.client, "HTTPConnection")
    def test_redirect_is_not_followed(self, factory):
        connection = factory.return_value
        connection.getresponse.return_value.status = 302
        with self.assertRaises(ValueError):
            check.check_installed()
        connection.request.assert_called_once_with("GET", "/health")
        connection.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
