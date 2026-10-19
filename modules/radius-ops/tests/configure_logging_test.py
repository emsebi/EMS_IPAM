"""Unit checks for the stock FreeRADIUS logging overlay."""
import importlib.util
from pathlib import Path
from unittest import TestCase

module_path = Path(__file__).parents[1] / 'freeradius/configure-logging.py'
spec = importlib.util.spec_from_file_location('radius_logging_config', module_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

FIXTURE = """log {
\tdestination = files
\tstripped_names = no
\tauth = no
\tauth_badpass = no
\tauth_goodpass = no
#\tmsg_goodpass = ""
#\tmsg_badpass = ""
}
"""

class LoggingConfiguratorTest(TestCase):
    def test_stock_freeradius_3_logging_disables_passwords(self):
        out = config.configure_text(FIXTURE)
        self.assertIn("\tauth = yes", out)
        self.assertIn("\tauth_badpass = no", out)
        self.assertIn("\tauth_goodpass = no", out)
        self.assertIn('msg_badpass = " EMSMETA src=%{Packet-Src-IP-Address}', out)
        self.assertIn('msg_goodpass = " EMSMETA src=%{Packet-Src-IP-Address}', out)
        self.assertIn('method=%{control:Auth-Type}"', out)

    def test_missing_stock_setting_fails_loudly(self):
        with self.assertRaisesRegex(RuntimeError, 'auth_badpass'):
            config.configure_text(FIXTURE.replace("\tauth_badpass = no\n", ""))
