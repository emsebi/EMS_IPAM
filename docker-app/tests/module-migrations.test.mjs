import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase, migrateModuleSchemas } from "../server/migrations.mjs";

function adapter(db) {
  const query = async (sql, params) => {
    const result = params?.length ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
    return { ...result, rows: result?.rows || [], rowCount: result?.rowCount ?? result?.affectedRows ?? result?.rows?.length ?? 0 };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

async function moduleDir(root, id, files) {
  const dir = path.join(root, id);
  await fs.mkdir(path.join(dir, "migrations"), { recursive: true });
  for (const [name, sql] of Object.entries(files)) await fs.writeFile(path.join(dir, "migrations", name), sql);
  return { id, dir };
}

test("module migrations apply once and preserve module data across restarts", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ems-module-migrations-"));
  try {
    await migrateDatabase(pool);
    const radius = await moduleDir(root, "radius", {
      "001-radius-foundation.sql": "CREATE TABLE radius_example(id text PRIMARY KEY, value text NOT NULL);",
    });
    const first = await migrateModuleSchemas(pool, [radius]);
    assert.deepEqual(first.failed, []);
    assert.deepEqual(first.applied, [{ moduleId: "radius", version: "001-radius-foundation" }]);
    await pool.query("INSERT INTO radius_example(id,value) VALUES($1,$2)", ["one", "preserve"]);
    const second = await migrateModuleSchemas(pool, [radius]);
    assert.deepEqual(second, { applied: [], failed: [] });
    assert.equal((await pool.query("SELECT value FROM radius_example WHERE id=$1", ["one"])).rows[0].value, "preserve");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE module_id='radius'")).rows[0].n, 1);
  } finally {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("modified applied migration fails closed for only that module", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ems-module-migrations-"));
  try {
    await migrateDatabase(pool);
    const radius = await moduleDir(root, "radius", {
      "001-radius-foundation.sql": "CREATE TABLE radius_checksum(id text PRIMARY KEY);",
    });
    assert.equal((await migrateModuleSchemas(pool, [radius])).failed.length, 0);
    await fs.writeFile(path.join(radius.dir, "migrations", "001-radius-foundation.sql"),
      "CREATE TABLE radius_checksum(id text PRIMARY KEY, changed text);");
    const result = await migrateModuleSchemas(pool, [radius]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].moduleId, "radius");
    assert.match(result.failed[0].error, /modified/);
  } finally {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("one broken module rolls back without blocking a healthy module", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ems-module-migrations-"));
  try {
    await migrateDatabase(pool);
    const broken = await moduleDir(root, "broken", {
      "001-broken.sql": "CREATE TABLE broken_partial(id text); THIS IS INVALID SQL;",
    });
    const healthy = await moduleDir(root, "healthy", {
      "001-healthy.sql": "CREATE TABLE healthy_module(id text PRIMARY KEY);",
    });
    const result = await migrateModuleSchemas(pool, [broken, healthy]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].moduleId, "broken");
    assert.deepEqual(result.applied, [{ moduleId: "healthy", version: "001-healthy" }]);
    assert.equal((await pool.query("SELECT to_regclass('public.broken_partial') AS table")).rows[0].table, null);
    assert.equal((await pool.query("SELECT to_regclass('public.healthy_module') AS table")).rows[0].table, "healthy_module");
  } finally {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("invalid SQL migration filenames disable the owning module", async () => {
  const db = new PGlite();
  const pool = adapter(db);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ems-module-migrations-"));
  try {
    await migrateDatabase(pool);
    const module = await moduleDir(root, "badname", { "latest.sql": "SELECT 1;" });
    const result = await migrateModuleSchemas(pool, [module]);
    assert.equal(result.failed[0].moduleId, "badname");
    assert.match(result.failed[0].error, /filename/);
  } finally {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
