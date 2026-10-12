import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase, migrateModuleSchemas } from "../server/migrations.mjs";
import { createModule } from "../../modules/radius/backend/index.mjs";

function adapter(db) {
  const query = async (sql, params) => {
    const result = params?.length ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
    return { ...result, rows: result?.rows || [], rowCount: result?.rowCount ?? result?.affectedRows ?? result?.rows?.length ?? 0 };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}
const radiusDir = fileURLToPath(new URL("../../modules/radius/", import.meta.url));

function moduleFor(pool) {
  let last;
  return {
    handler: createModule({
      pool,
      json: (_res, status, value) => { last = { status, value }; return last; },
      readBody: async (req) => req.body,
      requireAdmin: (user) => { if (user?.role !== "admin") throw Object.assign(new Error("forbidden"), { status: 403 }); },
      requireModuleAccess: async (_user, id) => assert.equal(id, "radius"),
      audit: async () => {},
      broadcast: () => {},
    }),
    result: () => last,
  };
}

async function call(api, method, pathname, body) {
  const req = { method, body };
  const url = new URL(`http://test${pathname}`);
  assert.equal(api.handler.match(req, url), true);
  await api.handler.handle(req, {}, url, { role: "admin" });
  return api.result();
}

async function fixture() {
  const db = new PGlite();
  const pool = adapter(db);
  await migrateDatabase(pool);
  await migrateModuleSchemas(pool, [{ id: "radius", dir: radiusDir }]);
  await pool.query("INSERT INTO companies(id,name) VALUES('co-a','A')");
  await pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('space-a','co-a','LAN','192.0.2.0/24')");
  await pool.query("INSERT INTO hosts(id,space_id,ip,name) VALUES('sw-1','space-a','192.0.2.10','SW1'),('sw-2','space-a','192.0.2.11','SW2')");
  return { db, pool, api: moduleFor(pool) };
}

test("NAS profiles create, list, update and delete without credential fields", async () => {
  const f = await fixture();
  try {
    const profile = { id: "nas-1", companyId: "co-a", deviceId: "sw-1", name: "Core",
      vendor: "cisco", nasIp: "192.0.2.10", enabled: false, services: ["mab"] };
    assert.equal((await call(f.api, "POST", "/api/radius/nas-profiles", profile)).status, 201);
    const listed = await call(f.api, "GET", "/api/radius/nas-profiles");
    assert.equal(listed.value.items.length, 1);
    assert.equal(JSON.stringify(listed.value).includes("secret"), false);
    assert.equal((await call(f.api, "PUT", "/api/radius/nas-profiles/nas-1",
      { ...profile, name: "Core Updated", enabled: true, services: ["mab", "dot1x"] })).value.item.name, "Core Updated");
    assert.equal((await call(f.api, "DELETE", "/api/radius/nas-profiles/nas-1")).status, 200);
    assert.equal((await call(f.api, "GET", "/api/radius/nas-profiles")).value.items.length, 0);
  } finally { await f.db.close(); }
});

test("NAS profile persistence binds source IP and company to the selected EMS device", async () => {
  const f = await fixture();
  try {
    const base = { id: "nas-1", companyId: "co-a", deviceId: "sw-1", name: "Core",
      vendor: "cisco", nasIp: "192.0.2.10", enabled: false, services: ["mab"] };
    await assert.rejects(() => call(f.api, "POST", "/api/radius/nas-profiles", { ...base, nasIp: "192.0.2.11" }), /match/);
    await assert.rejects(() => call(f.api, "POST", "/api/radius/nas-profiles", { ...base, companyId: "other" }), /Invalid NAS profile/);
    await assert.rejects(() => call(f.api, "POST", "/api/radius/nas-profiles", { ...base, secret: "forbidden" }), /Invalid NAS profile/);
  } finally { await f.db.close(); }
});

test("device administrator profiles persist Cisco privilege and MikroTik group separately", async () => {
  const f = await fixture();
  try {
    const profile = { id: "support", name: "Support", description: "NOC support",
      ciscoPrivilege: 7, mikrotikGroup: "read", enabled: true };
    assert.equal((await call(f.api, "POST", "/api/radius/admin-profiles", profile)).status, 201);
    let listed = await call(f.api, "GET", "/api/radius/admin-profiles");
    assert.deepEqual(listed.value.items[0], profile);
    const updated = await call(f.api, "PUT", "/api/radius/admin-profiles/support", { ...profile, ciscoPrivilege: 15, mikrotikGroup: "full" });
    assert.equal(updated.value.item.ciscoPrivilege, 15);
    assert.equal(updated.value.item.mikrotikGroup, "full");
    await call(f.api, "DELETE", "/api/radius/admin-profiles/support");
    listed = await call(f.api, "GET", "/api/radius/admin-profiles");
    assert.equal(listed.value.items.length, 0);
  } finally { await f.db.close(); }
});

test("administrator profile validation rejects implicit state and injected fields", async () => {
  const f = await fixture();
  try {
    const base = { id: "support", name: "Support", description: "", ciscoPrivilege: 7, mikrotikGroup: "read", enabled: true };
    await assert.rejects(() => call(f.api, "POST", "/api/radius/admin-profiles", { ...base, enabled: "true" }), /explicit/);
    await assert.rejects(() => call(f.api, "POST", "/api/radius/admin-profiles", { ...base, password: "x" }), /Unsupported/);
    await assert.rejects(() => call(f.api, "POST", "/api/radius/admin-profiles", { ...base, ciscoPrivilege: 16 }), /between 0 and 15/);
  } finally { await f.db.close(); }
});
