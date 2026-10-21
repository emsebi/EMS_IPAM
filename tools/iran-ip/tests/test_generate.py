import datetime as dt
import importlib.util
import ipaddress
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("generate", Path(__file__).resolve().parents[1] / "generate.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class GenerationTests(unittest.TestCase):
    def test_jalali_leap_boundaries_and_tehran_midnight(self):
        cases = {
            "2024-03-20T00:00:00+00:00": "1403/01/01",
            "2025-03-20T00:00:00+00:00": "1403/12/30",
            "2025-03-21T00:00:00+00:00": "1404/01/01",
            "2026-03-21T00:00:00+00:00": "1405/01/01",
            "2026-10-21T00:00:00+00:00": "1405/07/29",
            "2026-10-20T21:00:00+00:00": "1405/07/29",
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(g.jalali(dt.datetime.fromisoformat(source)), expected)

    def test_collapse_never_expands_coverage(self):
        result = g.normalize(["5.160.0.0/24", "5.160.1.0/24", "5.160.0.0/24", "5.160.8.0/24"])
        self.assertEqual(list(map(str, result)), ["5.160.0.0/23", "5.160.8.0/24"])
        self.assertEqual(g.coverage(result), 768)

    def test_refuses_nonpublic_broad_invalid_or_executable_input(self):
        for value in ("0.0.0.0/0", "10.0.0.0/8", "8.0.0.0/5", "127.0.0.1/32",
                      "100.64.0.0/10", "203.0.113.0/24", "224.0.0.0/4", "1.1.2.7/32",
                      "5.160.0.1/24", "1.1.1.1/33", "::/0", '5.160.0.0/16; /system reset-configuration'):
            with self.subTest(value=value), self.assertRaises(g.InvalidFeed):
                g.normalize([value])

    def test_validation_failure_leaves_published_bytes_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            old = path / "IR-IP_EMS-v6.rsc"
            old.write_text("last-good-file")
            with self.assertRaises(g.InvalidFeed):
                g.build({"status": "error"}, dt.datetime.now(g.UTC), path)
            self.assertEqual(old.read_text(), "last-good-file")
            self.assertEqual(len(list(path.iterdir())), 1)

    def test_overlap_detects_changed_space_with_equal_counts(self):
        a = [ipaddress.ip_network("5.160.0.0/16")]
        b = [ipaddress.ip_network("5.161.0.0/16")]
        self.assertEqual(g.overlap_size(a, b), 0)
        self.assertEqual(g.overlap_size(a, a), 65536)

    def test_outputs_version_guard_disabled_marker_and_complete_block(self):
        now = dt.datetime(2026, 10, 21, 8, tzinfo=g.UTC)
        for major in (6, 7):
            text, plain, digest, metadata = g.render_feed([ipaddress.ip_network("5.160.0.0/16")], now, now, major)
            self.assertIn(f'!= "{major}."', text)
            self.assertIn('address=1.1.2.7 disabled=yes comment=$metadata', text)
            self.assertIn("1405/07/29", metadata)
            self.assertIn(digest, text)
            self.assertTrue(text.rstrip().endswith(digest))
            self.assertLess(text.index("staging count mismatch"), text.index(":local newId"))
            self.assertLess(text.index(":local newId"), text.index("/ip firewall address-list remove $item;"))
            self.assertNotIn("@PREFIXES@", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
