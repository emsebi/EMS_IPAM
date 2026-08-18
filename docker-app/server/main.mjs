import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
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
  intToIpv4,
  parseCidr,
  validateChildCidr,
  validateHostIp,
  validatePort,
  validateRootCidr,
} from "./ip.mjs";
import { pingMany } from "./ping.mjs";

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || undefined;
const ADMIN_USERNAME = process.env.EMS_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.EMS_ADMIN_PASSWORD || "";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";
const APP_VERSION = "0.1.0";
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COLORS = ["#3157d5", "#2fa36f", "#d94b5b", "#e48a2d", "#805ad5", "#2b9ca8", "#c2418c", "#64748b"];

if (!DATABASE_URL && !process.env.PGHOST) throw new Error("تنظیمات اتصال PostgreSQL تعریف نشده است.");
if (ADMIN_PASSWORD.length < 12) throw new Error("EMS_ADMIN_PASSWORD باید حداقل ۱۲ کاراکتر باشد.");

const database = createDatabase(DATABASE_URL);
await database.initialize({ adminUsername: ADMIN_USERNAME, adminPassword: ADMIN_PASSWORD });
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
    if (size > 2 * 1024 * 1024) throw new Error("اندازهٔ درخواست بیش از حد مجاز است.");
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
  for (const tool of ["VNC", "MIK", "RDP", "SSH"]) {
    const port = validatePort(input[tool]);
    if (port !== null) result[tool] = port;
  }
  return result;
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
  if (user.role === "admin") return true;
  const found = await pool.query(
    "SELECT 1 FROM user_company_access WHERE user_id=$1 AND company_id=$2",
    [user.id, companyId],
  );
  return found.rowCount > 0;
}

async function getSpaceForUser(user, spaceId) {
  const found = await pool.query(
    `SELECT s.id,s.company_id AS "companyId",s.name,s.cidr,s.color,s.description,
            c.name AS "companyName"
       FROM address_spaces s JOIN companies c ON c.id=s.company_id WHERE s.id=$1`,
    [spaceId],
  );
  const space = found.rows[0];
  if (!space || !(await canAccessCompany(user, space.companyId))) {
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

function broadcast(event) {
  const payload = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    try { client.write(payload); } catch { eventClients.delete(client); }
  }
}

async function listBootstrap(user) {
  const companyWhere = user.role === "admin"
    ? { sql: "", params: [] }
    : { sql: "JOIN user_company_access a ON a.company_id=c.id AND a.user_id=$1", params: [user.id] };
  const companies = await pool.query(
    `SELECT DISTINCT c.id,c.name,c.description FROM companies c ${companyWhere.sql} ORDER BY c.name`,
    companyWhere.params,
  );
  const ids = companies.rows.map((item) => item.id);
  const spaces = ids.length
    ? await pool.query(
      `SELECT id,company_id AS "companyId",name,cidr,color,description
         FROM address_spaces WHERE company_id=ANY($1::text[]) ORDER BY company_id,cidr`,
      [ids],
    )
    : { rows: [] };
  const tools = await pool.query(
    `SELECT tool,label,default_port AS "defaultPort",color FROM tool_defaults ORDER BY tool`,
  );
  return { ok: true, version: APP_VERSION, user, companies: companies.rows, spaces: spaces.rows, tools: tools.rows };
}

async function spaceData(user, spaceId) {
  const space = await getSpaceForUser(user, spaceId);
  const [prefixes, hosts, pings] = await Promise.all([
    pool.query(
      `SELECT id,cidr,name,status,role,vlan,gateway,color,description,
              updated_at AS "updatedAt" FROM prefixes WHERE space_id=$1 ORDER BY cidr`,
      [spaceId],
    ),
    pool.query(
      `SELECT id,ip,name,status,type,os,mac,vlan,username,owner,location,
              secret_ref AS "secretRef",notes,ports,updated_at AS "updatedAt"
         FROM hosts WHERE space_id=$1 ORDER BY ip`,
      [spaceId],
    ),
    pool.query(
      `SELECT ip,online,checked_at AS "checkedAt",last_seen_at AS "lastSeenAt"
         FROM ping_results WHERE space_id=$1`,
      [spaceId],
    ),
  ]);
  return { ok: true, space, prefixes: prefixes.rows, hosts: hosts.rows, pings: pings.rows };
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
    const payload = await spaceData(user, exportMatch[1]);
    const body = Buffer.from(JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), ...payload }, null, 2));
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Content-Disposition": `attachment; filename="ems-ipam-${payload.space.cidr.replaceAll("/", "-")}.json"`,
      "Cache-Control": "no-store",
    });
    return res.end(body);
  }

  if (req.method === "POST" && pathname === "/api/companies") {
    requireAdmin(user);
    const body = await readBody(req);
    const name = cleanText(body.name, 120);
    if (!name) throw new Error("نام شرکت الزامی است.");
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO companies(id,name,description) VALUES($1,$2,$3)", [id, name, cleanText(body.description, 1000)]);
    await audit(user, "create", "company", id, { companyId: id, detail: { name } });
    broadcast({ type: "company", companyId: id });
    return json(res, 201, { ok: true, id });
  }

  if (req.method === "POST" && pathname === "/api/spaces") {
    requireWriter(user);
    const body = await readBody(req);
    if (!(await canAccessCompany(user, body.companyId))) throw Object.assign(new Error("به این شرکت دسترسی ندارید."), { status: 403 });
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

  if (req.method === "POST" && pathname === "/api/prefixes") {
    requireWriter(user);
    const body = await readBody(req);
    const space = await getSpaceForUser(user, body.spaceId);
    const cidr = validateChildCidr(body.cidr, space.cidr).cidr;
    const id = cleanText(body.id, 80) || crypto.randomUUID();
    const values = [
      id, body.spaceId, cidr, cleanText(body.name, 160) || cidr,
      cleanText(body.status, 40) || "active", cleanText(body.role, 100), cleanText(body.vlan, 40),
      cleanText(body.gateway, 80), validColor(body.color), cleanText(body.description, 2000), user.id,
    ];
    await pool.query(
      `INSERT INTO prefixes(id,space_id,cidr,name,status,role,vlan,gateway,color,description,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT(id) DO UPDATE SET cidr=excluded.cidr,name=excluded.name,status=excluded.status,
         role=excluded.role,vlan=excluded.vlan,gateway=excluded.gateway,color=excluded.color,
         description=excluded.description,updated_by=excluded.updated_by,updated_at=now()`,
      values,
    );
    await audit(user, body.id ? "update" : "create", "prefix", id, { companyId: space.companyId, spaceId: space.id, detail: { cidr } });
    broadcast({ type: "prefix", companyId: space.companyId, spaceId: space.id, entityId: id });
    return json(res, 200, { ok: true, id });
  }

  const prefixDelete = pathname.match(/^\/api\/prefixes\/([^/]+)$/);
  if (req.method === "DELETE" && prefixDelete) {
    requireWriter(user);
    const found = await pool.query(
      "SELECT p.id,p.cidr,p.space_id AS \"spaceId\",s.company_id AS \"companyId\" FROM prefixes p JOIN address_spaces s ON s.id=p.space_id WHERE p.id=$1",
      [prefixDelete[1]],
    );
    const item = found.rows[0];
    if (!item || !(await canAccessCompany(user, item.companyId))) throw Object.assign(new Error("رنج پیدا نشد."), { status: 404 });
    await pool.query("DELETE FROM prefixes WHERE id=$1", [item.id]);
    await audit(user, "delete", "prefix", item.id, { companyId: item.companyId, spaceId: item.spaceId, detail: { cidr: item.cidr } });
    broadcast({ type: "prefix", companyId: item.companyId, spaceId: item.spaceId, entityId: item.id });
    return json(res, 200, { ok: true });
  }

  if (req.method === "PUT" && pathname === "/api/hosts") {
    requireWriter(user);
    const body = await readBody(req);
    const space = await getSpaceForUser(user, body.spaceId);
    const ip = validateHostIp(body.ip, space.cidr);
    const id = cleanText(body.id, 80) || crypto.randomUUID();
    const values = [
      id, space.id, ip, cleanText(body.name, 160), cleanText(body.status, 40) || "active",
      cleanText(body.type, 100), cleanText(body.os, 160), cleanText(body.mac, 32), cleanText(body.vlan, 40),
      cleanText(body.username, 120), cleanText(body.owner, 160), cleanText(body.location, 200),
      cleanText(body.secretRef, 500), cleanText(body.notes, 3000), JSON.stringify(normalizePorts(body.ports)), user.id,
    ];
    await pool.query(
      `INSERT INTO hosts(id,space_id,ip,name,status,type,os,mac,vlan,username,owner,location,secret_ref,notes,ports,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$16)
       ON CONFLICT(space_id,ip) DO UPDATE SET name=excluded.name,status=excluded.status,type=excluded.type,
         os=excluded.os,mac=excluded.mac,vlan=excluded.vlan,username=excluded.username,owner=excluded.owner,
         location=excluded.location,secret_ref=excluded.secret_ref,notes=excluded.notes,ports=excluded.ports,
         updated_by=excluded.updated_by,updated_at=now()`,
      values,
    );
    await audit(user, body.id ? "update" : "create", "host", id, { companyId: space.companyId, spaceId: space.id, detail: { ip } });
    broadcast({ type: "host", companyId: space.companyId, spaceId: space.id, entityId: id });
    return json(res, 200, { ok: true, id });
  }

  const hostDelete = pathname.match(/^\/api\/hosts\/([^/]+)\/([^/]+)$/);
  if (req.method === "DELETE" && hostDelete) {
    requireWriter(user);
    const space = await getSpaceForUser(user, hostDelete[1]);
    const ip = validateHostIp(decodeURIComponent(hostDelete[2]), space.cidr);
    const found = await pool.query("DELETE FROM hosts WHERE space_id=$1 AND ip=$2 RETURNING id", [space.id, ip]);
    if (!found.rowCount) throw Object.assign(new Error("اطلاعات IP پیدا نشد."), { status: 404 });
    await audit(user, "delete", "host", found.rows[0].id, { companyId: space.companyId, spaceId: space.id, detail: { ip } });
    broadcast({ type: "host", companyId: space.companyId, spaceId: space.id, entityId: found.rows[0].id });
    return json(res, 200, { ok: true });
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
              COALESCE(json_agg(a.company_id) FILTER (WHERE a.company_id IS NOT NULL),'[]') AS "companyIds"
         FROM users u LEFT JOIN user_company_access a ON a.user_id=u.id
        GROUP BY u.id ORDER BY u.username`,
    );
    return json(res, 200, { ok: true, users: users.rows });
  }

  if (req.method === "POST" && pathname === "/api/users") {
    requireAdmin(user);
    const body = await readBody(req);
    const username = cleanText(body.username, 80);
    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) throw new Error("نام کاربری باید حداقل ۳ کاراکتر و شامل حروف، عدد، نقطه یا خط تیره باشد.");
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
        for (const companyId of companyIds) {
          await client.query("INSERT INTO user_company_access(user_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, companyId]);
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
      const fields = [cleanText(body.displayName, 120), role, body.active !== false, userUpdate[1]];
      await client.query("UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4", fields);
      if (cleanText(body.password, 500)) {
        await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await hashPassword(String(body.password)), userUpdate[1]]);
      }
      await client.query("DELETE FROM user_company_access WHERE user_id=$1", [userUpdate[1]]);
      if (role !== "admin") {
        const companyIds = Array.isArray(body.companyIds) ? [...new Set(body.companyIds.map(String))] : [];
        for (const companyId of companyIds) await client.query("INSERT INTO user_company_access(user_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userUpdate[1], companyId]);
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

  if (req.method === "PUT" && pathname === "/api/tools") {
    requireAdmin(user);
    const body = await readBody(req);
    const tools = Array.isArray(body.tools) ? body.tools : [];
    for (const item of tools) {
      const tool = cleanText(item.tool, 8).toUpperCase();
      if (!["VNC", "MIK", "RDP", "SSH"].includes(tool)) continue;
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
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

async function shutdown() {
  server.close();
  for (const client of eventClients) client.end();
  await database.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
