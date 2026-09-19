import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.mjs";
import {
  clearSessionCookie,
  hashPassword,
  parseCookies,
  randomToken,
  sessionCookie,
  tokenHash,
  verifyPassword,
} from "./auth.mjs";
import {
  contains,
  defaultGateway,
  intToIpv4,
  parseCidr,
  validateChildCidr,
  validateHostIp,
  validatePort,
  validateRootCidr,
} from "./ip.mjs";
import { pingMany } from "./ping.mjs";
import { buildSubnetPackage, importSubnetPackage } from "./portable.mjs";
import { buildMikrotikScript } from "./mikrotik.mjs";

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || undefined;
const ADMIN_USERNAME = process.env.EMS_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.EMS_ADMIN_PASSWORD || "";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";
const MODULE_REGISTRY = path.resolve(process.env.EMS_MODULE_REGISTRY || "/runtime/modules.json");
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "/backups");
const BACKUP_DISPLAY_PATH = cleanTextEnvironment(process.env.BACKUP_DISPLAY_PATH || "/opt/ems-ipam/backups");
const APP_VERSION = "0.7.0";
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COLORS = ["#3157d5", "#2fa36f", "#d94b5b", "#e48a2d", "#805ad5", "#2b9ca8", "#c2418c", "#64748b"];
const execFileAsync = promisify(execFile);

function cleanTextEnvironment(value) {
  return String(value ?? "").trim().slice(0, 500);
}

let moduleCache = { loadedAt: 0, items: [] };
async function loadModules() {
  const now = Date.now();
  if (now - moduleCache.loadedAt < 5000) return moduleCache.items;
  try {
    const raw = JSON.parse(await fs.readFile(MODULE_REGISTRY, "utf8"));
    const items = Array.isArray(raw) ? raw : [];
    moduleCache = { loadedAt: now, items: items.filter((m) => m && /^[a-z0-9][a-z0-9-]*$/.test(String(m.id || "")) && m.enabled === true) };
  } catch {
    moduleCache = { loadedAt: now, items: [] };
  }
  return moduleCache.items;
}

async function publicModules() {
  return (await loadModules()).map(({ upstream, ...item }) => item);
}

if (!DATABASE_URL && !process.env.PGHOST) throw new Error("تنظیمات اتصال PostgreSQL تعریف نشده است.");
if (ADMIN_PASSWORD.length < 1) throw new Error("EMS_ADMIN_PASSWORD نمی‌تواند خالی باشد.");

const database = createDatabase(DATABASE_URL);
await database.initialize({ adminUsername: ADMIN_USERNAME, adminPassword: ADMIN_PASSWORD });
await fs.mkdir(BACKUP_DIR, { recursive: true });
const { pool } = database;
const eventClients = new Set();
const loginAttempts = new Map();

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function errorResponse(res, status, message) {
  json(res, status, { ok: false, error: message });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("اندازهٔ درخواست بیش از حد مجاز است.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("ساختار JSON معتبر نیست.");
  }
}

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizePersian(value) {
  return cleanText(value, 500).replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ").replace(/\s+/g, " ");
}

function validColor(value, fallback = COLORS[0]) {
  const color = cleanText(value, 7);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function safeRole(value) {
  if (!["admin", "editor", "viewer"].includes(value)) throw new Error("نقش کاربر معتبر نیست.");
  return value;
}

function normalizePorts(value) {
  const result = {};
  const input = value && typeof value === "object" ? value : {};
  for (const tool of ["VNC", "MIK", "RDP", "SSH", "TELNET", "HTTP", "HTTPS"]) {
    const port = validatePort(input[tool]);
    if (port !== null) result[tool] = port;
  }
  return result;
}

function normalizeConnections(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => ({
    type: cleanText(item?.type, 20).toUpperCase(),
    label: cleanText(item?.label, 80),
    port: validatePort(item?.port),
    url: cleanText(item?.url, 500),
  })).filter((item) => ["SSH", "WINBOX", "HTTP", "HTTPS", "RDP", "VNC", "TELNET"].includes(item.type));
}

function normalizeDevicePorts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 256).map((item) => ({
    id: cleanText(item?.id, 80) || crypto.randomUUID(),
    name: cleanText(item?.name, 80),
    description: cleanText(item?.description, 240),
    portType: cleanText(item?.portType, 40) || "ethernet",
    speed: cleanText(item?.speed, 40),
    vlanMode: cleanText(item?.vlanMode, 40),
    vlan: cleanText(item?.vlan, 80),
    enabled: item?.enabled !== false,
  })).filter((item) => item.name && !seen.has(item.name) && seen.add(item.name));
}

function nullableCoordinate(value, minimum, maximum) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error("مختصات جغرافیایی معتبر نیست.");
  return number;
}

function normalizeContacts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((item) => ({
    id: cleanText(item?.id, 80) || crypto.randomUUID(),
    fullName: cleanText(item?.fullName, 160),
    jobTitle: cleanText(item?.jobTitle, 120),
    phone: cleanText(item?.phone, 80),
    mobile: cleanText(item?.mobile, 80),
    email: cleanText(item?.email, 180),
    notes: cleanText(item?.notes, 500),
    isPrimary: item?.isPrimary === true,
  })).filter((item) => item.fullName);
}

function normalizeCompanyConnections(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item) => {
    const ip = validateHostIp(item?.ip, "0.0.0.0/0");
    return {
      id: cleanText(item?.id, 80) || crypto.randomUUID(),
      title: cleanText(item?.title, 120) || ip,
      ip,
      provider: cleanText(item?.provider, 120),
      linkRole: ["primary", "backup", "other"].includes(item?.linkRole) ? item.linkRole : "primary",
      deviceName: cleanText(item?.deviceName, 160),
      username: cleanText(item?.username, 120),
      connectionMethods: normalizeConnections(item?.connectionMethods),
      notes: cleanText(item?.notes, 1000),
    };
  });
}

function normalizeBackupSettings(value, current = {}) {
  return {
    enabled: value?.enabled !== false,
    intervalDays: Math.max(1, Math.min(365, Math.round(Number(value?.intervalDays ?? current.intervalDays ?? 1) || 1))),
    hour: Math.max(0, Math.min(23, Math.round(Number(value?.hour ?? current.hour ?? 2) || 0))),
    retentionDays: Math.max(1, Math.min(3650, Math.round(Number(value?.retentionDays ?? current.retentionDays ?? 30) || 30))),
    lastRunAt: current.lastRunAt || null,
  };
}

function requesterIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function csrfAllowed(req) {
  if (!MUTATING.has(req.method)) return true;
  if (req.url.startsWith("/api/auth/login")) return true;
  return req.headers["x-ems-csrf"] === "1";
}

async function currentUser(req) {
  const token = parseCookies(req.headers.cookie).ems_session;
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name AS "displayName",u.role,u.active
       FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
    [tokenHash(token)],
  );
  return result.rows[0] || null;
}

function requireWriter(user) {
  if (!user || !["admin", "editor"].includes(user.role)) throw Object.assign(new Error("دسترسی ویرایش ندارید."), { status: 403 });
}

function requireAdmin(user) {
  if (!user || user.role !== "admin") throw Object.assign(new Error("این عملیات فقط برای مدیر سیستم مجاز است."), { status: 403 });
}

async function canAccessCompany(user, companyId) {
  const active = await pool.query("SELECT 1 FROM companies WHERE id=$1 AND deleted_at IS NULL", [companyId]);
  if (!active.rowCount) return false;
  if (user.role === "admin") return true;
  const found = await pool.query(
    `SELECT 1 FROM user_company_access WHERE user_id=$1 AND company_id=$2
     UNION ALL
     SELECT 1 FROM user_space_access usa JOIN address_spaces s ON s.id=usa.space_id
      WHERE usa.user_id=$1 AND s.company_id=$2 LIMIT 1`,
    [user.id, companyId],
  );
  return found.rowCount > 0;
}

async function canManageCompany(user, companyId) {
  const active = await pool.query("SELECT 1 FROM companies WHERE id=$1 AND deleted_at IS NULL", [companyId]);
  if (!active.rowCount) return false;
  if (user.role === "admin") return true;
  const found = await pool.query(
    "SELECT 1 FROM user_company_access WHERE user_id=$1 AND company_id=$2",
    [user.id, companyId],
  );
  return found.rowCount > 0;
}

async function canAccessSpace(user, spaceId) {
  if (user.role === "admin") {
    const active = await pool.query(
      "SELECT 1 FROM address_spaces s JOIN companies c ON c.id=s.company_id WHERE s.id=$1 AND s.deleted_at IS NULL AND c.deleted_at IS NULL",
      [spaceId],
    );
    return active.rowCount > 0;
  }
  const found = await pool.query(
    `SELECT 1 FROM address_spaces s JOIN companies c ON c.id=s.company_id
      LEFT JOIN user_company_access uca ON uca.company_id=s.company_id AND uca.user_id=$1
      LEFT JOIN user_space_access usa ON usa.space_id=s.id AND usa.user_id=$1
     WHERE s.id=$2 AND s.deleted_at IS NULL AND c.deleted_at IS NULL
       AND (uca.user_id IS NOT NULL OR usa.user_id IS NOT NULL)`,
    [user.id, spaceId],
  );
  return found.rowCount > 0;
}

async function getSpaceForUser(user, spaceId) {
  const found = await pool.query(
    `SELECT s.id,s.company_id AS "companyId",s.name,s.cidr,s.color,s.description,
            c.name AS "companyName"
       FROM address_spaces s JOIN companies c ON c.id=s.company_id
      WHERE s.id=$1 AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,
    [spaceId],
  );
  const space = found.rows[0];
  if (!space || !(await canAccessSpace(user, space.id))) {
    throw Object.assign(new Error("فضای آدرس پیدا نشد یا دسترسی ندارید."), { status: 404 });
  }
  return space;
}

async function audit(user, action, entityType, entityId, { companyId = null, spaceId = null, detail = {} } = {}) {
  await pool.query(
    "INSERT INTO audit_log(user_id,action,entity_type,entity_id,company_id,space_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [user?.id || null, action, entityType, entityId || null, companyId, spaceId, JSON.stringify(detail)],
  );
}

async function protectLastAdmin(client, targetId, nextRole = null, nextActive = null) {
  const target = (await client.query("SELECT id,role,active FROM users WHERE id=$1 FOR UPDATE", [targetId])).rows[0];
  if (!target) throw Object.assign(new Error("کاربر پیدا نشد."), { status: 404 });
  const removesAdmin = target.role === "admin" && target.active && (nextRole !== "admin" || nextActive === false);
  if (removesAdmin) {
    const admins = await client.query("SELECT id FROM users WHERE role='admin' AND active=true FOR UPDATE");
    if (admins.rows.filter((item) => item.id !== targetId).length === 0) {
      throw Object.assign(new Error("حداقل یک مدیر فعال باید در سامانه باقی بماند."), { status: 409 });
    }
  }
  return target;
}

function broadcast(event) {
  const payload = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    try { client.write(payload); } catch { eventClients.delete(client); }
  }
}

async function listBootstrap(user) {
  const companyWhere = user.role === "admin"
    ? { sql: "WHERE c.deleted_at IS NULL", params: [] }
    : { sql: `WHERE c.deleted_at IS NULL AND (EXISTS (SELECT 1 FROM user_company_access a WHERE a.company_id=c.id AND a.user_id=$1)
                    OR EXISTS (SELECT 1 FROM user_space_access usa JOIN address_spaces s ON s.id=usa.space_id
                                WHERE s.company_id=c.id AND s.deleted_at IS NULL AND usa.user_id=$1))`, params: [user.id] };
  const companies = await pool.query(
    `SELECT DISTINCT c.id,c.parent_company_id AS "parentCompanyId",c.kind,c.code,c.name,c.description,c.address,
            c.postal_code AS "postalCode",c.phone,c.manager_name AS "managerName",c.latitude,c.longitude,c.notes,
            (SELECT count(*)::int FROM company_contacts cc WHERE cc.company_id=c.id) AS "contactCount",
            (SELECT count(*)::int FROM company_connections cn WHERE cn.company_id=c.id) AS "connectionCount"
       FROM companies c ${companyWhere.sql} ORDER BY c.name`,
    companyWhere.params,
  );
  const ids = companies.rows.map((item) => item.id);
  const spaces = ids.length
    ? user.role === "admin"
      ? await pool.query(
        `SELECT id,company_id AS "companyId",name,cidr,color,description
           FROM address_spaces WHERE company_id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY company_id,cidr`,
        [ids],
      )
      : await pool.query(
        `SELECT DISTINCT s.id,s.company_id AS "companyId",s.name,s.cidr,s.color,s.description
           FROM address_spaces s
           LEFT JOIN user_company_access uca ON uca.company_id=s.company_id AND uca.user_id=$1
           LEFT JOIN user_space_access usa ON usa.space_id=s.id AND usa.user_id=$1
          WHERE s.company_id=ANY($2::text[]) AND s.deleted_at IS NULL
            AND (uca.user_id IS NOT NULL OR usa.user_id IS NOT NULL)
          ORDER BY s.company_id,s.cidr`,
        [user.id, ids],
      )
    : { rows: [] };
  const tools = await pool.query(
    `SELECT tool,label,default_port AS "defaultPort",color FROM tool_defaults ORDER BY tool`,
  );
  const fullCompanyIds = user.role === "admin"
    ? ids
    : (await pool.query("SELECT company_id AS id FROM user_company_access WHERE user_id=$1", [user.id])).rows.map((item) => item.id);
  return { ok: true, version: APP_VERSION, user, companies: companies.rows, spaces: spaces.rows, tools: tools.rows, fullCompanyIds, modules: await publicModules() };
}

async function companyData(user, companyId) {
  if (!(await canAccessCompany(user, companyId))) throw Object.assign(new Error("شرکت پیدا نشد یا دسترسی ندارید."), { status: 404 });
  const [company, contacts, connections, spaces, stats] = await Promise.all([
    pool.query(
      `SELECT id,parent_company_id AS "parentCompanyId",kind,code,name,description,address,postal_code AS "postalCode",
              phone,manager_name AS "managerName",latitude,longitude,notes,updated_at AS "updatedAt"
         FROM companies WHERE id=$1 AND deleted_at IS NULL`,
      [companyId],
    ),
    pool.query(
      `SELECT id,full_name AS "fullName",job_title AS "jobTitle",phone,mobile,email,notes,is_primary AS "isPrimary"
         FROM company_contacts WHERE company_id=$1 ORDER BY is_primary DESC,full_name`,
      [companyId],
    ),
    pool.query(
      `SELECT id,title,ip,provider,link_role AS "linkRole",device_name AS "deviceName",username,
              connection_methods AS "connectionMethods",notes
         FROM company_connections WHERE company_id=$1 ORDER BY link_role,title`,
      [companyId],
    ),
    pool.query(
      `SELECT id,name,cidr,color,description FROM address_spaces
        WHERE company_id=$1 AND deleted_at IS NULL ORDER BY cidr`,
      [companyId],
    ),
    pool.query(
      `SELECT count(DISTINCT h.id)::int AS hosts,count(DISTINCT p.id)::int AS prefixes,
              count(DISTINCT CASE WHEN h.radio_mode<>'' THEN h.id END)::int AS radios
         FROM address_spaces s
         LEFT JOIN hosts h ON h.space_id=s.id AND h.deleted_at IS NULL
         LEFT JOIN prefixes p ON p.space_id=s.id AND p.deleted_at IS NULL
        WHERE s.company_id=$1 AND s.deleted_at IS NULL`,
      [companyId],
    ),
  ]);
  if (!company.rowCount) throw Object.assign(new Error("شرکت پیدا نشد."), { status: 404 });
  return { ok: true, company: company.rows[0], contacts: contacts.rows, connections: connections.rows, spaces: spaces.rows, stats: stats.rows[0] };
}

async function replaceCompanyDetails(client, companyId, body) {
  const contacts = normalizeContacts(body.contacts);
  const connections = normalizeCompanyConnections(body.connections);
  await client.query("DELETE FROM company_contacts WHERE company_id=$1", [companyId]);
  for (const item of contacts) {
    await client.query(
      `INSERT INTO company_contacts(id,company_id,full_name,job_title,phone,mobile,email,notes,is_primary)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [item.id, companyId, item.fullName, item.jobTitle, item.phone, item.mobile, item.email, item.notes, item.isPrimary],
    );
  }
  await client.query("DELETE FROM company_connections WHERE company_id=$1", [companyId]);
  for (const item of connections) {
    await client.query(
      `INSERT INTO company_connections(id,company_id,title,ip,provider,link_role,device_name,username,connection_methods,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [item.id, companyId, item.title, item.ip, item.provider, item.linkRole, item.deviceName, item.username, JSON.stringify(item.connectionMethods), item.notes],
    );
  }
}

async function spaceData(user, spaceId) {
  const space = await getSpaceForUser(user, spaceId);
  const [prefixes, hosts, pings, devicePorts] = await Promise.all([
    pool.query(
      `SELECT id,cidr,name,status,role,vlan,gateway,color,description,
              updated_at AS "updatedAt" FROM prefixes WHERE space_id=$1 AND deleted_at IS NULL ORDER BY cidr`,
      [spaceId],
    ),
    pool.query(
      `SELECT id,ip,name,status,type,os,mac,vlan,username,owner,location,vendor,model,serial,firmware,
              radio_mode AS "radioMode",ssid,frequency,channel,signal,
              radio_parent_host_id AS "radioParentHostId",connection_methods AS "connectionMethods",
              monitor_enabled AS "monitorEnabled",monitor_driver AS "monitorDriver",monitor_port AS "monitorPort",
              monitor_username AS "monitorUsername",(monitor_secret_ciphertext <> '') AS "hasMonitorPassword",
              monitor_ca_pem AS "monitorCaPem",
              monitor_interval AS "monitorInterval",monitor_state AS "monitorState",monitor_checked_at AS "monitorCheckedAt",
              monitor_last_ok_at AS "monitorLastOkAt",monitor_failures AS "monitorFailures",monitor_error AS "monitorError",
              secret_ref AS "secretRef",(secret_ciphertext <> '') AS "hasPassword",
              notes,ports,updated_at AS "updatedAt"
         FROM hosts WHERE space_id=$1 AND deleted_at IS NULL ORDER BY ip`,
      [spaceId],
    ),
    pool.query(
      `SELECT ip,online,checked_at AS "checkedAt",last_seen_at AS "lastSeenAt"
         FROM ping_results WHERE space_id=$1`,
      [spaceId],
    ),
    pool.query(
      `SELECT p.id,p.host_id AS "hostId",p.name,p.description,p.port_type AS "portType",p.speed,
              p.vlan_mode AS "vlanMode",p.vlan,p.enabled
         FROM device_ports p JOIN hosts h ON h.id=p.host_id WHERE h.space_id=$1 AND h.deleted_at IS NULL ORDER BY p.name`,
      [spaceId],
    ),
  ]);
  const portsByHost = new Map();
  for (const item of devicePorts.rows) {
    if (!portsByHost.has(item.hostId)) portsByHost.set(item.hostId, []);
    portsByHost.get(item.hostId).push(item);
  }
  return { ok: true, space, prefixes: prefixes.rows, hosts: hosts.rows.map((item) => ({ ...item, devicePorts: portsByHost.get(item.id) || [] })), pings: pings.rows };
}

async function storePingResults(spaceId, results) {
  const entries = [...results.entries()];
  if (!entries.length) return;
  const params = [];
  const values = entries.map(([ip, online], index) => {
    params.push(spaceId, ip, online);
    const offset = index * 3;
    return `($${offset + 1},$${offset + 2},$${offset + 3},now(),CASE WHEN $${offset + 3} THEN now() ELSE NULL END)`;
  });
  await pool.query(
    `INSERT INTO ping_results(space_id,ip,online,checked_at,last_seen_at)
     VALUES ${values.join(",")}
     ON CONFLICT(space_id,ip) DO UPDATE SET
       online=excluded.online,
       checked_at=excluded.checked_at,
       last_seen_at=CASE WHEN excluded.online THEN excluded.checked_at ELSE ping_results.last_seen_at END`,
    params,
  );
}

async function accessibleSpaceIds(user) {
  if (user.role === "admin") return (await pool.query(
    "SELECT s.id FROM address_spaces s JOIN companies c ON c.id=s.company_id WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL",
  )).rows.map((item) => item.id);
  return (await pool.query(
    `SELECT DISTINCT s.id FROM address_spaces s JOIN companies c ON c.id=s.company_id
      LEFT JOIN user_company_access uca ON uca.company_id=s.company_id AND uca.user_id=$1
      LEFT JOIN user_space_access usa ON usa.space_id=s.id AND usa.user_id=$1
     WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL
       AND (uca.user_id IS NOT NULL OR usa.user_id IS NOT NULL)`,
    [user.id],
  )).rows.map((item) => item.id);
}

async function inventoryData(user) {
  const spaceIds = await accessibleSpaceIds(user);
  if (!spaceIds.length) return [];
  const [hosts, ports] = await Promise.all([
    pool.query(
      `SELECT h.id,h.space_id AS "spaceId",h.ip,h.name,h.status,h.type,h.os,h.mac,h.vlan,h.username,h.owner,h.location,
              h.vendor,h.model,h.serial,h.firmware,h.radio_mode AS "radioMode",h.ssid,h.frequency,h.channel,h.signal,
              h.radio_parent_host_id AS "radioParentHostId",h.connection_methods AS "connectionMethods",
              h.monitor_enabled AS "monitorEnabled",h.monitor_driver AS "monitorDriver",h.monitor_port AS "monitorPort",
              h.monitor_username AS "monitorUsername",(h.monitor_secret_ciphertext <> '') AS "hasMonitorPassword",
              h.monitor_ca_pem AS "monitorCaPem",
              h.monitor_interval AS "monitorInterval",h.monitor_state AS "monitorState",h.monitor_checked_at AS "monitorCheckedAt",
              h.monitor_last_ok_at AS "monitorLastOkAt",h.monitor_failures AS "monitorFailures",h.monitor_error AS "monitorError",
              (h.secret_ciphertext <> '') AS "hasPassword",s.name AS "spaceName",s.cidr AS "spaceCidr",
              c.id AS "companyId",c.name AS "companyName"
         FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id
        WHERE h.space_id=ANY($1::text[]) AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL
        ORDER BY c.name,s.cidr,h.ip`,
      [spaceIds],
    ),
    pool.query(
      `SELECT p.id,p.host_id AS "hostId",p.name,p.description,p.port_type AS "portType",p.speed,
              p.vlan_mode AS "vlanMode",p.vlan,p.enabled
         FROM device_ports p JOIN hosts h ON h.id=p.host_id
        WHERE h.space_id=ANY($1::text[]) AND h.deleted_at IS NULL ORDER BY p.name`,
      [spaceIds],
    ),
  ]);
  const portsByHost = new Map();
  for (const item of ports.rows) {
    if (!portsByHost.has(item.hostId)) portsByHost.set(item.hostId, []);
    portsByHost.get(item.hostId).push(item);
  }
  return hosts.rows.map((item) => ({ ...item, devicePorts: portsByHost.get(item.id) || [] }));
}

async function searchData(user, query) {
  const q = normalizePersian(query).slice(0, 160);
  if (!q) return [];
  const spaces = (await listBootstrap(user)).spaces;
  const spaceIds = spaces.map((item) => item.id);
  if (!spaceIds.length) return [];
  const items = [];
  const exactIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(q) ? q : null;
  const companyIds = [...new Set(spaces.map((item) => item.companyId))];
  const [hosts, prefixes, companies] = await Promise.all([
    pool.query(
      `SELECT h.id,h.space_id AS "spaceId",h.ip,h.name,h.type,h.status,s.name AS "spaceName",s.cidr AS "spaceCidr"
         FROM hosts h JOIN address_spaces s ON s.id=h.space_id
        WHERE h.space_id=ANY($1::text[]) AND h.deleted_at IS NULL AND
          (h.ip ILIKE $2 OR translate(h.name,'كيى','کیی') ILIKE $2 OR h.mac ILIKE $2 OR
           translate(h.owner,'كيى','کیی') ILIKE $2 OR translate(h.notes,'كيى','کیی') ILIKE $2)
        ORDER BY CASE WHEN h.ip=$3 THEN 0 ELSE 1 END,h.ip LIMIT 30`,
      [spaceIds, `%${q}%`, exactIp || ""],
    ),
    pool.query(
      `SELECT p.id,p.space_id AS "spaceId",p.cidr,p.name,p.status,s.name AS "spaceName",s.cidr AS "spaceCidr"
         FROM prefixes p JOIN address_spaces s ON s.id=p.space_id
        WHERE p.space_id=ANY($1::text[]) AND p.deleted_at IS NULL AND
          (p.cidr ILIKE $2 OR translate(p.name,'كيى','کیی') ILIKE $2 OR translate(p.role,'كيى','کیی') ILIKE $2 OR translate(p.description,'كيى','کیی') ILIKE $2)
        ORDER BY p.cidr LIMIT 20`,
      [spaceIds, `%${q}%`],
    ),
    companyIds.length ? pool.query(
      `SELECT DISTINCT c.id,c.name,c.address,c.phone,c.manager_name AS "managerName"
         FROM companies c
         LEFT JOIN company_contacts cc ON cc.company_id=c.id
         LEFT JOIN company_connections cn ON cn.company_id=c.id
        WHERE c.id=ANY($1::text[]) AND c.deleted_at IS NULL AND
          (translate(c.name,'كيى','کیی') ILIKE $2 OR translate(c.address,'كيى','کیی') ILIKE $2 OR
           c.phone ILIKE $2 OR translate(c.manager_name,'كيى','کیی') ILIKE $2 OR
           translate(cc.full_name,'كيى','کیی') ILIKE $2 OR cc.phone ILIKE $2 OR cc.mobile ILIKE $2 OR
           cc.email ILIKE $2 OR cn.ip ILIKE $2 OR translate(cn.provider,'كيى','کیی') ILIKE $2)
        ORDER BY c.name LIMIT 20`,
      [companyIds, `%${q}%`],
    ) : { rows: [] },
  ]);
  items.push(...companies.rows.map((item) => ({ kind: "company", companyId: item.id, ...item })));
  items.push(...hosts.rows.map((item) => ({ kind: "host", ...item })));
  items.push(...prefixes.rows.map((item) => ({ kind: "prefix", ...item })));
  if (exactIp && !hosts.rows.some((item) => item.ip === exactIp)) {
    const address = parseCidr(`${exactIp}/32`);
    const containing = spaces.map((item) => ({ item, info: parseCidr(item.cidr) }))
      .filter(({ info }) => info && address && contains(info, address))
      .sort((a, b) => b.info.prefix - a.info.prefix)[0]?.item;
    if (containing) items.unshift({ kind: "free-ip", ip: exactIp, spaceId: containing.id, spaceName: containing.name, spaceCidr: containing.cidr });
  }
  return items.slice(0, 40);
}

async function getMapForUser(user, mapId, { write = false } = {}) {
  const result = await pool.query(
    `SELECT m.id,m.company_id AS "companyId",m.name,m.description,c.name AS "companyName"
       FROM topology_maps m LEFT JOIN companies c ON c.id=m.company_id WHERE m.id=$1`,
    [mapId],
  );
  const map = result.rows[0];
  const allowed = map && (map.companyId ? (write ? await canManageCompany(user, map.companyId) : await canAccessCompany(user, map.companyId)) : user.role === "admin");
  if (!allowed) throw Object.assign(new Error("نقشه پیدا نشد یا دسترسی ندارید."), { status: 404 });
  return map;
}

function backupFilename() {
  return `ems-ipam-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.tar.gz`;
}

function validBackupFilename(value) {
  const name = path.basename(cleanText(value, 180));
  if (!/^ems-ipam-[A-Za-z0-9TZ-]+\.tar\.gz$/.test(name)) throw Object.assign(new Error("نام فایل پشتیبان معتبر نیست."), { status: 400 });
  return name;
}

async function createBackupFile() {
  const filename = backupFilename();
  const workDir = path.join(BACKUP_DIR, `.work-${crypto.randomUUID()}`);
  const archivePath = path.join(BACKUP_DIR, filename);
  await fs.mkdir(workDir, { recursive: true });
  try {
    await execFileAsync("pg_dump", ["--format=custom", "--file", path.join(workDir, "database.dump")], { env: process.env, timeout: 300_000 });
    const metadata = [
      `EMS_BACKUP_VERSION='2'`,
      `EMS_APP_VERSION='${APP_VERSION}'`,
      `EMS_CREATED_AT='${new Date().toISOString()}'`,
      "",
    ].join("\n");
    await fs.writeFile(path.join(workDir, "metadata.env"), metadata, { mode: 0o600 });
    await execFileAsync("tar", ["-czf", archivePath, "-C", workDir, "database.dump", "metadata.env"], { timeout: 300_000 });
    await fs.chmod(archivePath, 0o600);
    return filename;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function listBackupFiles() {
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^ems-ipam-.*\.tar\.gz$/.test(entry.name)) continue;
    const stat = await fs.stat(path.join(BACKUP_DIR, entry.name));
    files.push({ name: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() });
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getSetting(key, fallback = {}) {
  const found = await pool.query("SELECT value FROM app_settings WHERE key=$1", [key]);
  return found.rows[0]?.value || fallback;
}

function nextBackupAt(settings) {
  if (!settings.enabled) return null;
  const now = new Date();
  const last = settings.lastRunAt ? new Date(settings.lastRunAt) : null;
  const due = last && !Number.isNaN(last.getTime())
    ? new Date(last.getTime() + Number(settings.intervalDays || 1) * 86_400_000)
    : new Date(now);
  due.setHours(Number(settings.hour || 0), 0, 0, 0);
  if (!last && due <= now) return now;
  while (due <= (last || new Date(0))) due.setDate(due.getDate() + Number(settings.intervalDays || 1));
  return due;
}

async function cleanupOldBackups(retentionDays) {
  const cutoff = Date.now() - Number(retentionDays || 30) * 86_400_000;
  for (const item of await listBackupFiles()) {
    if (new Date(item.createdAt).getTime() < cutoff) await fs.unlink(path.join(BACKUP_DIR, item.name)).catch(() => {});
  }
}

let automaticBackupRunning = false;
async function runAutomaticBackup() {
  if (automaticBackupRunning) return;
  const raw = await getSetting("backup", {});
  const settings = normalizeBackupSettings(raw, raw);
  const due = nextBackupAt(settings);
  if (!settings.enabled || !due || due.getTime() > Date.now()) return;
  automaticBackupRunning = true;
  try {
    const filename = await createBackupFile();
    const saved = { ...settings, lastRunAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO app_settings(key,value,updated_at) VALUES('backup',$1::jsonb,now())
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
      [JSON.stringify(saved)],
    );
    await cleanupOldBackups(saved.retentionDays);
    await audit(null, "automatic_create", "backup", filename, { detail: { intervalDays: saved.intervalDays } });
    broadcast({ type: "backup", filename });
  } finally {
    automaticBackupRunning = false;
  }
}

async function api(req, res, url, user) {
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const ip = requesterIp(req);
    const history = (loginAttempts.get(ip) || []).filter((time) => Date.now() - time < 15 * 60_000);
    if (history.length >= 8) return errorResponse(res, 429, "تعداد تلاش ورود زیاد است؛ ۱۵ دقیقه بعد دوباره امتحان کنید.");
    const body = await readBody(req);
    const found = await pool.query(
      "SELECT id,username,display_name AS \"displayName\",password_hash AS \"passwordHash\",role,active FROM users WHERE lower(username)=lower($1)",
      [cleanText(body.username, 80)],
    );
    const account = found.rows[0];
    if (!account || !account.active || !(await verifyPassword(String(body.password || ""), account.passwordHash))) {
      history.push(Date.now());
      loginAttempts.set(ip, history);
      return errorResponse(res, 401, "نام کاربری یا رمز عبور اشتباه است.");
    }
    loginAttempts.delete(ip);
    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [tokenHash(token), account.id],
    );
    await audit(account, "login", "session", null);
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token, COOKIE_SECURE) });
  }

  if (!user) return errorResponse(res, 401, "ابتدا وارد سامانه شوید.");

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).ems_session;
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(token)]);
    return json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(COOKIE_SECURE) });
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") return json(res, 200, await listBootstrap(user));

  if (req.method === "GET" && pathname === "/api/search") {
    return json(res, 200, { ok: true, items: await searchData(user, url.searchParams.get("q") || "") });
  }

  if (req.method === "GET" && pathname === "/api/inventory") {
    return json(res, 200, { ok: true, items: await inventoryData(user) });
  }

  if (req.method === "GET" && pathname === "/api/backups") {
    requireAdmin(user);
    const settings = normalizeBackupSettings(await getSetting("backup", {}), await getSetting("backup", {}));
    return json(res, 200, {
      ok: true,
      path: BACKUP_DISPLAY_PATH,
      items: await listBackupFiles(),
      settings,
      nextRunAt: nextBackupAt(settings)?.toISOString() || null,
    });
  }

  if (req.method === "PUT" && pathname === "/api/backups/settings") {
    requireAdmin(user);
    const body = await readBody(req);
    const current = await getSetting("backup", {});
    const settings = normalizeBackupSettings(body, current);
    await pool.query(
      `INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES('backup',$1::jsonb,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
      [JSON.stringify(settings), user.id],
    );
    await audit(user, "update", "backup_settings", null, { detail: settings });
    return json(res, 200, { ok: true, settings, nextRunAt: nextBackupAt(settings)?.toISOString() || null });
  }

  if (req.method === "POST" && pathname === "/api/backups") {
    requireAdmin(user);
    const filename = await createBackupFile();
    await audit(user, "create", "backup", filename);
    return json(res, 201, { ok: true, filename });
  }

  if (req.method === "GET" && pathname === "/api/trash") {
    requireAdmin(user);
    const items = await pool.query(
      `SELECT 'company' AS kind,id,name AS label,NULL::text AS "companyName",deleted_at AS "deletedAt" FROM companies WHERE deleted_at IS NOT NULL
       UNION ALL
       SELECT 'space',s.id,s.name || ' — ' || s.cidr,c.name,s.deleted_at FROM address_spaces s JOIN companies c ON c.id=s.company_id WHERE s.deleted_at IS NOT NULL
       UNION ALL
       SELECT 'prefix',p.id,p.name || ' — ' || p.cidr,c.name,p.deleted_at FROM prefixes p JOIN address_spaces s ON s.id=p.space_id JOIN companies c ON c.id=s.company_id WHERE p.deleted_at IS NOT NULL
       UNION ALL
       SELECT 'host',h.id,COALESCE(NULLIF(h.name,''),h.ip) || ' — ' || h.ip,c.name,h.deleted_at FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id WHERE h.deleted_at IS NOT NULL
       ORDER BY "deletedAt" DESC`,
    );
    return json(res, 200, { ok: true, retentionDays: 30, items: items.rows });
  }

  const trashMutation = pathname.match(/^\/api\/trash\/(company|space|prefix|host)\/([^/]+)$/);
  if (trashMutation && req.method === "POST") {
    requireAdmin(user);
    const tables = { company: "companies", space: "address_spaces", prefix: "prefixes", host: "hosts" };
    const table = tables[trashMutation[1]];
    const restored = await pool.query(`UPDATE ${table} SET deleted_at=NULL,deleted_by=NULL,updated_at=now() WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id`, [trashMutation[2]]);
    if (!restored.rowCount) throw Object.assign(new Error("رکوردی برای بازگردانی پیدا نشد."), { status: 404 });
    await audit(user, "restore", trashMutation[1], trashMutation[2]);
    broadcast({ type: "restore", entityId: trashMutation[2] });
    return json(res, 200, { ok: true });
  }

  if (trashMutation && req.method === "DELETE") {
    requireAdmin(user);
    const tables = { company: "companies", space: "address_spaces", prefix: "prefixes", host: "hosts" };
    const table = tables[trashMutation[1]];
    const removed = await pool.query(`DELETE FROM ${table} WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id`, [trashMutation[2]]);
    if (!removed.rowCount) throw Object.assign(new Error("رکوردی برای حذف نهایی پیدا نشد."), { status: 404 });
    await audit(user, "purge", trashMutation[1], trashMutation[2]);
    broadcast({ type: "purge", entityId: trashMutation[2] });
    return json(res, 200, { ok: true });
  }

  const backupDownload = pathname.match(/^\/api\/backups\/([^/]+)\/download$/);
  if (req.method === "GET" && backupDownload) {
    requireAdmin(user);
    const filename = validBackupFilename(decodeURIComponent(backupDownload[1]));
    const filePath = path.join(BACKUP_DIR, filename);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw Object.assign(new Error("فایل پشتیبان پیدا نشد."), { status: 404 });
    res.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return createReadStream(filePath).pipe(res);
  }

  const backupDelete = pathname.match(/^\/api\/backups\/([^/]+)$/);
  if (req.method === "DELETE" && backupDelete) {
    requireAdmin(user);
    const filename = validBackupFilename(decodeURIComponent(backupDelete[1]));
    await fs.unlink(path.join(BACKUP_DIR, filename)).catch((error) => {
      if (error.code === "ENOENT") throw Object.assign(new Error("فایل پشتیبان پیدا نشد."), { status: 404 });
      throw error;
    });
    await audit(user, "delete", "backup", filename);
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/maps") {
    const companyIds = (await listBootstrap(user)).companies.map((item) => item.id);
    const maps = user.role === "admin"
      ? await pool.query(`SELECT m.id,m.company_id AS "companyId",m.name,m.description,c.name AS "companyName"
                            FROM topology_maps m JOIN companies c ON c.id=m.company_id
                           WHERE c.deleted_at IS NULL ORDER BY m.name`)
      : companyIds.length
        ? await pool.query(`SELECT m.id,m.company_id AS "companyId",m.name,m.description,c.name AS "companyName"
                              FROM topology_maps m LEFT JOIN companies c ON c.id=m.company_id
                             WHERE m.company_id=ANY($1::text[]) ORDER BY m.name`, [companyIds])
        : { rows: [] };
    return json(res, 200, { ok: true, items: maps.rows });
  }

  if (req.method === "POST" && pathname === "/api/maps") {
    requireWriter(user);
    const body = await readBody(req);
    const companyId = cleanText(body.companyId, 80);
    if (!companyId || !(await canManageCompany(user, companyId))) throw Object.assign(new Error("برای ایجاد نقشه باید به کل شرکت دسترسی داشته باشید."), { status: 403 });
    const name = cleanText(body.name, 120);
    if (!name) throw new Error("نام نقشه الزامی است.");
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO topology_maps(id,company_id,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)`,
      [id, companyId, name, cleanText(body.description, 1000), user.id],
    );
    await audit(user, "create", "topology_map", id, { companyId, detail: { name } });
    broadcast({ type: "topology", companyId, entityId: id });
    return json(res, 201, { ok: true, id });
  }

  const mapMutation = pathname.match(/^\/api\/maps\/([^/]+)$/);
  if (mapMutation && req.method === "PUT") {
    requireWriter(user);
    const map = await getMapForUser(user, mapMutation[1], { write: true });
    const body = await readBody(req);
    const name = cleanText(body.name, 120);
    if (!name) throw new Error("نام نقشه الزامی است.");
    await pool.query("UPDATE topology_maps SET name=$1,description=$2,updated_by=$3,updated_at=now() WHERE id=$4", [name, cleanText(body.description, 1000), user.id, map.id]);
    await audit(user, "update", "topology_map", map.id, { companyId: map.companyId, detail: { name } });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 200, { ok: true });
  }

  if (mapMutation && req.method === "DELETE") {
    requireWriter(user);
    const map = await getMapForUser(user, mapMutation[1], { write: true });
    await pool.query("DELETE FROM topology_maps WHERE id=$1", [map.id]);
    await audit(user, "delete", "topology_map", map.id, { companyId: map.companyId, detail: { name: map.name } });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 200, { ok: true });
  }

  const mapDataMatch = pathname.match(/^\/api\/maps\/([^/]+)\/data$/);
  if (req.method === "GET" && mapDataMatch) {
    const map = await getMapForUser(user, mapDataMatch[1]);
    const spaceIds = await accessibleSpaceIds(user);
    const nodes = spaceIds.length ? await pool.query(
      `SELECT n.id,n.host_id AS "hostId",n.x,n.y,n.width,n.height,h.ip,h.name,h.type,h.status,h.vendor,h.model,
              h.radio_mode AS "radioMode",h.ssid,s.id AS "spaceId",s.name AS "spaceName",s.cidr AS "spaceCidr"
         FROM topology_nodes n JOIN hosts h ON h.id=n.host_id JOIN address_spaces s ON s.id=h.space_id
        WHERE n.map_id=$1 AND h.space_id=ANY($2::text[]) AND h.deleted_at IS NULL AND s.deleted_at IS NULL
        ORDER BY h.name,h.ip`,
      [map.id, spaceIds],
    ) : { rows: [] };
    const nodeIds = nodes.rows.map((item) => item.id);
    const links = nodeIds.length ? await pool.query(
      `SELECT l.id,l.from_node_id AS "fromNodeId",l.to_node_id AS "toNodeId",
              l.from_port_id AS "fromPortId",l.to_port_id AS "toPortId",fp.name AS "fromPortName",tp.name AS "toPortName",
              l.label,l.medium,l.speed,l.vlan,l.color,l.status,l.discovered_by AS "discoveredBy",l.confirmed
         FROM topology_links l
         LEFT JOIN device_ports fp ON fp.id=l.from_port_id LEFT JOIN device_ports tp ON tp.id=l.to_port_id
        WHERE l.map_id=$1 AND l.from_node_id=ANY($2::text[]) AND l.to_node_id=ANY($2::text[]) ORDER BY l.created_at`,
      [map.id, nodeIds],
    ) : { rows: [] };
    return json(res, 200, { ok: true, map, nodes: nodes.rows, links: links.rows });
  }

  const mapNodes = pathname.match(/^\/api\/maps\/([^/]+)\/nodes$/);
  if (req.method === "POST" && mapNodes) {
    requireWriter(user);
    const map = await getMapForUser(user, mapNodes[1], { write: true });
    const body = await readBody(req);
    const host = (await pool.query(
      `SELECT h.id,h.space_id AS "spaceId",s.company_id AS "companyId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id WHERE h.id=$1`,
      [cleanText(body.hostId, 80)],
    )).rows[0];
    if (!host || host.companyId !== map.companyId || !(await canAccessSpace(user, host.spaceId))) throw Object.assign(new Error("تجهیز انتخاب‌شده معتبر نیست."), { status: 404 });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO topology_nodes(id,map_id,host_id,x,y) VALUES($1,$2,$3,$4,$5)`,
      [id, map.id, host.id, Math.round(Number(body.x) || 80), Math.round(Number(body.y) || 80)],
    );
    await audit(user, "create", "topology_node", id, { companyId: map.companyId, spaceId: host.spaceId, detail: { hostId: host.id } });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 201, { ok: true, id });
  }

  const mapNodeMutation = pathname.match(/^\/api\/maps\/([^/]+)\/nodes\/([^/]+)$/);
  if (mapNodeMutation && req.method === "PUT") {
    requireWriter(user);
    const map = await getMapForUser(user, mapNodeMutation[1], { write: true });
    const body = await readBody(req);
    const updated = await pool.query(
      `UPDATE topology_nodes SET x=$1,y=$2,updated_at=now() WHERE id=$3 AND map_id=$4 RETURNING id`,
      [Math.max(0, Math.round(Number(body.x) || 0)), Math.max(0, Math.round(Number(body.y) || 0)), mapNodeMutation[2], map.id],
    );
    if (!updated.rowCount) throw Object.assign(new Error("گره نقشه پیدا نشد."), { status: 404 });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 200, { ok: true });
  }

  if (mapNodeMutation && req.method === "DELETE") {
    requireWriter(user);
    const map = await getMapForUser(user, mapNodeMutation[1], { write: true });
    const removed = await pool.query("DELETE FROM topology_nodes WHERE id=$1 AND map_id=$2 RETURNING id", [mapNodeMutation[2], map.id]);
    if (!removed.rowCount) throw Object.assign(new Error("گره نقشه پیدا نشد."), { status: 404 });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 200, { ok: true });
  }

  const mapLinks = pathname.match(/^\/api\/maps\/([^/]+)\/links$/);
  if (req.method === "POST" && mapLinks) {
    requireWriter(user);
    const map = await getMapForUser(user, mapLinks[1], { write: true });
    const body = await readBody(req);
    const fromNodeId = cleanText(body.fromNodeId, 80);
    const toNodeId = cleanText(body.toNodeId, 80);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) throw new Error("دو تجهیز متفاوت را برای اتصال انتخاب کنید.");
    const nodes = await pool.query("SELECT id,host_id AS \"hostId\" FROM topology_nodes WHERE map_id=$1 AND id=ANY($2::text[])", [map.id, [fromNodeId, toNodeId]]);
    if (nodes.rowCount !== 2) throw Object.assign(new Error("گره‌های اتصال معتبر نیستند."), { status: 404 });
    const nodeHosts = new Map(nodes.rows.map((item) => [item.id, item.hostId]));
    const fromPortId = cleanText(body.fromPortId, 80) || null;
    const toPortId = cleanText(body.toPortId, 80) || null;
    for (const [portId, nodeId] of [[fromPortId, fromNodeId], [toPortId, toNodeId]]) {
      if (!portId) continue;
      const port = await pool.query("SELECT 1 FROM device_ports WHERE id=$1 AND host_id=$2", [portId, nodeHosts.get(nodeId)]);
      if (!port.rowCount) throw new Error("پورت انتخاب‌شده متعلق به تجهیز نیست.");
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO topology_links(id,map_id,from_node_id,to_node_id,from_port_id,to_port_id,label,medium,speed,vlan,color,status,discovered_by,confirmed)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',true)`,
      [id, map.id, fromNodeId, toNodeId, fromPortId, toPortId, cleanText(body.label, 160), cleanText(body.medium, 40) || "ethernet", cleanText(body.speed, 40), cleanText(body.vlan, 80), validColor(body.color, "#64748b"), cleanText(body.status, 40) || "unknown"],
    );
    await audit(user, "create", "topology_link", id, { companyId: map.companyId, detail: { fromNodeId, toNodeId } });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 201, { ok: true, id });
  }

  const mapLinkMutation = pathname.match(/^\/api\/maps\/([^/]+)\/links\/([^/]+)$/);
  if (mapLinkMutation && req.method === "PUT") {
    requireWriter(user);
    const map = await getMapForUser(user, mapLinkMutation[1], { write: true });
    const body = await readBody(req);
    const current = (await pool.query(
      `SELECT l.id,fn.host_id AS "fromHostId",tn.host_id AS "toHostId"
         FROM topology_links l JOIN topology_nodes fn ON fn.id=l.from_node_id JOIN topology_nodes tn ON tn.id=l.to_node_id
        WHERE l.id=$1 AND l.map_id=$2`,
      [mapLinkMutation[2], map.id],
    )).rows[0];
    if (!current) throw Object.assign(new Error("اتصال نقشه پیدا نشد."), { status: 404 });
    const fromPortId = cleanText(body.fromPortId, 80) || null;
    const toPortId = cleanText(body.toPortId, 80) || null;
    for (const [portId, hostId] of [[fromPortId, current.fromHostId], [toPortId, current.toHostId]]) {
      if (!portId) continue;
      const port = await pool.query("SELECT 1 FROM device_ports WHERE id=$1 AND host_id=$2", [portId, hostId]);
      if (!port.rowCount) throw new Error("پورت انتخاب‌شده متعلق به تجهیز نیست.");
    }
    await pool.query(
      `UPDATE topology_links SET from_port_id=$1,to_port_id=$2,label=$3,medium=$4,speed=$5,vlan=$6,color=$7,status=$8,updated_at=now()
        WHERE id=$9 AND map_id=$10`,
      [fromPortId, toPortId, cleanText(body.label, 160), cleanText(body.medium, 40) || "ethernet", cleanText(body.speed, 40), cleanText(body.vlan, 80), validColor(body.color, "#64748b"), cleanText(body.status, 40) || "unknown", current.id, map.id],
    );
    await audit(user, "update", "topology_link", current.id, { companyId: map.companyId });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 200, { ok: true });
  }

  if (mapLinkMutation && req.method === "DELETE") {
    requireWriter(user);
    const map = await getMapForUser(user, mapLinkMutation[1], { write: true });
    const removed = await pool.query("DELETE FROM topology_links WHERE id=$1 AND map_id=$2 RETURNING id", [mapLinkMutation[2], map.id]);
    if (!removed.rowCount) throw Object.assign(new Error("اتصال نقشه پیدا نشد."), { status: 404 });
    broadcast({ type: "topology", companyId: map.companyId, entityId: map.id });
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    eventClients.add(res);
    const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 20_000);
    req.on("close", () => { clearInterval(keepAlive); eventClients.delete(res); });
    return;
  }

  const dataMatch = pathname.match(/^\/api\/spaces\/([^/]+)\/data$/);
  if (req.method === "GET" && dataMatch) return json(res, 200, await spaceData(user, dataMatch[1]));

  const exportMatch = pathname.match(/^\/api\/spaces\/([^/]+)\/export$/);
  if (req.method === "GET" && exportMatch) {
    const space = await getSpaceForUser(user, exportMatch[1]);
    const payload = await buildSubnetPackage({ pool, space, cidr: space.cidr, appVersion: APP_VERSION, parseCidr, contains });
    const body = Buffer.from(JSON.stringify(payload, null, 2));
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Content-Disposition": `attachment; filename="ems-ipam-${space.cidr.replaceAll("/", "-")}.emsipam.json"`,
      "Cache-Control": "no-store",
    });
    return res.end(body);
  }

  const prefixExport = pathname.match(/^\/api\/prefixes\/([^/]+)\/export$/);
  if (req.method === "GET" && prefixExport) {
    const found = await pool.query(
      `SELECT p.id,p.cidr,p.space_id AS "spaceId" FROM prefixes p WHERE p.id=$1 AND p.deleted_at IS NULL`,
      [prefixExport[1]],
    );
    const prefix = found.rows[0];
    if (!prefix) throw Object.assign(new Error("زیرشبکه پیدا نشد."), { status: 404 });
    const space = await getSpaceForUser(user, prefix.spaceId);
    const payload = await buildSubnetPackage({ pool, space, cidr: prefix.cidr, appVersion: APP_VERSION, parseCidr, contains });
    const body = Buffer.from(JSON.stringify(payload, null, 2));
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Content-Disposition": `attachment; filename="ems-ipam-${prefix.cidr.replaceAll("/", "-")}.emsipam.json"`,
      "Cache-Control": "no-store",
    });
    return res.end(body);
  }

  if (req.method === "POST" && pathname === "/api/imports/subnet") {
    requireWriter(user);
    const body = await readBody(req);
    const space = await getSpaceForUser(user, cleanText(body.destinationSpaceId, 80));
    if (!(await canManageCompany(user, space.companyId))) throw Object.assign(new Error("برای ورود اطلاعات باید به کل شرکت مقصد دسترسی ویرایش داشته باشید."), { status: 403 });
    const result = await importSubnetPackage({
      pool,
      user,
      destinationSpace: space,
      packageData: body.package,
      mode: body.mode,
      parseCidr,
      contains,
    });
    await audit(user, "import", "subnet_package", result.cidr, { companyId: space.companyId, spaceId: space.id, detail: result });
    broadcast({ type: "import", companyId: space.companyId, spaceId: space.id });
    return json(res, 200, { ok: true, result });
  }

  const companyMutation = pathname.match(/^\/api\/companies\/([^/]+)$/);
  if (req.method === "GET" && companyMutation) return json(res, 200, await companyData(user, companyMutation[1]));

  if (req.method === "POST" && pathname === "/api/companies") {
    requireAdmin(user);
    const body = await readBody(req);
    const name = cleanText(body.name, 120);
    if (!name) throw new Error("نام شرکت الزامی است.");
    const id = crypto.randomUUID();
    const parentId = cleanText(body.parentCompanyId, 80) || null;
    if (parentId && !(await canAccessCompany(user, parentId))) throw new Error("شرکت مادر معتبر نیست.");
    const kind = ["company", "branch", "customer", "site"].includes(body.kind) ? body.kind : "company";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO companies(id,parent_company_id,kind,code,name,description,address,postal_code,phone,manager_name,latitude,longitude,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, parentId, kind, cleanText(body.code, 80), name, cleanText(body.description, 2000), cleanText(body.address, 1000),
          cleanText(body.postalCode, 40), cleanText(body.phone, 80), cleanText(body.managerName, 160),
          nullableCoordinate(body.latitude, -90, 90), nullableCoordinate(body.longitude, -180, 180), cleanText(body.notes, 12000)],
      );
      await replaceCompanyDetails(client, id, body);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await audit(user, "create", "company", id, { companyId: id, detail: { name, kind } });
    broadcast({ type: "company", companyId: id });
    return json(res, 201, { ok: true, id });
  }

  if (req.method === "PUT" && companyMutation) {
    requireWriter(user);
    if (!(await canManageCompany(user, companyMutation[1]))) throw Object.assign(new Error("دسترسی ویرایش این شرکت را ندارید."), { status: 403 });
    const body = await readBody(req);
    const name = cleanText(body.name, 120);
    if (!name) throw new Error("نام شرکت الزامی است.");
    const parentId = cleanText(body.parentCompanyId, 80) || null;
    if (parentId === companyMutation[1]) throw new Error("شرکت نمی‌تواند زیرمجموعه خودش باشد.");
    if (parentId && !(await canAccessCompany(user, parentId))) throw new Error("شرکت مادر معتبر نیست.");
    if (parentId) {
      const cycle = await pool.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM companies WHERE parent_company_id=$1 AND deleted_at IS NULL
           UNION
           SELECT c.id FROM companies c JOIN descendants d ON c.parent_company_id=d.id WHERE c.deleted_at IS NULL
         ) SELECT 1 FROM descendants WHERE id=$2 LIMIT 1`,
        [companyMutation[1], parentId],
      );
      if (cycle.rowCount) throw new Error("شرکت مادر نمی‌تواند از زیرمجموعه‌های همین شرکت انتخاب شود.");
    }
    const kind = ["company", "branch", "customer", "site"].includes(body.kind) ? body.kind : "company";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE companies SET parent_company_id=$1,kind=$2,code=$3,name=$4,description=$5,address=$6,postal_code=$7,
           phone=$8,manager_name=$9,latitude=$10,longitude=$11,notes=$12,updated_at=now()
         WHERE id=$13 AND deleted_at IS NULL RETURNING id`,
        [parentId, kind, cleanText(body.code, 80), name, cleanText(body.description, 2000), cleanText(body.address, 1000),
          cleanText(body.postalCode, 40), cleanText(body.phone, 80), cleanText(body.managerName, 160),
          nullableCoordinate(body.latitude, -90, 90), nullableCoordinate(body.longitude, -180, 180), cleanText(body.notes, 12000), companyMutation[1]],
      );
      if (!updated.rowCount) throw Object.assign(new Error("شرکت پیدا نشد."), { status: 404 });
      await replaceCompanyDetails(client, companyMutation[1], body);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await audit(user, "update", "company", companyMutation[1], { companyId: companyMutation[1], detail: { name } });
    broadcast({ type: "company", companyId: companyMutation[1] });
    return json(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && companyMutation) {
    requireAdmin(user);
    const found = await pool.query("SELECT id,name FROM companies WHERE id=$1 AND deleted_at IS NULL", [companyMutation[1]]);
    if (!found.rowCount) throw Object.assign(new Error("شرکت پیدا نشد."), { status: 404 });
    const children = await pool.query("SELECT 1 FROM companies WHERE parent_company_id=$1 AND deleted_at IS NULL LIMIT 1", [companyMutation[1]]);
    if (children.rowCount) throw Object.assign(new Error("ابتدا شرکت‌ها یا شعبه‌های زیرمجموعه را حذف یا جابه‌جا کنید."), { status: 409 });
    await audit(user, "delete", "company", companyMutation[1], { detail: { name: found.rows[0].name } });
    await pool.query("UPDATE companies SET deleted_at=now(),deleted_by=$1 WHERE id=$2", [user.id, companyMutation[1]]);
    broadcast({ type: "company", companyId: companyMutation[1] });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/spaces") {
    requireWriter(user);
    const body = await readBody(req);
    if (!(await canManageCompany(user, body.companyId))) throw Object.assign(new Error("برای ایجاد شبکه باید به کل شرکت دسترسی داشته باشید."), { status: 403 });
    const cidr = validateRootCidr(body.cidr).cidr;
    const name = cleanText(body.name, 120) || cidr;
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO address_spaces(id,company_id,name,cidr,color,description) VALUES($1,$2,$3,$4,$5,$6)",
      [id, body.companyId, name, cidr, validColor(body.color), cleanText(body.description, 1000)],
    );
    await audit(user, "create", "space", id, { companyId: body.companyId, spaceId: id, detail: { name, cidr } });
    broadcast({ type: "space", companyId: body.companyId, spaceId: id });
    return json(res, 201, { ok: true, id });
  }

  const spaceMutation = pathname.match(/^\/api\/spaces\/([^/]+)$/);
  if (req.method === "PUT" && spaceMutation) {
    requireWriter(user);
    const current = await getSpaceForUser(user, spaceMutation[1]);
    const body = await readBody(req);
    const next = validateRootCidr(body.cidr);
    const [prefixes, hosts] = await Promise.all([
      pool.query("SELECT cidr FROM prefixes WHERE space_id=$1 AND deleted_at IS NULL", [current.id]),
      pool.query("SELECT ip FROM hosts WHERE space_id=$1 AND deleted_at IS NULL", [current.id]),
    ]);
    if (prefixes.rows.some((item) => !contains(next, parseCidr(item.cidr))) || hosts.rows.some((item) => !contains(next, item.ip))) {
      throw Object.assign(new Error("رنج جدید شامل همه زیررنج‌ها و IPهای ثبت‌شده نیست."), { status: 409 });
    }
    const name = cleanText(body.name, 120) || next.cidr;
    await pool.query(
      "UPDATE address_spaces SET name=$1,cidr=$2,color=$3,description=$4,updated_at=now() WHERE id=$5 AND deleted_at IS NULL",
      [name, next.cidr, validColor(body.color), cleanText(body.description, 1000), current.id],
    );
    await audit(user, "update", "space", current.id, { companyId: current.companyId, spaceId: current.id, detail: { name, cidr: next.cidr } });
    broadcast({ type: "space", companyId: current.companyId, spaceId: current.id });
    return json(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && spaceMutation) {
    requireWriter(user);
    const current = await getSpaceForUser(user, spaceMutation[1]);
    await audit(user, "delete", "space", current.id, { companyId: current.companyId, detail: { name: current.name, cidr: current.cidr } });
    await pool.query("UPDATE address_spaces SET deleted_at=now(),deleted_by=$1 WHERE id=$2", [user.id, current.id]);
    broadcast({ type: "space", companyId: current.companyId, spaceId: current.id });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/prefixes") {
    requireWriter(user);
    const body = await readBody(req);
    const space = await getSpaceForUser(user, body.spaceId);
    const cidr = validateChildCidr(body.cidr, space.cidr).cidr;
    const requestedId = cleanText(body.id, 80);
    const id = requestedId || crypto.randomUUID();
    const values = [
      id, body.spaceId, cidr, cleanText(body.name, 160) || cidr,
      cleanText(body.status, 40) || "active", cleanText(body.role, 100), cleanText(body.vlan, 40),
      cleanText(body.gateway, 80) || defaultGateway(cidr), validColor(body.color), cleanText(body.description, 2000), user.id,
    ];
    if (requestedId) {
      const current = await pool.query("SELECT space_id AS \"spaceId\" FROM prefixes WHERE id=$1 AND deleted_at IS NULL", [requestedId]);
      if (!current.rowCount || current.rows[0].spaceId !== space.id) {
        throw Object.assign(new Error("رنج پیدا نشد یا به این شبکه تعلق ندارد."), { status: 404 });
      }
      await pool.query(
        `UPDATE prefixes SET cidr=$3,name=$4,status=$5,role=$6,vlan=$7,gateway=$8,color=$9,
             description=$10,updated_by=$11,updated_at=now()
          WHERE id=$1 AND space_id=$2`,
        values,
      );
    } else {
      await pool.query(
        `INSERT INTO prefixes(id,space_id,cidr,name,status,role,vlan,gateway,color,description,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        values,
      );
    }
    await audit(user, requestedId ? "update" : "create", "prefix", id, { companyId: space.companyId, spaceId: space.id, detail: { cidr } });
    broadcast({ type: "prefix", companyId: space.companyId, spaceId: space.id, entityId: id });
    return json(res, 200, { ok: true, id });
  }

  const prefixDelete = pathname.match(/^\/api\/prefixes\/([^/]+)$/);
  if (req.method === "DELETE" && prefixDelete) {
    requireWriter(user);
    const found = await pool.query(
      "SELECT p.id,p.cidr,p.space_id AS \"spaceId\",s.company_id AS \"companyId\" FROM prefixes p JOIN address_spaces s ON s.id=p.space_id WHERE p.id=$1 AND p.deleted_at IS NULL",
      [prefixDelete[1]],
    );
    const item = found.rows[0];
    if (!item || !(await canAccessSpace(user, item.spaceId))) throw Object.assign(new Error("رنج پیدا نشد."), { status: 404 });
    await pool.query("UPDATE prefixes SET deleted_at=now(),deleted_by=$1 WHERE id=$2", [user.id, item.id]);
    await audit(user, "delete", "prefix", item.id, { companyId: item.companyId, spaceId: item.spaceId, detail: { cidr: item.cidr } });
    broadcast({ type: "prefix", companyId: item.companyId, spaceId: item.spaceId, entityId: item.id });
    return json(res, 200, { ok: true });
  }

  if (req.method === "PUT" && pathname === "/api/hosts") {
    requireWriter(user);
    const body = await readBody(req);
    const space = await getSpaceForUser(user, body.spaceId);
    const ip = validateHostIp(body.ip, space.cidr);
    const requestedId = cleanText(body.id, 80);
    let current = null;
    if (requestedId) {
      current = (await pool.query(
        "SELECT id,space_id AS \"spaceId\" FROM hosts WHERE id=$1 AND deleted_at IS NULL",
        [requestedId],
      )).rows[0] || null;
      if (!current || !(await canAccessSpace(user, current.spaceId))) {
        throw Object.assign(new Error("اطلاعات IP پیدا نشد یا دسترسی ندارید."), { status: 404 });
      }
    } else {
      current = (await pool.query(
        "SELECT id,space_id AS \"spaceId\" FROM hosts WHERE space_id=$1 AND ip=$2",
        [space.id, ip],
      )).rows[0] || null;
    }
    const id = current?.id || crypto.randomUUID();
    const secretCiphertext = "";
    const monitorSecretCiphertext = "";
    const radioMode = ["", "ap", "station"].includes(String(body.radioMode || "").toLowerCase()) ? String(body.radioMode || "").toLowerCase() : "";
    let radioParentHostId = cleanText(body.radioParentHostId, 80) || null;
    if (radioParentHostId) {
      const parent = await pool.query(
        `SELECT h.id,s.id AS "spaceId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id
          WHERE h.id=$1 AND h.radio_mode='ap' AND h.deleted_at IS NULL AND s.deleted_at IS NULL`,
        [radioParentHostId],
      );
      if (!parent.rowCount || !(await canAccessSpace(user, parent.rows[0].spaceId))) throw Object.assign(new Error("رادیوی AP انتخاب‌شده پیدا نشد یا دسترسی ندارید."), { status: 404 });
      if (parent.rows[0].id === id) throw new Error("یک رادیو نمی‌تواند والد خودش باشد.");
    }
    if (radioMode !== "station") radioParentHostId = null;
    const monitorEnabled = false;
    const monitorDriver = "";
    const monitorPort = 8728;
    const monitorInterval = 60;
    const values = [
      id, space.id, ip, cleanText(body.name, 160), cleanText(body.status, 40) || "active",
      cleanText(body.type, 100), cleanText(body.os, 160), cleanText(body.mac, 32), cleanText(body.vlan, 40),
      cleanText(body.username, 120), cleanText(body.owner, 160), cleanText(body.location, 200),
      cleanText(body.secretRef, 500), secretCiphertext, cleanText(body.notes, 3000), JSON.stringify(normalizePorts(body.ports)), user.id,
      cleanText(body.vendor, 100), cleanText(body.model, 120), cleanText(body.serial, 120), cleanText(body.firmware, 120),
      radioMode, cleanText(body.ssid, 160), cleanText(body.frequency, 80), cleanText(body.channel, 80),
      cleanText(body.signal, 40), radioParentHostId, JSON.stringify(normalizeConnections(body.connectionMethods)),
      monitorEnabled, monitorDriver, monitorPort, "", monitorSecretCiphertext,
      "", monitorInterval,
    ];
    const client = await pool.connect();
    let savedId = id;
    try {
      await client.query("BEGIN");
      const saved = await client.query(
        `INSERT INTO hosts(id,space_id,ip,name,status,type,os,mac,vlan,username,owner,location,secret_ref,secret_ciphertext,notes,ports,created_by,updated_by,
                           vendor,model,serial,firmware,radio_mode,ssid,frequency,channel,signal,radio_parent_host_id,connection_methods,
                           monitor_enabled,monitor_driver,monitor_port,monitor_username,monitor_secret_ciphertext,monitor_ca_pem,monitor_interval)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,
                $29,$30,$31,$32,$33,$34,$35)
         ON CONFLICT(id) DO UPDATE SET space_id=excluded.space_id,ip=excluded.ip,name=excluded.name,status=excluded.status,type=excluded.type,
           os=excluded.os,mac=excluded.mac,vlan=excluded.vlan,username=excluded.username,owner=excluded.owner,
           location=excluded.location,secret_ref=excluded.secret_ref,secret_ciphertext=excluded.secret_ciphertext,
           notes=excluded.notes,ports=excluded.ports,vendor=excluded.vendor,model=excluded.model,serial=excluded.serial,
           firmware=excluded.firmware,radio_mode=excluded.radio_mode,ssid=excluded.ssid,frequency=excluded.frequency,
           channel=excluded.channel,signal=excluded.signal,radio_parent_host_id=excluded.radio_parent_host_id,
           connection_methods=excluded.connection_methods,monitor_enabled=excluded.monitor_enabled,monitor_driver=excluded.monitor_driver,
           monitor_port=excluded.monitor_port,monitor_username=excluded.monitor_username,monitor_secret_ciphertext=excluded.monitor_secret_ciphertext,
           monitor_ca_pem=excluded.monitor_ca_pem,monitor_interval=excluded.monitor_interval,deleted_at=NULL,deleted_by=NULL,
           updated_by=excluded.updated_by,updated_at=now()
         RETURNING id`,
        values,
      );
      savedId = saved.rows[0].id;
      if (Array.isArray(body.devicePorts)) {
        const ports = normalizeDevicePorts(body.devicePorts);
        await client.query("DELETE FROM device_ports WHERE host_id=$1", [savedId]);
        for (const item of ports) {
          await client.query(
            `INSERT INTO device_ports(id,host_id,name,description,port_type,speed,vlan_mode,vlan,enabled)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [item.id, savedId, item.name, item.description, item.portType, item.speed, item.vlanMode, item.vlan, item.enabled],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await audit(user, current ? "update" : "create", "host", savedId, { companyId: space.companyId, spaceId: space.id, detail: { ip } });
    broadcast({ type: "host", companyId: space.companyId, spaceId: space.id, entityId: savedId });
    return json(res, 200, { ok: true, id: savedId });
  }

  const hostSecret = pathname.match(/^\/api\/hosts\/([^/]+)\/([^/]+)\/secret$/);
  if (req.method === "GET" && hostSecret) {
    return errorResponse(res, 410, "ذخیره و نمایش رمز تجهیزات برای حفظ امنیت غیرفعال شده است.");
  }

  const hostDelete = pathname.match(/^\/api\/hosts\/([^/]+)\/([^/]+)$/);
  if (req.method === "DELETE" && hostDelete) {
    requireWriter(user);
    const space = await getSpaceForUser(user, hostDelete[1]);
    const ip = validateHostIp(decodeURIComponent(hostDelete[2]), space.cidr);
    const found = await pool.query("UPDATE hosts SET deleted_at=now(),deleted_by=$1 WHERE space_id=$2 AND ip=$3 AND deleted_at IS NULL RETURNING id", [user.id, space.id, ip]);
    if (!found.rowCount) throw Object.assign(new Error("اطلاعات IP پیدا نشد."), { status: 404 });
    await audit(user, "delete", "host", found.rows[0].id, { companyId: space.companyId, spaceId: space.id, detail: { ip } });
    broadcast({ type: "host", companyId: space.companyId, spaceId: space.id, entityId: found.rows[0].id });
    return json(res, 200, { ok: true });
  }

  const hostMonitorTest = pathname.match(/^\/api\/hosts\/([^/]+)\/monitor\/test$/);
  if (req.method === "POST" && hostMonitorTest) {
    return errorResponse(res, 410, "پایش خودکار تجهیزات غیرفعال است؛ عملیات فقط با حضور کاربر انجام می‌شود.");
  }

  if (req.method === "POST" && pathname === "/api/mikrotik/script") {
    requireWriter(user);
    const body = await readBody(req);
    return json(res, 200, { ok: true, script: buildMikrotikScript(body) });
  }

  if (req.method === "POST" && pathname === "/api/ping") {
    requireWriter(user);
    const body = await readBody(req);
    const space = await getSpaceForUser(user, body.spaceId);
    const subnet = parseCidr(body.cidr);
    if (!subnet || subnet.prefix !== 24 || !contains(parseCidr(space.cidr), subnet)) throw new Error("برای پینگ، یک شبکهٔ /24 معتبر انتخاب کنید.");
    const ips = Array.from({ length: 254 }, (_, index) => intToIpv4(subnet.start + index + 1));
    const results = await pingMany(ips, { concurrency: 32, timeoutSeconds: 1 });
    await storePingResults(space.id, results);
    const online = [...results.values()].filter(Boolean).length;
    await audit(user, "scan", "ping", subnet.cidr, { companyId: space.companyId, spaceId: space.id, detail: { online, total: ips.length } });
    broadcast({ type: "ping", companyId: space.companyId, spaceId: space.id, cidr: subnet.cidr });
    return json(res, 200, { ok: true, online, total: ips.length, results: Object.fromEntries(results) });
  }

  if (req.method === "GET" && pathname === "/api/users") {
    requireAdmin(user);
    const users = await pool.query(
      `SELECT u.id,u.username,u.display_name AS "displayName",u.role,u.active,
              COALESCE((SELECT json_agg(a.company_id) FROM user_company_access a WHERE a.user_id=u.id),'[]') AS "companyIds",
              COALESCE((SELECT json_agg(a.space_id) FROM user_space_access a WHERE a.user_id=u.id),'[]') AS "spaceIds"
         FROM users u ORDER BY u.username`,
    );
    return json(res, 200, { ok: true, users: users.rows });
  }

  if (req.method === "POST" && pathname === "/api/users") {
    requireAdmin(user);
    const body = await readBody(req);
    const username = cleanText(body.username, 80);
    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) throw new Error("نام کاربری باید حداقل ۳ کاراکتر و شامل حروف، عدد، نقطه یا خط تیره باشد.");
    if (!String(body.password || "")) throw new Error("رمز عبور نمی‌تواند خالی باشد.");
    const id = crypto.randomUUID();
    const role = safeRole(body.role);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users(id,username,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, username, cleanText(body.displayName, 120), await hashPassword(String(body.password || "")), role],
      );
      if (role !== "admin") {
        const companyIds = Array.isArray(body.companyIds) ? [...new Set(body.companyIds.map(String))] : [];
        const spaceIds = Array.isArray(body.spaceIds) ? [...new Set(body.spaceIds.map(String))] : [];
        for (const companyId of companyIds) {
          await client.query("INSERT INTO user_company_access(user_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, companyId]);
        }
        for (const spaceId of spaceIds) {
          await client.query("INSERT INTO user_space_access(user_id,space_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, spaceId]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await audit(user, "create", "user", id, { detail: { username, role } });
    broadcast({ type: "user", entityId: id });
    return json(res, 201, { ok: true, id });
  }

  const userUpdate = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === "PUT" && userUpdate) {
    requireAdmin(user);
    const body = await readBody(req);
    const role = safeRole(body.role);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await protectLastAdmin(client, userUpdate[1], role, body.active !== false);
      const fields = [cleanText(body.displayName, 120), role, body.active !== false, userUpdate[1]];
      const updated = await client.query("UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4 RETURNING id", fields);
      if (!updated.rowCount) throw Object.assign(new Error("کاربر پیدا نشد."), { status: 404 });
      if (cleanText(body.password, 500)) {
        await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await hashPassword(String(body.password)), userUpdate[1]]);
      }
      await client.query("DELETE FROM user_company_access WHERE user_id=$1", [userUpdate[1]]);
      await client.query("DELETE FROM user_space_access WHERE user_id=$1", [userUpdate[1]]);
      if (role !== "admin") {
        const companyIds = Array.isArray(body.companyIds) ? [...new Set(body.companyIds.map(String))] : [];
        const spaceIds = Array.isArray(body.spaceIds) ? [...new Set(body.spaceIds.map(String))] : [];
        for (const companyId of companyIds) await client.query("INSERT INTO user_company_access(user_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userUpdate[1], companyId]);
        for (const spaceId of spaceIds) await client.query("INSERT INTO user_space_access(user_id,space_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userUpdate[1], spaceId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await audit(user, "update", "user", userUpdate[1], { detail: { role } });
    broadcast({ type: "user", entityId: userUpdate[1] });
    return json(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && userUpdate) {
    requireAdmin(user);
    const client = await pool.connect();
    let removed;
    try {
      await client.query("BEGIN");
      await protectLastAdmin(client, userUpdate[1], null, false);
      removed = (await client.query("DELETE FROM users WHERE id=$1 RETURNING username,role", [userUpdate[1]])).rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await audit(user.id === userUpdate[1] ? null : user, "delete", "user", userUpdate[1], { detail: removed || {} });
    broadcast({ type: "user", entityId: userUpdate[1] });
    return json(res, 200, { ok: true });
  }

  if (req.method === "PUT" && pathname === "/api/tools") {
    requireAdmin(user);
    const body = await readBody(req);
    const tools = Array.isArray(body.tools) ? body.tools : [];
    for (const item of tools) {
      const tool = cleanText(item.tool, 8).toUpperCase();
      if (!["VNC", "MIK", "RDP", "SSH", "HTTP", "HTTPS"].includes(tool)) continue;
      await pool.query(
        "UPDATE tool_defaults SET label=$1,default_port=$2,color=$3 WHERE tool=$4",
        [cleanText(item.label, 80) || tool, validatePort(item.defaultPort), validColor(item.color), tool],
      );
    }
    await audit(user, "update", "tool_defaults", null);
    broadcast({ type: "tools" });
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/audit") {
    requireAdmin(user);
    const rows = await pool.query(
      `SELECT a.id,a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",a.detail,a.created_at AS "createdAt",
              u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100`,
    );
    return json(res, 200, { ok: true, items: rows.rows });
  }

  return errorResponse(res, 404, "مسیر درخواستی پیدا نشد.");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
};

async function staticFile(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC_DIR, requested);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== path.join(PUBLIC_DIR, "index.html")) return false;
  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    res.end(data);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function proxyModule(req, res, url, user) {
  if (!user) return errorResponse(res, 401, "ابتدا وارد سامانه شوید.");
  const parts = url.pathname.split("/").filter(Boolean);
  const moduleId = parts[1] || "";
  const moduleInfo = (await loadModules()).find((item) => item.id === moduleId);
  if (!moduleInfo?.upstream) return errorResponse(res, 404, "ماژول موردنظر فعال نیست.");
  const upstreamUrl = new URL(moduleInfo.upstream);
  const stripPrefix = `/m/${moduleId}`;
  const forwardedPath = (url.pathname.slice(stripPrefix.length) || "/") + url.search;
  return new Promise((resolve) => {
    const upstream = http.request({
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || 80,
      method: req.method,
      path: forwardedPath,
      headers: {
        ...req.headers,
        host: upstreamUrl.host,
        "x-ems-user-id": user.id,
        "x-ems-user-role": user.role,
        "x-ems-user-name": encodeURIComponent(user.username || ""),
        "x-ems-module-prefix": stripPrefix,
      },
    }, (response) => {
      const headers = { ...response.headers };
      delete headers["content-security-policy"];
      res.writeHead(response.statusCode || 502, headers);
      response.pipe(res);
      response.on("end", resolve);
    });
    upstream.on("error", () => {
      if (!res.headersSent) errorResponse(res, 503, "ماژول فعال است اما سرویس آن آماده پاسخ‌گویی نیست.");
      else res.end();
      resolve();
    });
    req.pipe(upstream);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/modules" && req.method === "GET") {
      const user = await currentUser(req);
      if (!user) return errorResponse(res, 401, "ابتدا وارد سامانه شوید.");
      return json(res, 200, { ok: true, modules: await publicModules() });
    }
    if (url.pathname.startsWith("/m/")) return await proxyModule(req, res, url, await currentUser(req));
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, version: APP_VERSION });
    if (url.pathname.startsWith("/api/")) {
      if (!csrfAllowed(req)) return errorResponse(res, 403, "درخواست فاقد نشان امنیتی معتبر است.");
      return await api(req, res, url, await currentUser(req));
    }
    if (req.method === "GET" && await staticFile(res, url.pathname)) return;
    errorResponse(res, 404, "فایل پیدا نشد.");
  } catch (error) {
    const status = Number(error.status || (error.code === "23505" ? 409 : 400));
    const message = error.code === "23505" ? "رکوردی با این مقدار قبلاً ثبت شده است." : (error.message || "خطای داخلی برنامه");
    console.error(new Date().toISOString(), req.method, req.url, error);
    if (!res.headersSent) errorResponse(res, status, message);
    else res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EMS IPAM ${APP_VERSION} listening on ${PORT}`);
});

const backupTimer = setInterval(() => runAutomaticBackup().catch((error) => console.error("automatic backup", error)), 60_000);
const trashTimer = setInterval(async () => {
  try {
    await pool.query("DELETE FROM hosts WHERE deleted_at < now() - interval '30 days'");
    await pool.query("DELETE FROM prefixes WHERE deleted_at < now() - interval '30 days'");
    await pool.query("DELETE FROM address_spaces WHERE deleted_at < now() - interval '30 days'");
    await pool.query("DELETE FROM companies WHERE deleted_at < now() - interval '30 days'");
  } catch (error) { console.error("trash cleanup", error); }
}, 6 * 60 * 60_000);
backupTimer.unref();
trashTimer.unref();
setTimeout(() => runAutomaticBackup().catch((error) => console.error("automatic backup", error)), 5000).unref();

async function shutdown() {
  clearInterval(backupTimer);
  clearInterval(trashTimer);
  server.close();
  for (const client of eventClients) client.end();
  await database.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
