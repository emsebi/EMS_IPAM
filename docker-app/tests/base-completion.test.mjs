import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = async (path) => {
  let text=await fs.readFile(new URL(path, import.meta.url), "utf8");
  if(path==="../public/app.js") text+=await fs.readFile(new URL("../../modules/radio/public/index.mjs",import.meta.url),"utf8");
  if(path==="../server/main.mjs") text+=await fs.readFile(new URL("../../modules/radio/backend/index.mjs",import.meta.url),"utf8");
  return text;
};

test("BASE navigation and restricted branch role are wired end to end", async () => {
  const [html, app, server, schema] = await Promise.all([
    read("../public/index.html"),
    read("../public/app.js"),
    read("../server/main.mjs"),
    read("../server/schema.sql"),
  ]);
  assert.doesNotMatch(html, /id="personnelButton"/);
  assert.match(html, /id="networkAccessButton"/);
  assert.match(html, /option value="branch"/);
  assert.match(app, /role === "branch" \? "Branch"/);
  assert.match(server, /"branch"/);
  assert.match(schema, /'admin','support','helpdesk','branch','viewer'/);
});

test("module capabilities are not mistaken for user roles", async () => {
  const [app, server, manifest] = await Promise.all([
    read("../public/app.js"),
    read("../server/main.mjs"),
    read("../../modules/radio/module.json"),
  ]);
  assert.match(app, /item\.roles/);
  assert.doesNotMatch(app, /item\.permissions\.includes\(role\)/);
  assert.match(server, /module\.roles/);
  assert.match(server, /manifest\.permissions/);
  assert.deepEqual(JSON.parse(manifest).permissions, ["radio.read", "radio.write"]);
});

test("Inventory company scope and Radio actions have distinct paths", async () => {
  const [app, server] = await Promise.all([read("../public/app.js"), read("../server/main.mjs")]);
  assert.match(app, /item\.companyId === state\.currentCompanyId/);
  assert.match(app, /companyId=\$\{encodeURIComponent\(state\.currentCompanyId/);
  assert.match(server, /url\.searchParams\.get\("companyId"\)/);
  assert.match(app, /function openRadioEditor/);
  assert.match(app, /function openRadioInIpam/);
  assert.match(app, /function pingRadio/);
  assert.match(server, /pathname === "\/api\/ping\/host"/);
  assert.match(app, /pingOnline/);
});

test("only Persian and English languages are registered", async () => {
  const languages = JSON.parse(await read("../public/i18n/languages.json"));
  assert.deepEqual(languages.map((item) => item.id).sort(), ["en", "fa"]);
});

test("Portainer stack matches the BASE IPAM Radio release", async () => {
  const stack = await read("../../portainer-stack.yml");
  assert.match(stack, /ems-ipam-base:1\.7\.0-rc\.1/);
  assert.match(stack, /\.\/modules:\/modules:ro/);
  assert.doesNotMatch(stack, /EMS_SECRET_KEY|modules\/network-map|modules\/radius/);
});
