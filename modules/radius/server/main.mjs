import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPool, initialize } from "./db.mjs";
import { encryptSecret, decryptSecret } from "./crypto.mjs";
import { parseCookies, tokenHash } from "./auth.mjs";
import { normalizeMac, renderRadiusFiles } from "./render.mjs";

const PORT = Number(process.env.PORT || 8091);
const APP_VERSION = "0.7.0";
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const pool = createPool();
const execFileAsync = promisify(execFile);
await initialize(pool);

function clean(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function json(res, status, value, headers = {}) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", ...headers });
  res.end(data);
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) fail(413, "Request is too large."); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(400, "Invalid JSON body."); }
}
async function currentUser(req) {
  const token = parseCookies(req.headers.cookie).ems_session;
  if (!token) return null;
  const result = await pool.query(`SELECT u.id,u.username,u.display_name AS "displayName",u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [tokenHash(token)]);
  return result.rows[0] || null;
}
function requireUser(user) { if (!user) fail(401, "Authentication required."); }
function requireAdmin(user) { requireUser(user); if (user.role !== "admin") fail(403, "Administrator access is required."); }
function canUseMac(user) { return ["admin","technical","helpdesk","editor"].includes(user?.role); }
function canWriteMac(user) { return ["admin","technical","helpdesk","editor"].includes(user?.role); }
function csrf(req) { return !["POST","PUT","PATCH","DELETE"].includes(req.method) || req.headers["x-ems-csrf"] === "1"; }

async function companyIdsFor(user) {
  if (user.role === "admin" || user.role === "technical" || user.role === "helpdesk" || user.role === "editor") {
    return (await pool.query("SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY name")).rows.map((x) => x.id);
  }
  return (await pool.query(`SELECT DISTINCT c.id FROM companies c LEFT JOIN user_company_access uca ON uca.company_id=c.id AND uca.user_id=$1 LEFT JOIN address_spaces s ON s.company_id=c.id LEFT JOIN user_space_access usa ON usa.space_id=s.id AND usa.user_id=$1 WHERE c.deleted_at IS NULL AND (uca.user_id IS NOT NULL OR usa.user_id IS NOT NULL)`, [user.id])).rows.map((x) => x.id);
}

async function applyRadius() {
  const result = await renderRadiusFiles(pool);
  try { await execFileAsync("pkill", ["-HUP", "freeradius"], { timeout: 5000 }); } catch {}
  return result;
}

async function bootstrap(user) {
  requireUser(user);
  const ids = await companyIdsFor(user);
  const companies = ids.length ? (await pool.query("SELECT id,name,kind FROM companies WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY name", [ids])).rows : [];
  const [settings, counts, systemAccounts] = await Promise.all([
    pool.query(`SELECT unknown_mac_policy AS "unknownMacPolicy",quarantine_vlan AS "quarantineVlan",radius_server_ip AS "radiusServerIp",keep_mac_history AS "keepMacHistory",updated_at AS "updatedAt" FROM radius_settings WHERE singleton=true`),
    pool.query(`SELECT (SELECT count(*)::int FROM radius_networks WHERE enabled) AS networks,(SELECT count(*)::int FROM radius_users WHERE enabled) AS users,(SELECT count(*)::int FROM radius_mac_clients WHERE enabled) AS macs,(SELECT count(*)::int FROM radius_mac_clients WHERE enabled AND access_mode='block') AS blocked`),
    user.role === "admin" ? pool.query(`SELECT id,username,display_name AS "displayName",mikrotik_access AS "mikrotikAccess",cisco_privilege AS "ciscoPrivilege",nexus_role AS "nexusRole" FROM radius_users WHERE enabled=true AND account_type='system' ORDER BY username`) : Promise.resolve({ rows: [] }),
  ]);
  return { ok: true, version: APP_VERSION, user, companies, settings: settings.rows[0], counts: counts.rows[0], systemAccounts: systemAccounts.rows, permissions: { admin: user.role === "admin", macRead: canUseMac(user), macWrite: canWriteMac(user) } };
}

function validateCidr(value) {
  const text = clean(value, 64);
  const m = text.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/);
  if (!m) fail(400, "CIDR is invalid.");
  if (m[1].split(".").some((x) => Number(x) > 255)) fail(400, "CIDR is invalid.");
  return text;
}
function validateVlan(value, optional = true) {
  if ((value === "" || value === null || value === undefined) && optional) return null;
  const v = Number(value); if (!Number.isInteger(v) || v < 1 || v > 4094) fail(400, "VLAN must be between 1 and 4094."); return v;
}

function configText({ serverIp, secret, kind = "cisco" }) {
  if (kind === "mikrotik") return `/radius add address=${serverIp} service=login authentication-port=1812 accounting-port=1813 secret="${secret.replace(/"/g, '\\"')}"\n/user aaa set use-radius=yes accounting=yes default-group=read`;
  if (kind === "mab") return `aaa new-model\nradius server EMS_RADIUS\n address ipv4 ${serverIp} auth-port 1812 acct-port 1813\n key ${secret}\naaa group server radius EMS_RADIUS_GROUP\n server name EMS_RADIUS\naaa authentication dot1x default group EMS_RADIUS\naaa authorization network default group EMS_RADIUS\nradius-server vsa send authentication\ndot1x system-auth-control\n!\ninterface Gi1/0/1\n switchport mode access\n authentication order mab dot1x\n authentication priority dot1x mab\n authentication port-control auto\n mab\n dot1x pae authenticator\n spanning-tree portfast`;
  return `aaa new-model\nradius server EMS_RADIUS\n address ipv4 ${serverIp} auth-port 1812 acct-port 1813\n key ${secret}\naaa group server radius EMS_RADIUS_GROUP\n server name EMS_RADIUS\nradius-server vsa send authentication\naaa authentication login default group EMS_RADIUS_GROUP local\naaa authorization exec default group EMS_RADIUS_GROUP local\naaa accounting exec default start-stop group EMS_RADIUS_GROUP`;
}

async function api(req, res, url, user) {
  requireUser(user);
  const p = url.pathname;
  if (req.method === "GET" && p === "/api/radius/bootstrap") return json(res, 200, await bootstrap(user));

  if (req.method === "GET" && p === "/api/radius/networks") {
    requireAdmin(user);
    const rows = await pool.query(`SELECT id,name,cidr,vendor,enabled,(secret_ciphertext <> '') AS "hasSecret",updated_at AS "updatedAt" FROM radius_networks ORDER BY cidr`);
    return json(res, 200, { ok: true, networks: rows.rows });
  }
  if (req.method === "POST" && p === "/api/radius/networks") {
    requireAdmin(user); const b = await body(req); const id = crypto.randomUUID(); const secret = String(b.secret || ""); if (!secret) fail(400, "Shared secret is required.");
    await pool.query(`INSERT INTO radius_networks(id,name,cidr,vendor,secret_ciphertext,enabled,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`, [id, clean(b.name,120) || "RADIUS Network", validateCidr(b.cidr), clean(b.vendor,40) || "any", encryptSecret(secret), b.enabled !== false, user.id]);
    await applyRadius(); return json(res, 201, { ok: true, id });
  }
  const networkId = p.match(/^\/api\/radius\/networks\/([^/]+)$/)?.[1];
  if (networkId && req.method === "PUT") {
    requireAdmin(user); const b = await body(req); const current = (await pool.query("SELECT secret_ciphertext FROM radius_networks WHERE id=$1", [networkId])).rows[0]; if (!current) fail(404,"Network not found.");
    await pool.query(`UPDATE radius_networks SET name=$1,cidr=$2,vendor=$3,secret_ciphertext=$4,enabled=$5,updated_by=$6,updated_at=now() WHERE id=$7`, [clean(b.name,120) || "RADIUS Network", validateCidr(b.cidr), clean(b.vendor,40) || "any", String(b.secret || "") ? encryptSecret(String(b.secret)) : current.secret_ciphertext, b.enabled !== false, user.id, networkId]);
    await applyRadius(); return json(res,200,{ok:true});
  }
  if (networkId && req.method === "DELETE") { requireAdmin(user); await pool.query("DELETE FROM radius_networks WHERE id=$1",[networkId]); await applyRadius(); return json(res,200,{ok:true}); }

  if (req.method === "GET" && p === "/api/radius/users") {
    requireAdmin(user);
    const rows = await pool.query(`SELECT id,username,display_name AS "displayName",account_type AS "accountType",mikrotik_access AS "mikrotikAccess",cisco_privilege AS "ciscoPrivilege",nexus_role AS "nexusRole",enabled,notes,(password_ciphertext <> '') AS "hasPassword",updated_at AS "updatedAt" FROM radius_users ORDER BY account_type DESC,username`);
    return json(res,200,{ok:true,users:rows.rows});
  }
  if (req.method === "POST" && p === "/api/radius/users") {
    requireAdmin(user); const b=await body(req); const username=clean(b.username,80); if(!/^[A-Za-z0-9_.@-]{2,80}$/.test(username)) fail(400,"Username is invalid."); if(!String(b.password||"")) fail(400,"Password is required."); const id=crypto.randomUUID();
    await pool.query(`INSERT INTO radius_users(id,username,display_name,password_ciphertext,account_type,mikrotik_access,cisco_privilege,nexus_role,enabled,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,[id,username,clean(b.displayName,120),encryptSecret(String(b.password)),["human","system"].includes(b.accountType)?b.accountType:"human",["none","read","write","full"].includes(b.mikrotikAccess)?b.mikrotikAccess:"none",Math.max(0,Math.min(15,Number(b.ciscoPrivilege||0))),["none","network-operator","network-admin"].includes(b.nexusRole)?b.nexusRole:"none",b.enabled!==false,clean(b.notes,1000),user.id]);
    await applyRadius(); return json(res,201,{ok:true,id});
  }
  const userId = p.match(/^\/api\/radius\/users\/([^/]+)$/)?.[1];
  if (userId && req.method === "PUT") {
    requireAdmin(user); const b=await body(req); const current=(await pool.query("SELECT password_ciphertext FROM radius_users WHERE id=$1",[userId])).rows[0]; if(!current) fail(404,"RADIUS user not found.");
    await pool.query(`UPDATE radius_users SET display_name=$1,password_ciphertext=$2,account_type=$3,mikrotik_access=$4,cisco_privilege=$5,nexus_role=$6,enabled=$7,notes=$8,updated_by=$9,updated_at=now() WHERE id=$10`,[clean(b.displayName,120),String(b.password||"")?encryptSecret(String(b.password)):current.password_ciphertext,["human","system"].includes(b.accountType)?b.accountType:"human",["none","read","write","full"].includes(b.mikrotikAccess)?b.mikrotikAccess:"none",Math.max(0,Math.min(15,Number(b.ciscoPrivilege||0))),["none","network-operator","network-admin"].includes(b.nexusRole)?b.nexusRole:"none",b.enabled!==false,clean(b.notes,1000),user.id,userId]);
    await applyRadius(); return json(res,200,{ok:true});
  }
  if (userId && req.method === "DELETE") { requireAdmin(user); await pool.query("DELETE FROM radius_users WHERE id=$1",[userId]); await applyRadius(); return json(res,200,{ok:true}); }

  if (p === "/api/radius/macs" && req.method === "GET") {
    if (!canUseMac(user)) fail(403,"MAC access is not allowed for this role.");
    const ids=await companyIdsFor(user); const q=clean(url.searchParams.get("q"),120); const params=[ids,`%${q}%`];
    const rows=ids.length?await pool.query(`SELECT m.id,m.mac,m.name,m.description,m.device_type AS "deviceType",m.company_id AS "companyId",c.name AS "companyName",m.access_mode AS "accessMode",m.vlan,m.enabled,m.last_switch_ip AS "lastSwitchIp",m.last_switch_name AS "lastSwitchName",m.last_port AS "lastPort",m.last_vlan AS "lastVlan",m.last_seen_at AS "lastSeenAt" FROM radius_mac_clients m LEFT JOIN companies c ON c.id=m.company_id WHERE (m.company_id IS NULL OR m.company_id=ANY($1::text[])) AND ($2='%%' OR m.mac ILIKE $2 OR m.name ILIKE $2 OR m.description ILIKE $2 OR m.last_switch_ip ILIKE $2 OR m.last_switch_name ILIKE $2) ORDER BY m.name,m.mac LIMIT 1000`,params):{rows:[]};
    return json(res,200,{ok:true,macs:rows.rows});
  }
  if (p === "/api/radius/macs" && req.method === "POST") {
    if(!canWriteMac(user)) fail(403,"MAC changes are not allowed for this role."); const b=await body(req); const mac=normalizeMac(b.mac); if(!mac) fail(400,"MAC address is invalid."); const id=crypto.randomUUID(); const mode=["allow","allow_vlan","block"].includes(b.accessMode)?b.accessMode:"allow"; const vlan=mode==="allow_vlan"?validateVlan(b.vlan,false):null;
    await pool.query(`INSERT INTO radius_mac_clients(id,mac,name,description,device_type,company_id,access_mode,vlan,enabled,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,[id,mac,clean(b.name,120),clean(b.description,1000),clean(b.deviceType,40)||"other",b.companyId||null,mode,vlan,b.enabled!==false,user.id]); await applyRadius(); return json(res,201,{ok:true,id});
  }
  const macId=p.match(/^\/api\/radius\/macs\/([^/]+)$/)?.[1];
  if(macId && req.method==="PUT") { if(!canWriteMac(user)) fail(403,"MAC changes are not allowed for this role."); const b=await body(req); const mode=["allow","allow_vlan","block"].includes(b.accessMode)?b.accessMode:"allow"; const vlan=mode==="allow_vlan"?validateVlan(b.vlan,false):null; await pool.query(`UPDATE radius_mac_clients SET name=$1,description=$2,device_type=$3,company_id=$4,access_mode=$5,vlan=$6,enabled=$7,updated_by=$8,updated_at=now() WHERE id=$9`,[clean(b.name,120),clean(b.description,1000),clean(b.deviceType,40)||"other",b.companyId||null,mode,vlan,b.enabled!==false,user.id,macId]); await applyRadius(); return json(res,200,{ok:true}); }
  if(macId && req.method==="DELETE") { if(!canWriteMac(user)) fail(403,"MAC changes are not allowed for this role."); await pool.query("DELETE FROM radius_mac_clients WHERE id=$1",[macId]); await applyRadius(); return json(res,200,{ok:true}); }
  const historyId=p.match(/^\/api\/radius\/macs\/([^/]+)\/history$/)?.[1];
  if(historyId && req.method==="GET") { if(!canUseMac(user)) fail(403,"MAC access is not allowed for this role."); const rows=await pool.query(`SELECT switch_ip AS "switchIp",switch_name AS "switchName",port,vlan,seen_at AS "seenAt" FROM radius_mac_history WHERE mac_id=$1 ORDER BY seen_at DESC LIMIT 20`,[historyId]); return json(res,200,{ok:true,history:rows.rows}); }

  if(p==="/api/radius/settings" && req.method==="PUT") { requireAdmin(user); const b=await body(req); const policy=["reject","quarantine","allow"].includes(b.unknownMacPolicy)?b.unknownMacPolicy:"reject"; const qvlan=policy==="quarantine"?validateVlan(b.quarantineVlan,false):null; await pool.query(`UPDATE radius_settings SET unknown_mac_policy=$1,quarantine_vlan=$2,radius_server_ip=$3,keep_mac_history=$4,updated_by=$5,updated_at=now() WHERE singleton=true`,[policy,qvlan,clean(b.radiusServerIp,64),Math.max(0,Math.min(20,Number(b.keepMacHistory??5))),user.id]); await applyRadius(); return json(res,200,{ok:true}); }

  if(p==="/api/radius/config" && req.method==="GET") { requireAdmin(user); const networkId=clean(url.searchParams.get("networkId"),100); const kind=clean(url.searchParams.get("kind"),20)||"cisco"; const network=(await pool.query("SELECT secret_ciphertext FROM radius_networks WHERE id=$1",[networkId])).rows[0]; if(!network) fail(404,"RADIUS network not found."); const settings=(await pool.query("SELECT radius_server_ip FROM radius_settings WHERE singleton=true")).rows[0]; const serverIp=clean(settings?.radius_server_ip,64)||"RADIUS_SERVER_IP"; return json(res,200,{ok:true,kind,config:configText({serverIp,secret:decryptSecret(network.secret_ciphertext),kind})}); }

  if(p==="/api/radius/apply" && req.method==="POST") { requireAdmin(user); return json(res,200,{ok:true,...await applyRadius()}); }
  fail(404,"API route not found.");
}

async function staticFile(res, pathname) {
  let relative = pathname.replace(/^\/radius\/?/, "");
  if (!relative) relative = "index.html";
  if (relative.includes("..")) return false;
  const file = path.join(PUBLIC_DIR, relative);
  try {
    const data = await fs.readFile(file);
    const ext=path.extname(file); const type=ext===".html"?"text/html; charset=utf-8":ext===".js"?"text/javascript; charset=utf-8":ext===".css"?"text/css; charset=utf-8":"application/octet-stream";
    res.writeHead(200,{"Content-Type":type,"Content-Length":data.length,"Cache-Control":"no-cache","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"}); res.end(data); return true;
  } catch(e) { if(e.code==="ENOENT") return false; throw e; }
}

const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
    if(url.pathname==="/radius/health") return json(res,200,{ok:true,version:APP_VERSION});
    if(url.pathname.startsWith("/api/radius/")) { if(!csrf(req)) fail(403,"CSRF check failed."); return await api(req,res,url,await currentUser(req)); }
    if(req.method==="GET" && (url.pathname==="/radius" || url.pathname.startsWith("/radius/"))) { if(url.pathname==="/radius") { res.writeHead(302,{Location:"/radius/"}); return res.end(); } if(await staticFile(res,url.pathname)) return; }
    json(res,404,{ok:false,error:"Not found."});
  } catch(error) { console.error(error); if(!res.headersSent) json(res,Number(error.status||400),{ok:false,error:error.message||"Internal error"}); else res.end(); }
});
server.listen(PORT,"0.0.0.0",()=>console.log(`EMS RADIUS ${APP_VERSION} listening on ${PORT}`));
