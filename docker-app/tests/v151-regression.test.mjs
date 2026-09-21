import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const ps=fs.readFileSync(new URL("../../windows-client/EMS-IPAM-Protocol.ps1",import.meta.url),"utf8");
test("translations are file based",()=>{
  assert.ok(app.includes('/i18n/${encodeURIComponent(lang)}.json'));
  assert.ok(fs.existsSync(new URL("../public/i18n/en.json",import.meta.url)));
  assert.ok(fs.existsSync(new URL("../public/i18n/fa.json",import.meta.url)));
});
test("inventory create and edit path exists",()=>{
  assert.match(html,/inventoryCreateDialog/);
  assert.match(app,/newInventoryDevice/);
  assert.match(app,/openInventoryItem/);
});
test("winbox receives target not emsipam uri",()=>{
  assert.ok(ps.includes("'winbox' { @($target) }"));
  assert.ok(!/Start-Process[^\n]*UriValue/.test(ps));
});
