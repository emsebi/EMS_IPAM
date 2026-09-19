import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { currentUser, requireAdmin, requireWriter, canAccessCompany, canManageCompany } from "./auth.mjs";
import { discoverNetwork, mergeRefreshedDevice, readRunningConfiguration, readSingleDevice } from "./discovery.mjs";
import { diffLines } from "./diff.mjs";
import { assertNoSubmittedSecrets, sanitizeConfiguration } from "./sanitize.mjs";
import { normalizeInterface, normalizeMac, validIpv4 } from "./parsers.mjs";
import { decryptSecret } from "./secret.mjs";

const { Pool } = pg;
const PORT = Number(process.env.PORT || 8090);
const APP_VERSION = "0.7.0";
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL || undefined, max: 12, idleTimeoutMillis: 30_000 });
const execFileAsync = promisify(execFile);
const jobs = new Map();

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function errorResponse(res, status, message) {
  return json(res, status, { ok: false, error: message });
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("اندازه درخواست بیش از حد مجاز است.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("ساختار درخواست معتبر نیست."); }
}

function safeFilename(value, fallback = "switch") {
  return cleanText(value, 80).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function csrfAllowed(req) {
  return !["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.headers["x-ems-csrf"] === "1";
}

async function waitForDatabase() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try { await pool.query("SELECT 1"); return; }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 5000))); }
  }
  throw lastError;
}

await waitForDatabase();
await pool.query(await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8"));

async function audit(user, action, entityType, entityId, { companyId = null, detail = {} } = {}) {
  await pool.query(
    "INSERT INTO audit_log(user_id,action,entity_type,entity_id,company_id,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [user?.id || null, action, entityType, entityId || null, companyId, JSON.stringify(detail)],
  );
}

async function listCompanies(user) {
  if (["admin", "technical", "helpdesk", "editor"].includes(user.role)) return (await pool.query(
    "SELECT id,name,kind,true AS manageable FROM companies WHERE deleted_at IS NULL ORDER BY name",
  )).rows;
  return (await pool.query(
    `SELECT DISTINCT c.id,c.name,c.kind,(uca.user_id IS NOT NULL) AS manageable FROM companies c
       LEFT JOIN user_company_access uca ON uca.company_id=c.id AND uca.user_id=$1
       LEFT JOIN address_spaces s ON s.company_id=c.id AND s.deleted_at IS NULL
       LEFT JOIN user_space_access usa ON usa.space_id=s.id AND usa.user_id=$1
      WHERE c.deleted_at IS NULL AND (uca.user_id IS NOT NULL OR usa.user_id IS NOT NULL)
      ORDER BY c.name`,
    [user.id],
  )).rows;
}

async function getMap(user, id, { write = false, includeDeleted = false } = {}) {
  const result = await pool.query(
    `SELECT m.id,m.company_id AS "companyId",m.name,m.description,m.created_at AS "createdAt",
            m.updated_at AS "updatedAt",m.deleted_at AS "deletedAt",c.name AS "companyName"
       FROM network_maps m JOIN companies c ON c.id=m.company_id
      WHERE m.id=$1 ${includeDeleted ? "" : "AND m.deleted_at IS NULL"}`,
    [id],
  );
  const item = result.rows[0];
  if (!item || !(await canAccessCompany(pool, user, item.companyId))) throw Object.assign(new Error("نقشه پیدا نشد یا دسترسی ندارید."), { status: 404 });
  if (write && !(await canManageCompany(pool, user, item.companyId))) throw Object.assign(new Error("دسترسی ویرایش این نقشه را ندارید."), { status: 403 });
  return item;
}

async function getSnapshot(user, mapId, snapshotId = "") {
  const map = await getMap(user, mapId);
  const result = snapshotId
    ? await pool.query(
      `SELECT id,map_id AS "mapId",version,seed_ip AS "seedIp",protocol,topology,device_count AS "deviceCount",
              link_count AS "linkCount",scan_summary AS "scanSummary",created_at AS "createdAt"
         FROM network_map_snapshots WHERE id=$1 AND map_id=$2 AND deleted_at IS NULL`,
      [snapshotId, map.id],
    )
    : await pool.query(
      `SELECT id,map_id AS "mapId",version,seed_ip AS "seedIp",protocol,topology,device_count AS "deviceCount",
              link_count AS "linkCount",scan_summary AS "scanSummary",created_at AS "createdAt"
         FROM network_map_snapshots WHERE map_id=$1 AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`,
      [map.id],
    );
  if (!result.rowCount) throw Object.assign(new Error("نسخه‌ای برای این نقشه وجود ندارد."), { status: 404 });
  const snapshot = result.rows[0];
  snapshot.topology = await applyManualDevices(map, snapshot.topology);
  return { map, snapshot };
}

async function attachIpam(companyId, topology) {
  const ips = [...new Set((topology.devices || []).map((item) => item.ip).filter(validIpv4))];
  if (!ips.length) return topology;
  const found = await pool.query(
    `SELECT DISTINCT ON (h.ip) h.id,h.ip,h.name,h.type,h.vendor,h.model,h.serial,h.firmware,
            h.space_id AS "spaceId",s.name AS "spaceName",s.cidr AS "spaceCidr"
       FROM hosts h JOIN address_spaces s ON s.id=h.space_id
      WHERE s.company_id=$1 AND h.ip=ANY($2::text[]) AND h.deleted_at IS NULL AND s.deleted_at IS NULL
      ORDER BY h.ip,h.updated_at DESC`,
    [companyId, ips],
  );
  const byIp = new Map(found.rows.map((item) => [item.ip, item]));
  topology.devices = topology.devices.map((item) => {
    const match = byIp.get(item.ip);
    return match ? { ...item, ipamHostId: match.id, ipamSpaceId: match.spaceId, ipamSpaceName: match.spaceName, ipamSpaceCidr: match.spaceCidr } : { ...item, ipamHostId: null };
  });
  return topology;
}

async function applyManualDevices(map, topology) {
  const copy = structuredClone(topology || { devices: [], links: [] });
  copy.devices ||= []; copy.links ||= [];
  const rows = (await pool.query(`SELECT id,ip,hostname,notes FROM network_map_manual_devices WHERE map_id=$1 ORDER BY ip`, [map.id])).rows;
  const manualIps = new Set(rows.map((x) => x.ip));
  const removedKeys = new Set(copy.devices.filter((d) => d.manual && !manualIps.has(d.ip)).map((d) => d.key));
  copy.devices = copy.devices.filter((d) => !removedKeys.has(d.key));
  copy.links = copy.links.filter((l) => !removedKeys.has(l.from) && !removedKeys.has(l.to));
  const existingIps = new Set(copy.devices.map((d) => d.ip));
  for (const row of rows) {
    if (existingIps.has(row.ip)) {
      const d = copy.devices.find((x) => x.ip === row.ip);
      if (d) { d.manual = true; if (!d.hostname && row.hostname) d.hostname = row.hostname; d.manualNotes = row.notes || ""; }
      continue;
    }
    const key = `manual:${crypto.createHash("sha256").update(`${map.id}|${row.ip}`).digest("hex").slice(0,20)}`;
    copy.devices.push({ key, ip: row.ip, hostname: row.hostname || row.ip, model: "", platform: "Manual", osVersion: "", serial: "", uptime: "", ports: [], vlans: [], macTable: [], portCounts: { total:0,up:0,free:0,adminDown:0,error:0 }, neighbors: [], reachable: null, manual: true, manualNotes: row.notes || "", lastScanAt: null });
  }
  await attachIpam(map.companyId, copy);
  return copy;
}

function resolveMacLocations(topology) {
  const devices = new Map((topology?.devices || []).map((d) => [d.key, d]));
  const uplinks = new Map();
  const addUplink = (key, port) => { if (!key || !port) return; if (!uplinks.has(key)) uplinks.set(key, new Set()); uplinks.get(key).add(normalizeInterface(port)); };
  for (const link of topology?.links || []) {
    addUplink(link.from, link.fromPort?.name || link.fromLabel);
    addUplink(link.to, link.toPort?.name || link.toLabel);
  }
  const candidates = new Map();
  for (const device of topology?.devices || []) {
    for (const entry of device.macTable || []) {
      const mac = normalizeMac(entry.mac);
      if (!mac) continue;
      const item = { mac, device, port: normalizeInterface(entry.port), vlan: entry.vlan || null, uplink: uplinks.get(device.key)?.has(normalizeInterface(entry.port)) || false };
      if (!candidates.has(mac)) candidates.set(mac, []);
      candidates.get(mac).push(item);
    }
  }
  const result = new Map();
  for (const [mac, items] of candidates) {
    const selected = items.find((x) => !x.uplink && x.device.reachable !== false) || items.find((x) => x.device.reachable !== false) || items[0];
    if (selected) result.set(mac, selected);
  }
  return result;
}

async function syncKnownMacLocations(topology) {
  try {
    const exists = (await pool.query("SELECT to_regclass('public.radius_mac_clients') AS name")).rows[0]?.name;
    if (!exists) return;
    const locations = resolveMacLocations(topology);
    if (!locations.size) return;
    const settings = (await pool.query("SELECT keep_mac_history FROM radius_settings WHERE singleton=true")).rows[0] || { keep_mac_history: 5 };
    const keep = Math.max(0, Math.min(20, Number(settings.keep_mac_history || 5)));
    for (const [mac, item] of locations) {
      const current = (await pool.query("SELECT id,last_switch_ip,last_port,last_vlan FROM radius_mac_clients WHERE mac=$1", [mac])).rows[0];
      if (!current) continue;
      const switchIp = item.device.ip || "";
      const switchName = item.device.hostname || "";
      await pool.query(`UPDATE radius_mac_clients SET last_switch_ip=$1,last_switch_name=$2,last_port=$3,last_vlan=$4,last_seen_at=now(),updated_at=updated_at WHERE id=$5`, [switchIp, switchName, item.port || "", item.vlan || null, current.id]);
      if (keep > 0 && (current.last_switch_ip !== switchIp || current.last_port !== item.port || Number(current.last_vlan || 0) !== Number(item.vlan || 0))) {
        await pool.query(`INSERT INTO radius_mac_history(mac_id,switch_ip,switch_name,port,vlan) VALUES($1,$2,$3,$4,$5)`, [current.id, switchIp, switchName, item.port || "", item.vlan || null]);
        await pool.query(`DELETE FROM radius_mac_history WHERE id IN (SELECT id FROM radius_mac_history WHERE mac_id=$1 ORDER BY seen_at DESC OFFSET $2)`, [current.id, keep]);
      }
    }
  } catch (error) { console.error("MAC location sync", error.message); }
}

async function saveSnapshot(user, map, { seedIp, protocol, topology, summary }) {
  assertNoSubmittedSecrets(topology);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM network_maps WHERE id=$1 FOR UPDATE", [map.id]);
    const version = Number((await client.query(
      "SELECT COALESCE(max(version),0)+1 AS version FROM network_map_snapshots WHERE map_id=$1",
      [map.id],
    )).rows[0].version);
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO network_map_snapshots(id,map_id,version,seed_ip,protocol,topology,device_count,link_count,scan_summary,created_by)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10)`,
      [id, map.id, version, seedIp, protocol, JSON.stringify(topology), topology.devices.length, topology.links.length, JSON.stringify(summary || {}), user.id],
    );
    await client.query("UPDATE network_maps SET updated_at=now(),updated_by=$1 WHERE id=$2", [user.id, map.id]);
    await client.query("COMMIT");
    await audit(user, "create", "network_map_snapshot", id, { companyId: map.companyId, detail: { mapId: map.id, version, devices: topology.devices.length, links: topology.links.length } });
    return { id, version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function normalizeConnection(body, signal) {
  const protocol = body.protocol === "telnet" ? "telnet" : "ssh";
  const port = Number(body.port || (protocol === "ssh" ? 22 : 23));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("پورت ارتباط معتبر نیست.");
  let username = cleanText(body.username, 120);
  let password = String(body.password ?? "");
  const enablePassword = String(body.enablePassword ?? "");
  const systemAccountId = cleanText(body.systemAccountId, 100);
  if (systemAccountId) {
    const exists = (await pool.query("SELECT to_regclass('public.radius_users') AS name")).rows[0]?.name;
    if (!exists) throw new Error("ماژول RADIUS یا حساب سیستمی آماده نیست.");
    const account = (await pool.query(`SELECT username,password_ciphertext FROM radius_users WHERE id=$1 AND enabled=true AND account_type='system'`, [systemAccountId])).rows[0];
    if (!account) throw new Error("حساب سیستمی RADIUS پیدا نشد.");
    username = account.username;
    password = decryptSecret(account.password_ciphertext);
  }
  if (!username) throw new Error("نام کاربری تجهیز الزامی است.");
  if (!password) throw new Error("رمز ورود تجهیز الزامی است.");
  return {
    protocol,
    port,
    username,
    password,
    enablePassword,
    connectTimeout: Math.max(5000, Math.min(60_000, Number(body.connectTimeout || 30_000))),
    commandTimeout: Math.max(15_000, Math.min(180_000, Number(body.commandTimeout || 90_000))),
    retries: Math.max(0, Math.min(2, Number(body.retries ?? 2))),
    concurrency: Math.max(1, Math.min(8, Number(body.concurrency || 4))),
    maxDevices: Math.max(1, Math.min(500, Number(body.maxDevices || 200))),
    signal,
  };
}

async function listSystemAccounts(user) {
  if (!user || !["admin", "technical", "editor"].includes(user.role)) return [];
  try {
    const exists = (await pool.query("SELECT to_regclass('public.radius_users') AS name")).rows[0]?.name;
    if (!exists) return [];
    return (await pool.query(`SELECT id,username,display_name AS "displayName" FROM radius_users WHERE enabled=true AND account_type='system' ORDER BY username`)).rows;
  } catch { return []; }
}

function scrubConnection(connection, body) {
  if (connection) {
    connection.password = "";
    connection.enablePassword = "";
    connection.username = "";
  }
  if (body) {
    body.password = "";
    body.enablePassword = "";
    body.username = "";
  }
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    mapId: job.mapId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result: job.result,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function startJob(user, { type, mapId }, worker) {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  const job = {
    id,
    userId: user.id,
    type,
    mapId,
    status: "running",
    progress: { message: "عملیات شروع شد.", processed: 0, discovered: 1 },
    error: "",
    result: null,
    controller,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastHeartbeat: Date.now(),
  };
  jobs.set(id, job);
  const update = (progress) => {
    job.progress = { ...job.progress, ...progress };
    job.updatedAt = new Date().toISOString();
  };
  Promise.resolve().then(() => worker(controller.signal, update)).then((result) => {
    if (controller.signal.aborted) return;
    job.result = result;
    job.status = "completed";
    job.progress = { ...job.progress, message: "عملیات با موفقیت تمام شد." };
    job.updatedAt = new Date().toISOString();
  }).catch((error) => {
    job.status = controller.signal.aborted ? "cancelled" : "failed";
    job.error = cleanText(error?.message || "عملیات ناموفق بود.", 500);
    job.updatedAt = new Date().toISOString();
  });
  return job;
}

async function createMap(user, body) {
  requireWriter(user);
  const companyId = cleanText(body.companyId, 80);
  if (!(await canManageCompany(pool, user, companyId))) throw Object.assign(new Error("برای ساخت نقشه باید دسترسی کامل شرکت را داشته باشید."), { status: 403 });
  const name = cleanText(body.name, 120);
  if (!name) throw new Error("نام نقشه الزامی است.");
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO network_maps(id,company_id,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)",
    [id, companyId, name, cleanText(body.description, 1000), user.id],
  );
  await audit(user, "create", "network_map", id, { companyId, detail: { name } });
  return getMap(user, id, { write: true });
}

async function listMaps(user, deleted = false) {
  const companies = await listCompanies(user);
  const companyIds = companies.map((item) => item.id);
  if (!companyIds.length) return [];
  const rows = (await pool.query(
    `SELECT m.id,m.company_id AS "companyId",m.name,m.description,m.created_at AS "createdAt",m.updated_at AS "updatedAt",
            m.deleted_at AS "deletedAt",c.name AS "companyName",s.id AS "snapshotId",s.version,
            s.device_count AS "deviceCount",s.link_count AS "linkCount",s.created_at AS "lastScanAt"
       FROM network_maps m JOIN companies c ON c.id=m.company_id
       LEFT JOIN LATERAL (
         SELECT id,version,device_count,link_count,created_at FROM network_map_snapshots
          WHERE map_id=m.id AND deleted_at IS NULL ORDER BY version DESC LIMIT 1
       ) s ON true
      WHERE m.company_id=ANY($1::text[]) AND m.deleted_at ${deleted ? "IS NOT NULL" : "IS NULL"}
      ORDER BY m.updated_at DESC`,
    [companyIds],
  )).rows;
  const manageable = new Map(companies.map((item) => [item.id, Boolean(item.manageable)]));
  return rows.map((item) => ({ ...item, manageable: manageable.get(item.companyId) || false }));
}

async function pingMany(ips) {
  const unique = [...new Set(ips.filter(validIpv4))].slice(0, 500);
  const result = {};
  let cursor = 0;
  const workers = Array.from({ length: Math.min(24, unique.length) }, async () => {
    while (cursor < unique.length) {
      const ip = unique[cursor];
      cursor += 1;
      try { await execFileAsync("ping", ["-c", "1", "-W", "2", ip], { timeout: 4000 }); result[ip] = true; }
      catch { result[ip] = false; }
    }
  });
  await Promise.all(workers);
  return result;
}

async function api(req, res, url, user) {
  const pathname = url.pathname;
  if (!user) return errorResponse(res, 401, "ابتدا از صفحه اصلی وارد سامانه شوید.");

  if (req.method === "GET" && pathname === "/api/network-map/bootstrap") {
    return json(res, 200, { ok: true, version: APP_VERSION, user, companies: await listCompanies(user), maps: await listMaps(user), trash: await listMaps(user, true), systemAccounts: await listSystemAccounts(user) });
  }

  if (req.method === "GET" && pathname === "/api/network-map/maps") return json(res, 200, { ok: true, maps: await listMaps(user) });
  if (req.method === "POST" && pathname === "/api/network-map/maps") {
    const item = await createMap(user, await readBody(req));
    return json(res, 201, { ok: true, map: item });
  }

  const mapMutation = pathname.match(/^\/api\/network-map\/maps\/([^/]+)$/);
  if (mapMutation && req.method === "GET") {
    const map = await getMap(user, mapMutation[1]);
    const snapshots = (await pool.query(
      `SELECT id,version,seed_ip AS "seedIp",protocol,device_count AS "deviceCount",link_count AS "linkCount",
              scan_summary AS "scanSummary",created_at AS "createdAt"
         FROM network_map_snapshots WHERE map_id=$1 AND deleted_at IS NULL ORDER BY version DESC`,
      [map.id],
    )).rows;
    const deletedSnapshots = (await pool.query(
      `SELECT id,version,seed_ip AS "seedIp",protocol,device_count AS "deviceCount",link_count AS "linkCount",
              scan_summary AS "scanSummary",created_at AS "createdAt",deleted_at AS "deletedAt"
         FROM network_map_snapshots WHERE map_id=$1 AND deleted_at IS NOT NULL ORDER BY version DESC`,
      [map.id],
    )).rows;
    let snapshot = null;
    if (snapshots.length) snapshot = (await getSnapshot(user, map.id, cleanText(url.searchParams.get("snapshot"), 80) || snapshots[0].id)).snapshot;
    return json(res, 200, { ok: true, map, snapshots, deletedSnapshots, snapshot });
  }
  if (mapMutation && req.method === "PUT") {
    requireWriter(user);
    const map = await getMap(user, mapMutation[1], { write: true });
    const body = await readBody(req);
    const name = cleanText(body.name, 120);
    if (!name) throw new Error("نام نقشه الزامی است.");
    await pool.query("UPDATE network_maps SET name=$1,description=$2,updated_by=$3,updated_at=now() WHERE id=$4", [name, cleanText(body.description, 1000), user.id, map.id]);
    await audit(user, "update", "network_map", map.id, { companyId: map.companyId, detail: { previousName: map.name, name } });
    return json(res, 200, { ok: true });
  }
  if (mapMutation && req.method === "DELETE") {
    requireWriter(user);
    const map = await getMap(user, mapMutation[1], { write: true });
    await pool.query("UPDATE network_maps SET deleted_at=now(),deleted_by=$1 WHERE id=$2", [user.id, map.id]);
    await audit(user, "delete", "network_map", map.id, { companyId: map.companyId, detail: { recoverable: true } });
    return json(res, 200, { ok: true, recoverable: true });
  }

  const mapRestore = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/restore$/);
  if (mapRestore && req.method === "POST") {
    requireWriter(user);
    const map = await getMap(user, mapRestore[1], { write: true, includeDeleted: true });
    await pool.query("UPDATE network_maps SET deleted_at=NULL,deleted_by=NULL,updated_at=now(),updated_by=$1 WHERE id=$2", [user.id, map.id]);
    await audit(user, "restore", "network_map", map.id, { companyId: map.companyId });
    return json(res, 200, { ok: true });
  }

  const mapPurge = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/purge$/);
  if (mapPurge && req.method === "DELETE") {
    requireAdmin(user);
    const map = await getMap(user, mapPurge[1], { includeDeleted: true });
    if (!map.deletedAt) throw new Error("ابتدا نقشه را به سطل بازیافت منتقل کنید.");
    await pool.query("DELETE FROM network_maps WHERE id=$1", [map.id]);
    await audit(user, "purge", "network_map", map.id, { companyId: map.companyId });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/network-map/scans") {
    requireWriter(user);
    const body = await readBody(req);
    const seedIp = cleanText(body.seedIp, 64);
    if (!validIpv4(seedIp)) throw new Error("آدرس IP سوئیچ شروع معتبر نیست.");
    const map = body.mapId ? await getMap(user, cleanText(body.mapId, 80), { write: true }) : await createMap(user, body);
    let connection;
    const job = startJob(user, { type: "scan", mapId: map.id }, async (signal, update) => {
      try {
        connection = await normalizeConnection(body, signal);
        const result = await discoverNetwork({ ...connection, seedIp }, update);
        await attachIpam(map.companyId, result.topology);
        await syncKnownMacLocations(result.topology);
        const snapshot = await saveSnapshot(user, map, { seedIp, protocol: connection.protocol, topology: result.topology, summary: result.summary });
        return { mapId: map.id, snapshotId: snapshot.id, version: snapshot.version, summary: result.summary };
      } finally { scrubConnection(connection, body); }
    });
    return json(res, 202, { ok: true, job: publicJob(job), mapId: map.id });
  }

  const importMacsMatch = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/import-macs$/);
  if (importMacsMatch && req.method === "POST") {
    requireAdmin(user);
    const { map, snapshot } = await getSnapshot(user, importMacsMatch[1], cleanText((await readBody(req)).snapshotId, 80));
    const exists = (await pool.query("SELECT to_regclass('public.radius_mac_clients') AS name")).rows[0]?.name;
    if (!exists) throw new Error("ماژول RADIUS / Network Access هنوز آماده نیست.");
    const locations = resolveMacLocations(snapshot.topology);
    let imported = 0, existing = 0, skippedUplink = 0;
    for (const [mac, item] of locations) {
      if (item.uplink) { skippedUplink += 1; continue; }
      const id = crypto.randomUUID();
      const result = await pool.query(
        `INSERT INTO radius_mac_clients(id,mac,name,description,device_type,company_id,access_mode,vlan,enabled,last_switch_ip,last_switch_name,last_port,last_vlan,last_seen_at,created_by,updated_by)
         VALUES($1,$2,'','Imported from network discovery','other',$3,'allow',NULL,true,$4,$5,$6,$7,now(),$8,$8)
         ON CONFLICT(mac) DO NOTHING RETURNING id`,
        [id, mac, map.companyId, item.device.ip || "", item.device.hostname || "", item.port || "", item.vlan || null, user.id],
      );
      if (result.rowCount) imported += 1; else existing += 1;
    }
    await syncKnownMacLocations(snapshot.topology);
    await audit(user, "import", "radius_mac_baseline", map.id, { companyId: map.companyId, detail: { imported, existing, skippedUplink } });
    return json(res, 200, { ok: true, imported, existing, skippedUplink });
  }

  const jobMatch = pathname.match(/^\/api\/network-map\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === "GET") {
    const job = jobs.get(jobMatch[1]);
    if (!job || job.userId !== user.id) throw Object.assign(new Error("عملیات پیدا نشد."), { status: 404 });
    job.lastHeartbeat = Date.now();
    return json(res, 200, { ok: true, job: publicJob(job) });
  }
  if (jobMatch && req.method === "DELETE") {
    const job = jobs.get(jobMatch[1]);
    if (!job || job.userId !== user.id) throw Object.assign(new Error("عملیات پیدا نشد."), { status: 404 });
    job.controller.abort();
    job.status = "cancelled";
    job.updatedAt = new Date().toISOString();
    return json(res, 200, { ok: true });
  }

  const snapshotDelete = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/snapshots\/([^/]+)$/);
  if (snapshotDelete && req.method === "DELETE") {
    requireWriter(user);
    const map = await getMap(user, snapshotDelete[1], { write: true });
    const count = Number((await pool.query("SELECT count(*) FROM network_map_snapshots WHERE map_id=$1 AND deleted_at IS NULL", [map.id])).rows[0].count);
    if (count <= 1) throw Object.assign(new Error("آخرین نسخه نقشه حذف نمی‌شود؛ ابتدا نسخه جدید بسازید یا خود نقشه را حذف کنید."), { status: 409 });
    const result = await pool.query("UPDATE network_map_snapshots SET deleted_at=now(),deleted_by=$1 WHERE id=$2 AND map_id=$3 AND deleted_at IS NULL RETURNING id", [user.id, snapshotDelete[2], map.id]);
    if (!result.rowCount) throw Object.assign(new Error("نسخه نقشه پیدا نشد."), { status: 404 });
    await audit(user, "delete", "network_map_snapshot", snapshotDelete[2], { companyId: map.companyId, detail: { recoverable: true } });
    return json(res, 200, { ok: true, recoverable: true });
  }

  const snapshotRestore = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/snapshots\/([^/]+)\/restore$/);
  if (snapshotRestore && req.method === "POST") {
    requireWriter(user);
    const map = await getMap(user, snapshotRestore[1], { write: true });
    const result = await pool.query(
      "UPDATE network_map_snapshots SET deleted_at=NULL,deleted_by=NULL WHERE id=$1 AND map_id=$2 AND deleted_at IS NOT NULL RETURNING id",
      [snapshotRestore[2], map.id],
    );
    if (!result.rowCount) throw Object.assign(new Error("نسخه حذف‌شده نقشه پیدا نشد."), { status: 404 });
    await audit(user, "restore", "network_map_snapshot", snapshotRestore[2], { companyId: map.companyId, detail: { mapId: map.id } });
    return json(res, 200, { ok: true });
  }

  const manualDeviceCreate = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/manual-devices$/);
  if (manualDeviceCreate && req.method === "POST") {
    requireWriter(user);
    const map = await getMap(user, manualDeviceCreate[1], { write: true });
    const b = await readBody(req); const ip = cleanText(b.ip,64);
    if (!validIpv4(ip)) throw new Error("IP مدیریتی معتبر نیست.");
    await pool.query(`INSERT INTO network_map_manual_devices(id,map_id,ip,hostname,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(map_id,ip) DO UPDATE SET hostname=EXCLUDED.hostname,notes=EXCLUDED.notes,updated_at=now()`, [crypto.randomUUID(),map.id,ip,cleanText(b.hostname,120),cleanText(b.notes,500),user.id]);
    await audit(user,"create","network_map_manual_device",ip,{companyId:map.companyId,detail:{mapId:map.id}});
    return json(res,201,{ok:true});
  }
  const manualDeviceDelete = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/manual-devices\/([^/]+)$/);
  if (manualDeviceDelete && req.method === "DELETE") {
    requireWriter(user); const map=await getMap(user,manualDeviceDelete[1],{write:true}); const ip=decodeURIComponent(manualDeviceDelete[2]);
    await pool.query(`DELETE FROM network_map_manual_devices WHERE map_id=$1 AND ip=$2`,[map.id,ip]);
    await audit(user,"delete","network_map_manual_device",ip,{companyId:map.companyId,detail:{mapId:map.id}});
    return json(res,200,{ok:true});
  }

  if (req.method === "POST" && pathname === "/api/network-map/status") {
    const body = await readBody(req);
    const { snapshot } = await getSnapshot(user, cleanText(body.mapId, 80), cleanText(body.snapshotId, 80));
    const ips = snapshot.topology.devices.filter((item) => item.reachable !== false).map((item) => item.ip);
    return json(res, 200, { ok: true, status: await pingMany(ips), checkedAt: new Date().toISOString() });
  }

  const deviceMatch = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/devices\/([^/]+)$/);
  if (deviceMatch && req.method === "GET") {
    const { map, snapshot } = await getSnapshot(user, deviceMatch[1], cleanText(url.searchParams.get("snapshot"), 80));
    const key = decodeURIComponent(deviceMatch[2]);
    const device = snapshot.topology.devices.find((item) => item.key === key);
    if (!device) throw Object.assign(new Error("سوئیچ در این نسخه نقشه پیدا نشد."), { status: 404 });
    const backups = (await pool.query(
      `SELECT id,hostname,ip,platform,os_version AS "osVersion",config_hash AS "configHash",redaction_count AS "redactionCount",
              created_at AS "createdAt" FROM network_config_backups
        WHERE device_key=$1 AND map_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [device.key, map.id],
    )).rows;
    const deletedBackups = (await pool.query(
      `SELECT id,hostname,ip,platform,os_version AS "osVersion",config_hash AS "configHash",redaction_count AS "redactionCount",
              created_at AS "createdAt",deleted_at AS "deletedAt" FROM network_config_backups
        WHERE device_key=$1 AND map_id=$2 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      [device.key, map.id],
    )).rows;
    return json(res, 200, { ok: true, map, snapshot: { ...snapshot, topology: undefined }, device, backups, deletedBackups, systemAccounts: await listSystemAccounts(user), canWrite: ["admin","technical","editor"].includes(user.role) });
  }

  const refreshMatch = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/devices\/([^/]+)\/refresh$/);
  if (refreshMatch && req.method === "POST") {
    requireWriter(user);
    const body = await readBody(req);
    const { map, snapshot } = await getSnapshot(user, refreshMatch[1], cleanText(body.snapshotId, 80));
    if (!(await canManageCompany(pool, user, map.companyId))) throw Object.assign(new Error("دسترسی ویرایش این نقشه را ندارید."), { status: 403 });
    const key = decodeURIComponent(refreshMatch[2]);
    const device = snapshot.topology.devices.find((item) => item.key === key);
    if (!device?.ip || !validIpv4(device.ip)) throw new Error("آدرس مدیریتی این سوئیچ معتبر نیست.");
    let connection;
    const job = startJob(user, { type: "refresh", mapId: map.id }, async (signal, update) => {
      try {
        connection = await normalizeConnection(body, signal);
        const refreshed = await readSingleDevice(connection, device.ip, update);
        const topology = mergeRefreshedDevice(snapshot.topology, refreshed);
        await attachIpam(map.companyId, topology);
        await syncKnownMacLocations(topology);
        const saved = await saveSnapshot(user, map, { seedIp: snapshot.seedIp, protocol: connection.protocol, topology, summary: { refreshOnly: device.ip } });
        return { mapId: map.id, snapshotId: saved.id, version: saved.version, deviceKey: refreshed.key };
      } finally { scrubConnection(connection, body); }
    });
    return json(res, 202, { ok: true, job: publicJob(job) });
  }

  if (req.method === "POST" && pathname === "/api/network-map/backups") {
    requireWriter(user);
    const body = await readBody(req);
    const { map, snapshot } = await getSnapshot(user, cleanText(body.mapId, 80), cleanText(body.snapshotId, 80));
    if (!(await canManageCompany(pool, user, map.companyId))) throw Object.assign(new Error("دسترسی تهیه بکاپ ندارید."), { status: 403 });
    const selected = new Set(Array.isArray(body.deviceKeys) ? body.deviceKeys.map(String) : []);
    const devices = snapshot.topology.devices.filter((item) => selected.has(item.key) && validIpv4(item.ip) && item.reachable !== false);
    if (!devices.length) throw new Error("حداقل یک سوئیچ قابل دسترسی را انتخاب کنید.");
    let connection;
    const job = startJob(user, { type: "backup", mapId: map.id }, async (signal, update) => {
      const results = [];
      try {
        connection = await normalizeConnection(body, signal);
        for (let index = 0; index < devices.length; index += 1) {
          const device = devices[index];
          update({ message: `بکاپ ${device.hostname || device.ip}`, processed: index, discovered: devices.length, currentIp: device.ip });
          try {
            const raw = await readRunningConfiguration(connection, device.ip, update);
            const safe = sanitizeConfiguration(raw);
            const id = crypto.randomUUID();
            const hash = crypto.createHash("sha256").update(safe.text).digest("hex");
            await pool.query(
              `INSERT INTO network_config_backups(id,map_id,snapshot_id,device_key,hostname,ip,platform,os_version,config_text,config_hash,redaction_count,created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [id, map.id, snapshot.id, device.key, device.hostname || "", device.ip, device.platform || "", device.osVersion || "", safe.text, hash, safe.redactionCount, user.id],
            );
            await audit(user, "create", "network_config_backup", id, { companyId: map.companyId, detail: { ip: device.ip, redactionCount: safe.redactionCount } });
            results.push({ ip: device.ip, hostname: device.hostname, ok: true, id, redactionCount: safe.redactionCount });
          } catch (error) { results.push({ ip: device.ip, hostname: device.hostname, ok: false, error: cleanText(error.message, 300) }); }
          update({ processed: index + 1 });
        }
        return { results, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length };
      } finally { scrubConnection(connection, body); }
    });
    return json(res, 202, { ok: true, job: publicJob(job) });
  }

  const liveDownload = pathname.match(/^\/api\/network-map\/maps\/([^/]+)\/devices\/([^/]+)\/download-live$/);
  if (liveDownload && req.method === "POST") {
    requireWriter(user);
    const body = await readBody(req);
    const { map, snapshot } = await getSnapshot(user, liveDownload[1], cleanText(body.snapshotId, 80));
    if (!(await canManageCompany(pool, user, map.companyId))) throw Object.assign(new Error("دسترسی دریافت کانفیگ ندارید."), { status: 403 });
    const device = snapshot.topology.devices.find((item) => item.key === decodeURIComponent(liveDownload[2]));
    if (!device?.ip || !validIpv4(device.ip)) throw new Error("سوئیچ معتبر نیست.");
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.once("close", onClose);
    let connection;
    try {
      connection = await normalizeConnection(body, controller.signal);
      const config = await readRunningConfiguration(connection, device.ip);
      const payload = Buffer.from(config);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": payload.length,
        "Content-Disposition": `attachment; filename="${safeFilename(device.hostname || device.ip)}-${Date.now()}.cfg"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(payload);
      await audit(user, "live_download", "network_device_config", device.key, { companyId: map.companyId, detail: { ip: device.ip, stored: false } });
    } finally { res.removeListener("close", onClose); scrubConnection(connection, body); }
    return;
  }

  const backupMatch = pathname.match(/^\/api\/network-map\/backups\/([^/]+)(?:\/(download|restore))?$/);
  if (backupMatch && req.method === "GET" && (!backupMatch[2] || backupMatch[2] === "download")) {
    const found = await pool.query(
      `SELECT b.id,b.map_id AS "mapId",b.device_key AS "deviceKey",b.hostname,b.ip,b.platform,b.os_version AS "osVersion",
              b.config_text AS "configText",b.config_hash AS "configHash",b.redaction_count AS "redactionCount",b.created_at AS "createdAt",
              m.company_id AS "companyId" FROM network_config_backups b LEFT JOIN network_maps m ON m.id=b.map_id
       WHERE b.id=$1 AND b.deleted_at IS NULL`,
      [backupMatch[1]],
    );
    const item = found.rows[0];
    if (!item || (item.companyId && !(await canAccessCompany(pool, user, item.companyId)))) throw Object.assign(new Error("بکاپ پیدا نشد."), { status: 404 });
    if (backupMatch[2] === "download") {
      const payload = Buffer.from(item.configText);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": payload.length,
        "Content-Disposition": `attachment; filename="${safeFilename(item.hostname || item.ip)}-${new Date(item.createdAt).toISOString().replace(/[:.]/g, "-")}-sanitized.cfg"`,
        "Cache-Control": "no-store",
      });
      return res.end(payload);
    }
    return json(res, 200, { ok: true, backup: item });
  }
  if (backupMatch && !backupMatch[2] && req.method === "DELETE") {
    requireWriter(user);
    const found = await pool.query(
      `SELECT b.id,m.company_id AS "companyId" FROM network_config_backups b LEFT JOIN network_maps m ON m.id=b.map_id
        WHERE b.id=$1 AND b.deleted_at IS NULL`,
      [backupMatch[1]],
    );
    const item = found.rows[0];
    if (!item || (item.companyId && !(await canManageCompany(pool, user, item.companyId)))) throw Object.assign(new Error("بکاپ پیدا نشد یا دسترسی ندارید."), { status: 404 });
    await pool.query("UPDATE network_config_backups SET deleted_at=now(),deleted_by=$1 WHERE id=$2", [user.id, item.id]);
    await audit(user, "delete", "network_config_backup", item.id, { companyId: item.companyId, detail: { recoverable: true } });
    return json(res, 200, { ok: true, recoverable: true });
  }
  if (backupMatch && backupMatch[2] === "restore" && req.method === "POST") {
    requireWriter(user);
    const found = await pool.query(
      `SELECT b.id,m.company_id AS "companyId" FROM network_config_backups b LEFT JOIN network_maps m ON m.id=b.map_id
        WHERE b.id=$1 AND b.deleted_at IS NOT NULL`,
      [backupMatch[1]],
    );
    const item = found.rows[0];
    if (!item || (item.companyId && !(await canManageCompany(pool, user, item.companyId)))) throw Object.assign(new Error("بکاپ حذف‌شده پیدا نشد یا دسترسی ندارید."), { status: 404 });
    await pool.query("UPDATE network_config_backups SET deleted_at=NULL,deleted_by=NULL WHERE id=$1", [item.id]);
    await audit(user, "restore", "network_config_backup", item.id, { companyId: item.companyId });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/network-map/backups/compare") {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 3) : [];
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error("دقیقاً دو بکاپ متفاوت را انتخاب کنید.");
    const found = await pool.query(
      `SELECT b.id,b.device_key AS "deviceKey",b.hostname,b.ip,b.config_text AS "configText",b.created_at AS "createdAt",
              m.company_id AS "companyId" FROM network_config_backups b LEFT JOIN network_maps m ON m.id=b.map_id
        WHERE b.id=ANY($1::text[]) AND b.deleted_at IS NULL`,
      [ids],
    );
    if (found.rowCount !== 2) throw new Error("یکی از بکاپ‌ها پیدا نشد.");
    if (found.rows[0].deviceKey !== found.rows[1].deviceKey) throw new Error("مقایسه فقط بین دو بکاپ از یک سوئیچ انجام می‌شود.");
    for (const item of found.rows) if (item.companyId && !(await canAccessCompany(pool, user, item.companyId))) throw Object.assign(new Error("دسترسی مشاهده بکاپ ندارید."), { status: 403 });
    const ordered = ids.map((id) => found.rows.find((item) => item.id === id));
    return json(res, 200, { ok: true, before: { ...ordered[0], configText: undefined }, after: { ...ordered[1], configText: undefined }, diff: diffLines(ordered[0].configText, ordered[1].configText) });
  }

  errorResponse(res, 404, "مسیر درخواست پیدا نشد.");
}

async function staticFile(res, pathname) {
  let relative = pathname.replace(/^\/network-map\/?/, "");
  if (!relative) relative = "index.html";
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolved !== path.join(PUBLIC_DIR, "index.html")) return false;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return false;
    const extension = path.extname(resolved).toLowerCase();
    const type = extension === ".html" ? "text/html; charset=utf-8" : extension === ".js" ? "text/javascript; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
    const data = await fs.readFile(resolved);
    res.end(data);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/network-map/health") return json(res, 200, { ok: true, version: APP_VERSION, activeJobs: [...jobs.values()].filter((job) => job.status === "running").length });
    if (url.pathname.startsWith("/api/network-map/")) {
      if (!csrfAllowed(req)) return errorResponse(res, 403, "درخواست فاقد نشان امنیتی معتبر است.");
      return await api(req, res, url, await currentUser(pool, req));
    }
    if (req.method === "GET" && (url.pathname === "/network-map" || url.pathname.startsWith("/network-map/"))) {
      if (url.pathname === "/network-map") { res.writeHead(302, { Location: "/network-map/" }); return res.end(); }
      if (await staticFile(res, url.pathname)) return;
    }
    return errorResponse(res, 404, "صفحه پیدا نشد.");
  } catch (error) {
    const status = Number(error.status || (error.code === "23505" ? 409 : 400));
    const message = error.code === "23505" ? "این رکورد قبلاً ثبت شده است." : cleanText(error.message || "خطای داخلی برنامه", 500);
    console.error(new Date().toISOString(), req.method, req.url, message);
    if (!res.headersSent) errorResponse(res, status, message); else res.end();
  }
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === "running" && now - job.lastHeartbeat > 45_000) {
      job.controller.abort();
      job.status = "cancelled";
      job.error = "به‌دلیل بسته‌شدن صفحه یا قطع نشست، عملیات متوقف شد.";
      job.updatedAt = new Date().toISOString();
    }
    if (job.status !== "running" && now - new Date(job.updatedAt).getTime() > 30 * 60_000) jobs.delete(id);
  }
}, 5000);
cleanupTimer.unref();

server.listen(PORT, "0.0.0.0", () => console.log(`EMS Network Map ${APP_VERSION} listening on ${PORT}`));

async function shutdown() {
  clearInterval(cleanupTimer);
  for (const job of jobs.values()) job.controller.abort();
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
