import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("schema keeps companies, IP, monitoring, scoped access and topology in one database", async () => {
  const schema = await fs.readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  for (const table of ["company_contacts", "company_connections", "app_settings", "user_space_access", "device_ports", "topology_maps", "topology_nodes", "topology_links", "mikrotik_backup_targets", "mikrotik_config_backups", "online_report_targets", "online_report_runs", "online_report_results", "integration_tokens"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const column of ["parent_company_id", "deleted_at", "radio_mode", "ssid", "radio_parent_host_id", "connection_methods", "monitor_enabled", "monitor_state", "backup_enabled", "backup_ssh_port", "backup_username", "backup_routeros_version"]) {
    assert.match(schema, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
});

test("server exposes inventory, global search, topology and downloadable backups", async () => {
  const server = await fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  for (const route of ["/api/search", "/api/inventory", "/api/backups", "/api/backups/settings", "/api/config-backups", "/api/online-reports", "/api/integrations/network-map", "/api/integration/v1/snapshot", "/api/integration/v1/hosts/sync", "/api/settings/appearance", "/api/trash", "/api/imports/subnet", "/api/mikrotik/script", "/api/maps"]) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(server, /createBackupFile/);
  assert.match(server, /Content-Disposition/);
  assert.match(server, /canAccessSpace/);
  assert.match(server, /canAccessSpace\(user, item\.spaceId\)/);
  assert.match(server, /ON CONFLICT\(id\) DO UPDATE SET space_id=excluded\.space_id,ip=excluded\.ip/);
});

test("native VNC viewer uses its standard default port", async () => {
  const database = await fs.readFile(new URL("../server/db.mjs", import.meta.url), "utf8");
  assert.match(database, /\["VNC",\s*"VNC",\s*5900/);
});

test("destructive and scoped workflows keep their safety guards", async () => {
  const server = await fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  assert.match(server, /async function protectLastAdmin/);
  assert.match(server, /protectLastAdmin\(client, userUpdate\[1\], role, body\.active !== false\)/);
  assert.match(server, /protectLastAdmin\(client, userUpdate\[1\], null, false\)/);
  assert.match(server, /حداقل یک مدیر فعال باید در سامانه باقی بماند/);
  assert.match(server, /radioParentHostId/);
  assert.match(server, /h\.radio_mode='ap'/);
  assert.match(server, /canAccessSpace\(user, item\.spaceId\)/);
  assert.match(server, /pg_dump/);
  assert.match(server, /EMS_SECRET_KEY/);
  assert.match(server, /deleted_at=now\(\)/);
  assert.match(server, /runAutomaticBackup/);
  assert.match(server, /runMonitoringCycle/);
  assert.match(server, /runOnlineReportCycle/);
  assert.match(server, /runMikrotikBackup/);
  assert.match(server, /attempts: 3/);
  assert.match(server, /passwordById/);
  assert.doesNotMatch(server, /mikrotik_backup_targets[^;]*password/is);
  assert.match(server, /ابتدا شرکت‌ها یا شعبه‌های زیرمجموعه را حذف یا جابه‌جا کنید/);
  assert.match(server, /WITH RECURSIVE descendants/);
});
