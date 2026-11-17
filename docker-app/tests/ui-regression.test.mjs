import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DETAIL_PREFIXES, detailGroups, rootVerticalLevels, tableBlockCount, treeDepth, visibleTableCount, usageSegments } from "../public/subnet-model.mjs";

test("every root size uses the same vertical subnet model", () => {
  assert.deepEqual(rootVerticalLevels(16), [23, 22, 21, 20, 19, 18, 17, 16]);
  assert.deepEqual(rootVerticalLevels(21), [23, 22, 21]);
  assert.deepEqual(rootVerticalLevels(23), [23]);
  assert.deepEqual(rootVerticalLevels(24), []);
  assert.equal(tableBlockCount(16), 256);
  assert.equal(tableBlockCount(21), 8);
  assert.equal(tableBlockCount(22), 4);
  assert.equal(tableBlockCount(23), 2);
  assert.equal(tableBlockCount(24), 1);
  assert.equal(visibleTableCount(tableBlockCount(16), 8), 8);
});

test("vertical detail boundaries start at zero and end at 255", () => {
  assert.deepEqual(DETAIL_PREFIXES, [30, 29, 28, 27, 26, 25, 24]);
  assert.deepEqual(detailGroups(30).slice(0, 2), [
    { start: 0, end: 3, size: 4 },
    { start: 4, end: 7, size: 4 },
  ]);
  assert.deepEqual(detailGroups(29).slice(0, 2), [
    { start: 0, end: 7, size: 8 },
    { start: 8, end: 15, size: 8 },
  ]);
  assert.deepEqual(detailGroups(28).slice(0, 2), [
    { start: 0, end: 15, size: 16 },
    { start: 16, end: 31, size: 16 },
  ]);
  assert.deepEqual(detailGroups(24), [{ start: 0, end: 255, size: 256 }]);
});

test("tree reaches individual IPs and the UI keeps all requested modes", async () => {
  assert.equal(treeDepth(16), 4);
  assert.equal(treeDepth(28), 4);
  assert.equal(treeDepth(30), 2);
  assert.equal(treeDepth(32), 0);
  const [script, css] = await Promise.all([
    fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(script, /detailTables\("table", visibleBlockCount\)/);
  assert.match(script, /ems-display-mode"\) \|\| "table"/);
  assert.doesNotMatch(script, /selected\.prefix === 23 \|\| selected\.prefix === 24/);
  assert.match(script, /sheet-context/);
  assert.match(script, /existingPrefixAt/);
  assert.match(script, /range-label-action/);
  assert.match(script, /root-row-open,.root-prefix-open/);
  assert.match(script, /prevHostButton/);
  assert.match(script, /nextHostButton/);
  assert.match(script, /renderModuleNavigation/);
  assert.match(script, /collectHostCustomFields/);
  assert.match(script, /defaultGatewayForCidr/);
  assert.match(script, /localStorage\.getItem\("ems-theme"\) \|\| "light"/);
  assert.match(script, /function applyTheme/);
  assert.match(script, /event\?\.stopPropagation\?\.\(\)/);
  assert.match(script, /normalizedConnectionMethods/);
  assert.match(css, /vertical-subnet-table\{[^}]*direction:ltr/);
  assert.match(css, /tree-scroll\{[^}]*overflow:scroll/);
  assert.match(css, /subnet-span\.prefix-28/);
  assert.match(css, /\.table-prefix\.named\{background:transparent!important/);
  assert.match(css, /\[data-theme="dark"\] \.vertical-subnet-table td/);
});

test("spatial usage bar shows actual /24 positions, and prefixes alone are pale", () => {
  const segments = usageSegments("10.1.0.0/22", [{cidr:"10.1.1.0/24",color:"#229944",status:"active"}],
    [{ip:"10.1.1.10",status:"active"},{ip:"10.1.3.90",status:"active"}]);
  assert.equal(segments.length,4);
  assert.deepEqual(segments.map((item) => item.count),[0,1,0,1]);
  assert.equal(segments[1].allocated,true);
  assert.equal(segments[1].color,"#229944");
  assert.equal(segments[3].allocated,false);
});
test("IPAM preview and layout controls exist without replacing portable import", async () => {
  const [script,css,html,server] = await Promise.all([
    fs.readFile(new URL("../public/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../public/styles.css",import.meta.url),"utf8"),
    fs.readFile(new URL("../public/index.html",import.meta.url),"utf8"),
    fs.readFile(new URL("../server/main.mjs",import.meta.url),"utf8"),
  ]);
  assert.match(html,/id="bulkIpamDialog"/);
  assert.match(script,/\/api\/imports\/ipam\/preview/);
  assert.match(server,/\/api\/imports\/subnet/);
  assert.match(css,/\.root-table-container\{height:auto!important/);
  assert.match(css,/\.app\.sidebar-collapsed/);
});
