import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("graphical interface contains the required workflows", async () => {
  const [html, script] = await Promise.all([
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  for (const id of ["companySelect", "spaceSelect", "prefixDialog", "hostDialog", "hostPorts", "devicePortsList", "usersDialog", "spaceAccessList", "backupsDialog", "mapDialog", "toolMenu"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const behavior of ["renderVerticalTable", "renderIpGrid", "renderTreeView", "renderRadios", "renderTopology", "runPing", "openToolMenu", "connectEvents", "deleteCompany", "deleteSpace"]) {
    assert.match(script, new RegExp(`function ${behavior}`));
  }
  assert.match(html, /id=["']hostPassword["']/);
  assert.match(script, /delete-user/);
  assert.match(script, /emsipam:\/\/open/);
  assert.match(script, /\/api\/backups/);
  assert.match(script, /radioParentHostId/);
});
