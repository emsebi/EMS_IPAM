import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("schema keeps IP, radio, scoped access and topology in one database", async () => {
  const schema = await fs.readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  for (const table of ["user_space_access", "device_ports", "topology_maps", "topology_nodes", "topology_links"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const column of ["radio_mode", "ssid", "radio_parent_host_id", "connection_methods"]) {
    assert.match(schema, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
});

test("server exposes inventory, global search, topology and downloadable backups", async () => {
  const server = await fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  for (const route of ["/api/search", "/api/inventory", "/api/backups", "/api/maps"]) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(server, /createBackupFile/);
  assert.match(server, /Content-Disposition/);
  assert.match(server, /canAccessSpace/);
  assert.match(server, /canAccessSpace\(user, item\.spaceId\)/);
  assert.match(server, /ON CONFLICT\(id\) DO UPDATE SET space_id=excluded\.space_id,ip=excluded\.ip/);
});
