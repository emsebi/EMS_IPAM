import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { viewportMapHeight } from "../public/subnet-model.mjs";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("personnel creation requires only full name", async () => {
  const [html, app, server, schema] = await Promise.all([
    read("../public/index.html"), read("../public/app.js"), read("../server/main.mjs"), read("../server/schema.sql"),
  ]);
  assert.doesNotMatch(html, /id="personnelCode" required/);
  assert.match(html, /id="personnelName" required/);
  assert.match(app, /\$\("personnelForm"\)\.addEventListener\("submit"/);
  assert.match(server, /if \(!fullName\) throw new Error\("نام و نام خانوادگی الزامی است\."\)/);
  assert.match(schema, /ALTER TABLE personnel ALTER COLUMN employee_code DROP NOT NULL/);
});

test("inventory create and edit use a loaded host editor and report save errors", async () => {
  const [html, app, server] = await Promise.all([read("../public/index.html"), read("../public/app.js"), read("../server/main.mjs")]);
  assert.match(app, /async function prepareHostEditor/);
  assert.match(app, /prepareHostEditor\(item\.spaceId, item\.ip, "inventory"\)/);
  assert.match(app, /prepareHostEditor\(spaceId, ip, "inventory", \{\}, \{ requireEmpty: true \}\)/);
  assert.match(app, /request\("\/api\/hosts", \{ method: "PUT", body \}\)/);
  assert.match(server, /req\.method === "PUT" && pathname === "\/api\/hosts"/);
  assert.match(html, /id="hostFormError"/);
});

test("station shortcut keeps the AP selected", async () => {
  const app = (await read("../public/app.js")) + (await read("../../modules/radio/public/index.mjs"));
  assert.match(app, /radioParentHostId: mode === "station" \? parentId : null/);
  assert.match(app, /openHostDialog\(ip, overrides = \{\}\)/);
  assert.match(app, /const selectedParent = value\.radioParentHostId \|\| ""/);
});

test("IPAM remembers the exact space and sheet across module navigation", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /ems-last-ipam-space/);
  assert.match(app, /ems-last-ipam-sheet/);
  assert.match(app, /state\.lastIpamView === "sheet" \? state\.lastIpamSheetCidr : null/);
});

test("larger viewport exposes more IP rows", () => {
  assert.equal(viewportMapHeight(1080, 200), 856);
  assert.equal(viewportMapHeight(1440, 200), 1216);
  assert.ok(viewportMapHeight(1440, 200) > viewportMapHeight(1080, 200));
  assert.equal(viewportMapHeight(500, 200), 420, "desktop minimum remains usable");
});

test("WinBox uses the repaired client protocol and receives only target", async () => {
  const [app, protocol, installer] = await Promise.all([
    read("../public/app.js"), read("../../windows-client/EMS-IPAM-Common.ps1"), read("../../windows-client/Install-EMS-Client.ps1"),
  ]);
  assert.match(app, /new URL\("emsipam-client:\/\/open"\)/);
  assert.match(protocol, /'winbox' \{ @\(\$target\) \}/);
  assert.doesNotMatch(protocol, /Start-Process[^\n]*UriValue/);
  assert.match(installer, /Register-EmsProtocol 'emsipam-client'/);
  assert.doesNotMatch(installer, /\\n# Verify/);
});
