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

test("setup exposes install, update, backup and both uninstall modes", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  for (const label of ["Install", "Update", "Backup Database", "Uninstall App (Keep Database)", "Uninstall App + Database"]) {
    assert.match(installer, new RegExp(label.replace(/[()+]/g, "\\$&")));
  }
  assert.match(installer, /EMS_SECRET_KEY/);
  assert.match(installer, /Type DELETE to continue/);
});
