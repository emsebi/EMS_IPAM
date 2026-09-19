import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const installerUrl = new URL("../../install.sh", import.meta.url);

test("installer keeps core and modules loosely coupled", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  assert.match(installer, /emsebi\/EMS_IPAM/);
  assert.match(installer, /module_dirs/);
  assert.match(installer, /module\.env/);
  assert.match(installer, /compose\.module\.yml/);
  assert.match(installer, /build-module-registry\.py/);
  assert.doesNotMatch(installer, /modules\.conf/);
});

test("setup exposes lifecycle operations and module configuration", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  for (const label of ["Install", "Update", "Backup Database", "Restore Database", "Enable/Disable Modules", "Uninstall App", "Uninstall All"]) {
    assert.match(installer, new RegExp(label.replace(/[()+]/g, "\\$&"), "i"));
  }
  assert.match(installer, /backup_database/);
  assert.match(installer, /update_app/);
  assert.match(installer, /configure_modules/);
});

test("module registry builder discovers folders and hides upstream from public API in core", async () => {
  const [builder, server] = await Promise.all([
    fs.readFile(new URL("../../scripts/build-module-registry.py", import.meta.url), "utf8"),
    fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(builder, /modules/);
  assert.match(builder, /EMS_MODULE_UPSTREAM/);
  assert.match(server, /map\(\(\{ upstream, \.\.\.item \}\) => item\)/);
});
