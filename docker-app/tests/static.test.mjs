import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("graphical interface contains the required workflows", async () => {
  const [html, script] = await Promise.all([
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  for (const id of ["companiesButton", "ipamButton", "inventoryButton", "radiosButton", "networkMapButton", "companySelect", "spaceSelect", "companyDialog", "companyContacts", "companyConnections", "prefixDialog", "hostDialog", "hostPorts", "devicePortsList", "usersDialog", "spaceAccessList", "backupsDialog", "backupIntervalDays", "importDialog", "trashDialog", "aboutDialog", "mikrotikScriptDialog", "mapDialog", "toolMenu"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const behavior of ["renderVerticalTable", "renderIpGrid", "renderTreeView", "renderCompanies", "openCompanyPage", "renderInventory", "renderRadios", "renderTopology", "runPing", "openToolMenu", "connectEvents", "deleteCompany", "deleteSpace", "openTrashDialog"]) {
    assert.match(script, new RegExp(`function ${behavior}`));
  }
  assert.doesNotMatch(html, /id=["']hostPassword["']/);
  assert.doesNotMatch(html, /id=["']hostMonitorPassword["']/);
  assert.match(html, /رمز تجهیزات در سامانه ذخیره نمی‌شود/);
  assert.match(script, /delete-user/);
  assert.match(script, /emsipam:\/\/open/);
  assert.match(script, /\/api\/backups/);
  assert.match(script, /radioParentHostId/);
  assert.match(script, /beforeunload/);
  assert.match(script, /popstate/);
  assert.match(script, /url\.searchParams\.set\("username"/);
  assert.match(script, /function parseConnectionMethods/);
  assert.match(script, /WINBOX:8291, SSH:22, HTTPS:443/);
  assert.match(html, /ابراهیم مامانی/);
  assert.match(html, /github\.com\/emsebi\/EMS_IPAM/);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, "HTML ids must be unique");
});

test("browser modules are served with a JavaScript MIME type", async () => {
  const [server, html, script] = await Promise.all([
    fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(server, /["']\.mjs["']:\s*["']text\/javascript; charset=utf-8["']/);
  assert.match(html, /app\.js\?v=1\.5\.0-stage1-radio/);
  assert.match(html, /<html[^>]+data-theme=["']light["']/);
  assert.match(script, /subnet-model\.mjs\?v=1\.5\.0-stage1-radio/);
});

test("Windows client is downloadable from the installed web service", async () => {
  const [index, clientPage, clientArchive, readme] = await Promise.all([
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/client.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/downloads/EMS-IPAM-Windows-Client-v0.6.0.zip", import.meta.url)),
    fs.readFile(new URL("../../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(index, /id=["']clientDownloadButton["'][^>]+href=["']\/client\.html["']/);
  assert.match(clientPage, /\/downloads\/EMS-IPAM-Windows-Client-v0\.6\.0\.zip/);
  assert.equal(clientArchive.subarray(0, 2).toString("ascii"), "PK");
  assert.match(readme, /docs\/screenshots\/subnet-overview-concept\.png/);
  assert.match(readme, /Core \+ IPAM/);});
