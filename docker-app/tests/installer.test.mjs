import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const installerUrl = new URL("../../install.sh", import.meta.url);

test("installer uses the correct repository and ASCII terminal messages", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");

  assert.match(installer, /emsebi\/EMS_IPAM/);
  assert.doesNotMatch(installer, /emssebi\/EMS_IPAM/);
  assert.doesNotMatch(installer, /[\u0600-\u06ff]/);
});

test("installer validates a downloaded archive before extraction", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");

  assert.match(installer, /curl[^\n]+--output "\$ARCHIVE_PATH"/);
  assert.match(installer, /tar -tzf "\$ARCHIVE_PATH"/);
  assert.match(installer, /Downloaded project archive is invalid or incomplete/);
});

test("setup exposes install, update, backup, restore and both uninstall modes", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  for (const label of ["Install", "Update", "Backup Database", "Restore Database", "Uninstall App (Keep Database)", "Uninstall App + Database"]) {
    assert.match(installer, new RegExp(label.replace(/[()+]/g, "\\$&")));
  }
  assert.match(installer, /EMS_SECRET_KEY/);
  assert.match(installer, /Type DELETE to continue/);
  assert.match(installer, /Type RESTORE to continue/);
  assert.match(installer, /backup_database/);
  assert.match(installer, /cp -a "\$INSTALL_DIR\/backups\/\." "\$SOURCE_DIR\/backups\/"/);
  assert.doesNotMatch(installer, /cp -a "\$INSTALL_DIR\/backups" "\$SOURCE_DIR\/backups"/);
});

test("Windows connection client auto-detects tools and passes usernames without passwords", async () => {
  const [protocol, setup] = await Promise.all([
    fs.readFile(new URL("../../windows-client/EMS-IPAM-Protocol.ps1", import.meta.url), "utf8"),
    fs.readFile(new URL("../../windows-client/Install-EMS-Client.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(protocol, /App Paths/);
  assert.match(protocol, /Select-ToolFile/);
  assert.match(protocol, /usernameValue/);
  assert.match(protocol, /\$target = if \(\$portValue -gt 0\)/);
  assert.match(protocol, /'winbox' \{ @\(\$target\) \}/);
  assert.doesNotMatch(protocol, /'winbox' \{[^}]*\$usernameValue/);
  assert.match(protocol, /last-launch\.txt/);
  assert.match(protocol, /'\/prompt'/);
  assert.doesNotMatch(protocol, /query\['password'\]/);
  assert.match(setup, /Register-EmsProtocol 'emsipam-client'/);
  assert.match(setup, /WinBox receives only IP:PORT/);
  assert.match(setup, /not found - file selection will open on first use/);
  assert.match(setup, /URL:EMS IPAM Client/);
});
