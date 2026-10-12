import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createModule } from "../../modules/radius/backend/index.mjs";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

function harness(body) {
  let response;
  const module = createModule({
    json: (_res, status, value) => { response = { status, value }; return response; },
    readBody: async (req) => req.body,
    requireAdmin: (user) => { if (user?.role !== "admin") throw Object.assign(new Error("forbidden"), { status: 403 }); },
    requireModuleAccess: async (_user, id) => { assert.equal(id, "radius"); },
  });
  return { module, req: { method: "POST", body }, res: {}, user: { role: "admin" }, response: () => response };
}

test("RADIUS manifest is a self-contained panel module", async () => {
  const manifest = JSON.parse(await read("../../modules/radius/module.json"));
  assert.equal(manifest.id, "radius");
  assert.equal(manifest.navigation.panel, true);
  assert.equal(manifest.backend, "backend/index.mjs");
  assert.deepEqual(manifest.roles, ["admin"]);
});

test("MAB preview endpoint uses the fail-closed evaluator", async () => {
  const h = harness({
    mac: "02:00:00:00:00:50",
    knownMacs: [{ mac: "02:00:00:00:00:50", enabled: true, vlan: 20 }],
    policy: { enabled: true, known: { mode: "accept-dynamic" }, unknown: { mode: "reject" } },
    switchId: "sw-1",
  });
  const url = new URL("http://test/api/radius/preview/mab");
  assert.equal(h.module.match(h.req, url), true);
  await h.module.handle(h.req, h.res, url, h.user);
  assert.equal(h.response().status, 200);
  assert.equal(h.response().value.status, "preview-only");
  assert.equal(h.response().value.result.reason, "known-dynamic-vlan");
});

test("device admin preview exposes Cisco privilege without authentication claims", async () => {
  const h = harness({ vendor: "cisco", profile: { enabled: true, ciscoPrivilege: 15 } });
  const url = new URL("http://test/api/radius/preview/admin-profile");
  await h.module.handle(h.req, h.res, url, h.user);
  assert.equal(h.response().value.result.replyAttributes["Cisco-AVPair"], "shell:priv-lvl=15");
  assert.equal(Object.hasOwn(h.response().value.result, "authenticated"), false);
});

test("matrix endpoint returns only redacted result rows", async () => {
  const inventory = [{ mac: "02:00:00:00:00:50", enabled: true, vlan: 20 }];
  const policy = { enabled: true, known: { mode: "accept-dynamic" }, unknown: { mode: "reject" } };
  const h = harness({ cases: [{ label: "known", input: { mac: inventory[0].mac, knownMacs: inventory, policy, switchId: "sw-1" }, expectedDecision: "accept" }] });
  const url = new URL("http://test/api/radius/preview/mab-matrix");
  await h.module.handle(h.req, h.res, url, h.user);
  const serialized = JSON.stringify(h.response().value.result);
  assert.equal(serialized.includes(inventory[0].mac), false);
  assert.equal(serialized.includes("sw-1"), false);
});

test("RADIUS UI owns its translations and contains no Persian literals", async () => {
  const [ui, english, persian] = await Promise.all([
    read("../../modules/radius/public/index.mjs"),
    read("../../modules/radius/public/i18n/en.json").then(JSON.parse),
    read("../../modules/radius/public/i18n/fa.json").then(JSON.parse),
  ]);
  assert.match(ui, /radius\.mab\.title/);
  assert.match(ui, /\/api\/radius\/preview\/mab/);
  assert.doesNotMatch(ui, /[\u0600-\u06FF]/);
  for (const key of Object.keys(english)) assert.ok(persian[key]?.trim(), `Missing Persian module key: ${key}`);
});


test("NAS draft endpoint resolves the device from EMS inventory and emits only comments", async () => {
  let response;
  const module = createModule({
    pool: { query: async (_sql, values) => ({ rowCount: 1, rows: [{ id: values[0], companyId: "co-a", ip: "192.0.2.10" }] }) },
    json: (_res, status, value) => { response = { status, value }; return response; },
    readBody: async (req) => req.body,
    requireAdmin: () => {},
    requireModuleAccess: async () => {},
  });
  const req = { method: "POST", body: { profile: {
    id: "nas-1", companyId: "co-a", deviceId: "sw-1", name: "Lab NAS",
    vendor: "cisco", nasIp: "192.0.2.10", enabled: false, services: ["mab"],
  } } };
  const url = new URL("http://test/api/radius/preview/nas-client");
  await module.handle(req, {}, url, { role: "admin" });
  assert.equal(response.status, 200);
  assert.equal(response.value.result.status, "draft-only");
  for (const line of response.value.result.text.split("\n").filter(Boolean)) assert.ok(line.startsWith("#"));
});

test("NAS draft endpoint rejects a client-supplied IP that differs from EMS inventory", async () => {
  let response;
  const module = createModule({
    pool: { query: async () => ({ rowCount: 1, rows: [{ id: "sw-1", companyId: "co-a", ip: "192.0.2.10" }] }) },
    json: (_res, status, value) => { response = { status, value }; return response; },
    readBody: async (req) => req.body,
    requireAdmin: () => {},
    requireModuleAccess: async () => {},
  });
  const req = { method: "POST", body: { profile: {
    id: "nas-1", companyId: "co-a", deviceId: "sw-1", name: "Lab NAS",
    vendor: "cisco", nasIp: "192.0.2.11", enabled: false, services: ["mab"],
  } } };
  await module.handle(req, {}, new URL("http://test/api/radius/preview/nas-client"), { role: "admin" });
  assert.deepEqual(response.value.result.issues, ["nas-ip-device-mismatch"]);
});
