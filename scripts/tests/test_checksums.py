import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "checksums.py"


class ChecksumsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root / "SHA256SUMS"
        self.data = self.root / "binary fixture.bin"
        self.data.write_bytes(bytes(range(256)))
        digest = hashlib.sha256(self.data.read_bytes()).hexdigest()
        self.manifest.write_text(f"{digest}  {self.data.name}\n", encoding="utf-8")

    def run_cli(self, mode):
        return subprocess.run([sys.executable, str(SCRIPT), mode, "--manifest", str(self.manifest)],
                              capture_output=True, text=True)

    def test_modified_bytes_fail_check_without_rewriting_then_refresh_is_repeatable(self):
        self.assertEqual(self.run_cli("--check").returncode, 0)
        before = self.manifest.read_bytes()
        self.data.write_bytes(b"changed\x00\xff")
        failed = self.run_cli("--check")
        self.assertEqual(failed.returncode, 1)
        self.assertIn(self.data.name, failed.stderr)
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual(self.run_cli("--write").returncode, 0)
        updated = self.manifest.read_bytes()
        self.assertNotEqual(updated, before)
        self.assertEqual(self.run_cli("--check").returncode, 0)
        self.assertEqual(self.run_cli("--write").returncode, 0)
        self.assertEqual(self.manifest.read_bytes(), updated)

    def test_missing_file_aborts_refresh_without_partial_write(self):
        self.manifest.write_text(self.manifest.read_text() + "0" * 64 + "  missing.bin\n")
        before = self.manifest.read_bytes()
        self.data.write_bytes(b"changed")
        self.assertEqual(self.run_cli("--write").returncode, 1)
        self.assertEqual(self.manifest.read_bytes(), before)

    def test_invalid_duplicate_outside_and_self_references_are_rejected(self):
        entry = self.manifest.read_text()
        for content in ["malformed\n", "", entry + entry,
                        "0" * 64 + "  ../outside\n", "0" * 64 + "  SHA256SUMS\n"]:
            with self.subTest(content=content):
                self.manifest.write_text(content)
                self.assertEqual(self.run_cli("--write").returncode, 1)
                self.assertEqual(self.manifest.read_text(), content)

    def test_unlisted_local_files_are_not_added(self):
        (self.root / ".env").write_text("synthetic-secret")
        before = self.manifest.read_bytes()
        self.assertEqual(self.run_cli("--write").returncode, 0)
        self.assertEqual(self.manifest.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
