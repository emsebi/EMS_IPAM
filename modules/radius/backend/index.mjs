import { previewMabDecision } from "../policy-preview.mjs";
import { previewDeviceAdminProfile } from "../admin-profile-preview.mjs";
import { reviewMabPolicyMatrix } from "../review-matrix.mjs";
import { normalizeNasIp } from "../nas-inventory.mjs";
import { previewNasClientConfig } from "../nas-config-preview.mjs";

const PATHS = new Set([
  "/api/radius/preview/mab",
  "/api/radius/preview/admin-profile",
  "/api/radius/preview/mab-matrix",
  "/api/radius/preview/nas-client",
]);

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createModule(ctx) {
  const { pool, json, readBody, requireAdmin, requireModuleAccess } = ctx;
  return {
    match: (req, url) => req.method === "POST" && PATHS.has(url.pathname),
    async handle(req, res, url, user) {
      requireAdmin(user);
      await requireModuleAccess(user, "radius");
      const body = await readBody(req);
      if (!plainObject(body)) throw badRequest("Invalid RADIUS preview input.");

      if (url.pathname === "/api/radius/preview/mab") {
        if (Array.isArray(body.knownMacs) && body.knownMacs.length > 5000) throw badRequest("RADIUS preview inventory is too large.");
        return json(res, 200, { ok: true, status: "preview-only", result: previewMabDecision(body) });
      }
      if (url.pathname === "/api/radius/preview/admin-profile") {
        return json(res, 200, { ok: true, status: "preview-only", result: previewDeviceAdminProfile(body) });
      }
      if (url.pathname === "/api/radius/preview/nas-client") {
        if (!plainObject(body.profile) || typeof body.profile.deviceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(body.profile.deviceId)) {
          throw badRequest("Invalid NAS device reference.");
        }
        const found = await pool.query(
          `SELECT h.id,s.company_id AS "companyId",h.ip
             FROM hosts h
             JOIN address_spaces s ON s.id=h.space_id
             JOIN companies c ON c.id=s.company_id
            WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,
          [body.profile.deviceId],
        );
        if (found.rowCount !== 1) throw badRequest("NAS device was not found.");
        const device = found.rows[0];
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
