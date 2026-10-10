import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("Settings device shortcuts are created once and respect access roles", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /function ensureSettingsDeviceActions\(\)/);
  assert.match(app, /if \(!pane \|\| \$\("settingsManageDevices"\)\) return/);
  assert.match(app, /"settingsManageDevices"\)\.addEventListener\("click"/);
  assert.match(app, /"settingsManageDeviceTypes"\)\.addEventListener\("click"/);
  assert.match(app, /"settingsManageDevices"\)\?\.classList\.toggle\("hidden", !hasClientModule\("inventory"\)\)/);
  assert.match(app, /"settingsManageDeviceTypes"\)\?\.classList\.toggle\("hidden", !isAdmin\(\)\)/);
});

test("Inventory create refuses to overwrite an already registered IP", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /requireEmpty && \(state\.data\.hosts \|\| \[\]\)\.some/);
  assert.match(app, /prepareHostEditor\(spaceId, ip, "inventory", \{\}, \{ requireEmpty: true \}\)/);
  assert.match(app, /inventory\.error\.ipAlreadyRegistered/);
  assert.match(app, /inventory\.error\.noSpaces/);
});

test("Settings and Inventory additions have English and Persian labels", async () => {
  const english = JSON.parse(await read("../public/i18n/en.json"));
  const persian = JSON.parse(await read("../public/i18n/fa.json"));
  for (const key of [
    "settings.general.manageDevices",
    "settings.general.manageDeviceTypes",
    "inventory.error.noSpaces",
    "inventory.error.ipAlreadyRegistered",
  ]) {
    assert.ok(english[key]?.trim(), `Missing English key: ${key}`);
    assert.ok(persian[key]?.trim(), `Missing Persian key: ${key}`);
  }
});
