import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("Network Access UI uses explicit translation keys and no Persian UI literals", async () => {
  const [moduleSource, appSource] = await Promise.all([
    read("../../modules/network-access/public/index.mjs"),
    read("../public/app.js"),
  ]);
  assert.match(appSource, /formatDateTime,translateTree,t,populateHostTypes/);
  assert.match(moduleSource, /networkAccess\.title/);
  assert.match(moduleSource, /networkAccess\.mac\.subtitle/);
  assert.match(moduleSource, /networkAccess\.personnel\.subtitle/);
  assert.doesNotMatch(moduleSource, /[\u0600-\u06FF]/);
});

test("Network Access keys exist in English and Persian catalogs", async () => {
  const [english, persian] = await Promise.all([
    read("../public/i18n/en.json").then(JSON.parse),
    read("../public/i18n/fa.json").then(JSON.parse),
  ]);
  const required = [
    "networkAccess.auth.adminOnly",
    "networkAccess.crumb",
    "networkAccess.title",
    "networkAccess.tab.mac",
    "networkAccess.tab.personnel",
    "networkAccess.mac.subtitle",
    "networkAccess.personnel.subtitle",
    "networkAccess.count",
    "networkAccess.action.managePersonnel",
    "networkAccess.column.mac",
    "networkAccess.column.ip",
    "networkAccess.column.device",
    "networkAccess.column.owner",
    "networkAccess.column.vlan",
    "networkAccess.column.name",
    "networkAccess.column.employeeCode",
    "networkAccess.column.department",
    "networkAccess.column.company",
    "networkAccess.column.actions",
    "networkAccess.empty",
    "common.previous",
    "common.next",
  ];
  for (const key of required) {
    assert.ok(english[key]?.trim(), `Missing English key: ${key}`);
    assert.ok(persian[key]?.trim(), `Missing Persian key: ${key}`);
  }
});
