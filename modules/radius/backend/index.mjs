import { previewMabDecision } from "../policy-preview.mjs";
import { previewDeviceAdminProfile } from "../admin-profile-preview.mjs";
import { reviewMabPolicyMatrix } from "../review-matrix.mjs";
import { normalizeNasIp, prepareNasProfile } from "../nas-inventory.mjs";
import { previewNasClientConfig } from "../nas-config-preview.mjs";

const PREVIEW_PATHS = new Set([
  "/api/radius/preview/mab",
  "/api/radius/preview/admin-profile",
  "/api/radius/preview/mab-matrix",
  "/api/radius/preview/nas-client",
]);
const NAS_ROOT = "/api/radius/nas-profiles";
const ADMIN_ROOT = "/api/radius/admin-profiles";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const safeId = (value) => typeof value === "string" && idPattern.test(value) ? value : null;
const pathId = (pathname, root) => pathname.startsWith(root + "/") ? decodeURIComponent(pathname.slice(root.length + 1)) : null;

function adminProfile(input, forcedId = null) {
  if (!plainObject(input)) throw badRequest("Invalid device administrator profile.");
  const allowed = new Set(["id", "name", "description", "ciscoPrivilege", "mikrotikGroup", "enabled"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw badRequest("Unsupported device administrator profile field.");
  const id = safeId(forcedId || input.id);
  if (!id || (forcedId && input.id !== undefined && input.id !== forcedId)) throw badRequest("Invalid profile ID.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const ciscoPrivilege = input.ciscoPrivilege;
  const mikrotikGroup = typeof input.mikrotikGroup === "string" ? input.mikrotikGroup.trim() : "";
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw badRequest("Invalid profile name.");
  if (description.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) throw badRequest("Invalid profile description.");
  if (!Number.isInteger(ciscoPrivilege) || ciscoPrivilege < 0 || ciscoPrivilege > 15) throw badRequest("Cisco privilege must be between 0 and 15.");
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(mikrotikGroup)) throw badRequest("Invalid MikroTik group.");
  if (typeof input.enabled !== "boolean") throw badRequest("Profile enabled state must be explicit.");
  return { id, name, description, ciscoPrivilege, mikrotikGroup, enabled: input.enabled };
}

async function inventoryDevice(pool, deviceId) {
  const found = await pool.query(
    `SELECT h.id,s.company_id AS "companyId",h.ip,h.name
       FROM hosts h
       JOIN address_spaces s ON s.id=h.space_id
       JOIN companies c ON c.id=s.company_id
      WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,
    [deviceId],
  );
  return found.rowCount === 1 ? found.rows[0] : null;
}

function nasResponse(row) {
  return {
    id: row.id, companyId: row.companyId, deviceId: row.deviceId, name: row.name,
    vendor: row.vendor, nasIp: row.nasIp, enabled: row.enabled,
    services: Array.isArray(row.services) ? row.services : [],
    authPort: row.authPort, acctPort: row.acctPort,
  };
}

async function prepareStoredNas(pool, input, forcedId = null) {
  if (!plainObject(input)) throw badRequest("Invalid NAS profile.");
  if (forcedId && input.id !== undefined && input.id !== forcedId) throw badRequest("NAS profile ID does not match route.");
  const candidate = { ...input, ...(forcedId ? { id: forcedId } : {}) };
  if (!safeId(candidate.deviceId)) throw badRequest("Invalid NAS device reference.");
  const device = await inventoryDevice(pool, candidate.deviceId);
  if (!device) throw badRequest("NAS device was not found.");
  const requestedIp = normalizeNasIp(candidate.nasIp);
  const storedIp = normalizeNasIp(device.ip);
  if (!requestedIp || !storedIp || requestedIp !== storedIp) throw badRequest("NAS source IP must match the selected EMS device.");
  const result = prepareNasProfile(candidate, { devices: [{ id: device.id, companyId: device.companyId }] });
  if (!result.ok) throw badRequest(`Invalid NAS profile: ${result.issues.join(", ")}`);
  return result.value;
}

function isCrudPath(pathname, root) {
  return pathname === root || pathname.startsWith(root + "/");
}

export function createModule(ctx) {
  const { pool, json, readBody, requireAdmin, requireModuleAccess, audit, broadcast } = ctx;
  return {
    match(req, url) {
      const pathname = url.pathname;
      if (PREVIEW_PATHS.has(pathname)) return req.method === "POST";
      if (pathname === NAS_ROOT || pathname === ADMIN_ROOT) return ["GET", "POST"].includes(req.method);
      if (isCrudPath(pathname, NAS_ROOT) || isCrudPath(pathname, ADMIN_ROOT)) return ["PUT", "DELETE"].includes(req.method);
      return false;
    },

    async handle(req, res, url, user) {
      requireAdmin(user);
      await requireModuleAccess(user, "radius");
      const pathname = url.pathname;

      if (pathname === NAS_ROOT && req.method === "GET") {
        const rows = await pool.query(`SELECT id,company_id AS "companyId",device_id AS "deviceId",name,vendor,nas_ip AS "nasIp",
          enabled,services,auth_port AS "authPort",acct_port AS "acctPort"
          FROM radius_nas_profiles ORDER BY name,id`);
        return json(res, 200, { ok: true, items: rows.rows.map(nasResponse) });
      }

      if (pathname === ADMIN_ROOT && req.method === "GET") {
        const rows = await pool.query(`SELECT id,name,description,cisco_privilege AS "ciscoPrivilege",
          mikrotik_group AS "mikrotikGroup",enabled FROM radius_admin_profiles ORDER BY name,id`);
        return json(res, 200, { ok: true, items: rows.rows });
      }

      if (pathname === NAS_ROOT && req.method === "POST") {
        const value = await prepareStoredNas(pool, await readBody(req));
        const saved = await pool.query(`INSERT INTO radius_nas_profiles
          (id,company_id,device_id,name,vendor,nas_ip,enabled,services,auth_port,acct_port)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
          RETURNING id,company_id AS "companyId",device_id AS "deviceId",name,vendor,nas_ip AS "nasIp",
            enabled,services,auth_port AS "authPort",acct_port AS "acctPort"`,
          [value.id,value.companyId,value.deviceId,value.name,value.vendor,value.nasIp,value.enabled,JSON.stringify(value.services),value.authPort,value.acctPort]);
        await audit?.(user, "radius.nas.create", "radius_nas_profile", value.id, { companyId: value.companyId, detail: { deviceId: value.deviceId } });
        broadcast?.({ type: "radius", companyId: value.companyId, entityId: value.id });
        return json(res, 201, { ok: true, item: nasResponse(saved.rows[0]) });
      }

      const nasId = pathId(pathname, NAS_ROOT);
      if (nasId && req.method === "PUT") {
        if (!safeId(nasId)) throw badRequest("Invalid NAS profile ID.");
        const value = await prepareStoredNas(pool, await readBody(req), nasId);
        const saved = await pool.query(`UPDATE radius_nas_profiles SET company_id=$2,device_id=$3,name=$4,vendor=$5,nas_ip=$6,
          enabled=$7,services=$8::jsonb,auth_port=$9,acct_port=$10,updated_at=now() WHERE id=$1
          RETURNING id,company_id AS "companyId",device_id AS "deviceId",name,vendor,nas_ip AS "nasIp",
            enabled,services,auth_port AS "authPort",acct_port AS "acctPort"`,
          [value.id,value.companyId,value.deviceId,value.name,value.vendor,value.nasIp,value.enabled,JSON.stringify(value.services),value.authPort,value.acctPort]);
        if (!saved.rowCount) throw notFound("NAS profile was not found.");
        await audit?.(user, "radius.nas.update", "radius_nas_profile", value.id, { companyId: value.companyId, detail: { deviceId: value.deviceId } });
        broadcast?.({ type: "radius", companyId: value.companyId, entityId: value.id });
        return json(res, 200, { ok: true, item: nasResponse(saved.rows[0]) });
      }
      if (nasId && req.method === "DELETE") {
        if (!safeId(nasId)) throw badRequest("Invalid NAS profile ID.");
        const removed = await pool.query(`DELETE FROM radius_nas_profiles WHERE id=$1
          RETURNING id,company_id AS "companyId"`, [nasId]);
        if (!removed.rowCount) throw notFound("NAS profile was not found.");
        await audit?.(user, "radius.nas.delete", "radius_nas_profile", nasId, { companyId: removed.rows[0].companyId });
        broadcast?.({ type: "radius", companyId: removed.rows[0].companyId, entityId: nasId });
        return json(res, 200, { ok: true });
      }

      if (pathname === ADMIN_ROOT && req.method === "POST") {
        const value = adminProfile(await readBody(req));
        const saved = await pool.query(`INSERT INTO radius_admin_profiles
          (id,name,description,cisco_privilege,mikrotik_group,enabled) VALUES($1,$2,$3,$4,$5,$6)
          RETURNING id,name,description,cisco_privilege AS "ciscoPrivilege",mikrotik_group AS "mikrotikGroup",enabled`,
          [value.id,value.name,value.description,value.ciscoPrivilege,value.mikrotikGroup,value.enabled]);
        await audit?.(user, "radius.admin-profile.create", "radius_admin_profile", value.id);
        broadcast?.({ type: "radius", entityId: value.id });
        return json(res, 201, { ok: true, item: saved.rows[0] });
      }

      const adminId = pathId(pathname, ADMIN_ROOT);
      if (adminId && req.method === "PUT") {
        if (!safeId(adminId)) throw badRequest("Invalid device administrator profile ID.");
        const value = adminProfile(await readBody(req), adminId);
        const saved = await pool.query(`UPDATE radius_admin_profiles SET name=$2,description=$3,cisco_privilege=$4,
          mikrotik_group=$5,enabled=$6,updated_at=now() WHERE id=$1
          RETURNING id,name,description,cisco_privilege AS "ciscoPrivilege",mikrotik_group AS "mikrotikGroup",enabled`,
          [value.id,value.name,value.description,value.ciscoPrivilege,value.mikrotikGroup,value.enabled]);
        if (!saved.rowCount) throw notFound("Device administrator profile was not found.");
        await audit?.(user, "radius.admin-profile.update", "radius_admin_profile", value.id);
        broadcast?.({ type: "radius", entityId: value.id });
        return json(res, 200, { ok: true, item: saved.rows[0] });
      }
      if (adminId && req.method === "DELETE") {
        if (!safeId(adminId)) throw badRequest("Invalid device administrator profile ID.");
        const removed = await pool.query("DELETE FROM radius_admin_profiles WHERE id=$1 RETURNING id", [adminId]);
        if (!removed.rowCount) throw notFound("Device administrator profile was not found.");
        await audit?.(user, "radius.admin-profile.delete", "radius_admin_profile", adminId);
        broadcast?.({ type: "radius", entityId: adminId });
        return json(res, 200, { ok: true });
      }

      const body = await readBody(req);
      if (!plainObject(body)) throw badRequest("Invalid RADIUS preview input.");
      if (pathname === "/api/radius/preview/mab") {
        if (Array.isArray(body.knownMacs) && body.knownMacs.length > 5000) throw badRequest("RADIUS preview inventory is too large.");
        return json(res, 200, { ok: true, status: "preview-only", result: previewMabDecision(body) });
      }
      if (pathname === "/api/radius/preview/admin-profile") {
        return json(res, 200, { ok: true, status: "preview-only", result: previewDeviceAdminProfile(body) });
      }
      if (pathname === "/api/radius/preview/nas-client") {
        if (!plainObject(body.profile) || !safeId(body.profile.deviceId)) throw badRequest("Invalid NAS device reference.");
        const device = await inventoryDevice(pool, body.profile.deviceId);
        if (!device) throw badRequest("NAS device was not found.");
        const requestedIp = normalizeNasIp(body.profile.nasIp);
        const storedIp = normalizeNasIp(device.ip);
        if (!requestedIp || !storedIp || requestedIp !== storedIp) {
          return json(res, 200, { ok: true, status: "preview-only", result: { status: "invalid", text: "", issues: ["nas-ip-device-mismatch"] } });
        }
        return json(res, 200, { ok: true, status: "preview-only",
          result: previewNasClientConfig(body.profile, { devices: [{ id: device.id, companyId: device.companyId }] }) });
      }
      return json(res, 200, { ok: true, status: "preview-only", result: reviewMabPolicyMatrix(body) });
    },
  };
}
