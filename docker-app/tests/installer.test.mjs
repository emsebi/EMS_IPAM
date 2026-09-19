import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const installerUrl = new URL("../../install.sh", import.meta.url);

test("installer uses the official repository and auto-checks prerequisites", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  assert.match(installer, /emsebi\/EMS_IPAM/);
  assert.match(installer, /install_prerequisites/);
  assert.match(installer, /get\.docker\.com/);
  assert.match(installer, /portainer\/portainer-ce/);
});

test("installer exposes exactly the requested four lifecycle choices", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  for (const label of [
    "1) Install",
    "2) Update",
    "3) Uninstall application (keep database)",
    "4) Uninstall application + database",
  ]) {
    assert.ok(installer.includes(label), `missing menu label: ${label}`);
  }
  assert.match(installer, /uninstall_keep_db/);
  assert.match(installer, /uninstall_all/);
  assert.match(installer, /backup_database/);
});

test("legacy module folders do not break core installation", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  assert.match(installer, /Ignoring legacy\/incomplete module folder/);
  assert.match(installer, /module_dirs/);
  assert.match(installer, /module\.env/);
  assert.doesNotMatch(installer, /Missing module\.env/);
});

test("module registry builder ignores folders without module.env", async () => {
  const builder = await fs.readFile(new URL("../../scripts/build-module-registry.py", import.meta.url), "utf8");
  assert.match(builder, /if not meta: continue/);
});
