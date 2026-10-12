import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase, migrateModuleSchemas } from "../server/migrations.mjs";

function adapter(db) {
  const query = async (sql, params) => {
    const result = params?.length ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
    return { ...result, rows: result?.rows || [], rowCount: result?.rowCount ?? result?.affectedRows ?? result?.rows?.length ?? 0 };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

const radiusDir = fileURLToPath(new URL("../../modules/radius/", import.meta.url));

test("RADIUS owns its schema migration and applies it through the generic module runner", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  try {
    await migrateDatabase(pool);
    const result = await migrateModuleSchemas(pool, [{ id: "radius", dir: radiusDir }]);
    assert.deepEqual(result.failed, []);
    assert.ok(result.applied.some((item) => item.version === "001-radius-foundation"));
    for (const table of ["radius_nas_profiles", "radius_admin_profiles", "radius_mab_policies"]) {
      assert.equal((await pool.query("SELECT to_regclass($1) AS name", [`public.${table}`])).rows[0].name, table);
    }
    assert.equal((await migrateModuleSchemas(pool, [{ id: "radius", dir: radiusDir }])).applied.length, 0);
  } finally {
    await db.close();
  }
});

test("RADIUS schema has no credential-bearing columns", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  try {
    await migrateDatabase(pool);
    await migrateModuleSchemas(pool, [{ id: "radius", dir: radiusDir }]);
    const columns = (await pool.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name LIKE 'radius_%'`)).rows;
    const forbidden = columns.filter((row) => /(secret|password|token|credential)/i.test(row.column_name));
    assert.deepEqual(forbidden, []);
  } finally {
    await db.close();
  }
});

test("RADIUS NAS uniqueness and MAB policy constraints fail closed in the database", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  try {
    await migrateDatabase(pool);
    await migrateModuleSchemas(pool, [{ id: "radius", dir: radiusDir }]);
    await pool.query("INSERT INTO companies(id,name) VALUES('co-a','A')");
    await pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('space-a','co-a','LAN','192.0.2.0/24')");
    await pool.query("INSERT INTO hosts(id,space_id,ip,name) VALUES('sw-1','space-a','192.0.2.10','SW1'),('sw-2','space-a','192.0.2.11','SW2')");
    await pool.query(`INSERT INTO radius_nas_profiles(id,company_id,device_id,name,vendor,nas_ip,services)
      VALUES('nas-1','co-a','sw-1','SW1','cisco','192.0.2.10','["mab"]'::jsonb)`);
    await assert.rejects(() => pool.query(`INSERT INTO radius_nas_profiles(id,company_id,device_id,name,vendor,nas_ip,services)
      VALUES('nas-2','co-a','sw-2','SW2','cisco','192.0.2.10','["mab"]'::jsonb)`));
    await assert.rejects(() => pool.query(`INSERT INTO radius_mab_policies(id,nas_profile_id,enabled,known_mode)
      VALUES('policy-1','nas-1',true,'accept-dynamic')`));
  } finally {
    await db.close();
  }
});
