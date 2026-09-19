import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("core schema keeps companies, address spaces, prefixes, hosts and scoped access", async () => {
  const schema = await fs.readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  for (const table of ["companies", "address_spaces", "prefixes", "hosts", "users", "user_company_access", "user_space_access", "audit_log", "app_settings"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test("core exposes IPAM, search, backup and generic module proxy", async () => {
  const server = await fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  for (const route of ["/api/search", "/api/backups", "/api/backups/settings", "/api/trash", "/api/imports/subnet", "/api/modules"]) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(server, /async function proxyModule/);
  assert.match(server, /x-ems-user-id/);
  assert.match(server, /EMS_MODULE_REGISTRY/);
  assert.doesNotMatch(server, /NETWORK_MAP_ENABLED/);
  assert.doesNotMatch(server, /proxyNetworkMap/);
});

test("destructive workflows keep their safety guards", async () => {
  const server = await fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  assert.match(server, /async function protectLastAdmin/);
  assert.match(server, /حداقل یک مدیر فعال باید در سامانه باقی بماند/);
  assert.match(server, /deleted_at=now\(\)/);
  assert.match(server, /runAutomaticBackup/);
  assert.match(server, /WITH RECURSIVE descendants/);
});
