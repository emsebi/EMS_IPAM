import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const installerUrl = new URL("../../install.sh", import.meta.url);

test("installer uses the official repository and ASCII terminal messages", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  assert.match(installer, /emsebi\/EMS_IPAM/);
  assert.doesNotMatch(installer, /emssebi\/EMS_IPAM/);
  assert.doesNotMatch(installer, /[\u0600-\u06ff]/);
});

test("installer validates GitHub archive before extraction", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  assert.match(installer, /local archive="\$TMP_ROOT\/source\.tar\.gz"/);
  assert.match(installer, /curl[^\n]+--output "\$archive"/);
  assert.match(installer, /tar -tzf "\$archive"/);
  assert.match(installer, /Downloaded GitHub archive is invalid/);
});

test("installer exposes exactly the four supported lifecycle actions and asks fresh secrets", async () => {
  const installer = await fs.readFile(installerUrl, "utf8");
  for (const label of ["1) Install", "2) Update", "3) Uninstall application (keep database)", "4) Uninstall application + database"]) assert.match(installer, new RegExp(label.replace(/[()+]/g, "\\$&")));
  assert.match(installer, /read_secret_twice db_pass "Database password"/);
  assert.match(installer, /read_secret_twice admin_pass "Admin password"/);
  assert.match(installer, /Preserved database and configuration found/);
  assert.match(installer, /Creating mandatory pre-update database backup/);
  assert.match(installer, /Update failed; restoring previous application files/);
  assert.match(installer, /Update cancelled without changing application files/);
  assert.match(installer, /\[\[ -s "\$tmp" \]\]/);
  const updateBlock = installer.match(/update_app\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(updateBlock, /down -v/);
  assert.match(installer, /modules\/\*\/compose\.module\.yml/);
  assert.match(installer, /module\.json/);
  assert.doesNotMatch(installer, /EMS_SECRET_KEY/);
});

test("Windows connection client auto-detects tools and passes usernames without passwords", async () => {
  const [protocol, setup] = await Promise.all([
    fs.readFile(new URL("../../windows-client/EMS-IPAM-Protocol.ps1", import.meta.url), "utf8"),
    fs.readFile(new URL("../../windows-client/Install-EMS-Client.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(protocol, /App Paths/);
  assert.match(protocol, /Select-ToolFile/);
  assert.match(protocol, /usernameValue/);
  assert.doesNotMatch(protocol, /query\['password'\]/);
  assert.match(setup, /URL:EMS IPAM Client/);
});
