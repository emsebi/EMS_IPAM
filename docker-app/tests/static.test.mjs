import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("core graphical interface exposes company and IP management plus module slot", async () => {
  const [html, script] = await Promise.all([
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  for (const id of ["companiesButton", "ipamButton", "modulesButton", "companySelect", "spaceSelect", "companyDialog", "prefixDialog", "hostDialog", "usersDialog", "backupsDialog", "importDialog", "trashDialog", "aboutDialog", "toolMenu"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const behavior of ["renderVerticalTable", "renderIpGrid", "renderTreeView", "renderCompanies", "openCompanyPage", "runPing", "connectEvents", "openModulesPage"]) {
    assert.match(script, new RegExp(`function ${behavior}`));
  }
  assert.doesNotMatch(html, /id=["']networkMapButton["']/);
  assert.doesNotMatch(html, /id=["']inventoryButton["']/);
  assert.doesNotMatch(html, /id=["']radiosButton["']/);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, "HTML ids must be unique");
});

test("browser assets use the core version", async () => {
  const [server, html, script] = await Promise.all([
    fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(server, /APP_VERSION = "0\.7\.0"/);
  assert.match(html, /app\.js\?v=0\.7\.0/);
  assert.match(html, /styles\.css\?v=0\.7\.0/);
  assert.match(script, /subnet-model\.mjs\?v=0\.7\.0/);
});
