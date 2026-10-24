"""Regression: sidecar must start with cap_drop ALL and read_only rootfs."""
from pathlib import Path
import unittest
root=Path(__file__).resolve().parents[1]
class ContainerSecurityTest(unittest.TestCase):
 def test_daemon_runs_as_nonroot_without_chown(self):
  docker=(root/'freeradius/Dockerfile').read_text()
  sup=(root/'freeradius/supervisor.py').read_text()
  compose=(root/'compose.module.yml').read_text()
  self.assertIn('USER freerad',docker)
  self.assertIn(' python3 ',docker)
  self.assertNotIn('python3-minimal',docker)
  self.assertNotIn('os.chown(',sup)
  self.assertIn('0o600',sup)
  self.assertIn('cap_drop: [ALL]',compose)
  self.assertIn('read_only: true',compose)
  self.assertIn('healthcheck:',compose)
 def test_sql_config_does_not_embed_secrets_in_logs(self):
  sup=(root/'freeradius/supervisor.py').read_text()
  self.assertNotIn('print(content)',sup)
if __name__=='__main__':unittest.main()
