import { previewMabDecision } from "../policy-preview.mjs";
import { previewDeviceAdminProfile } from "../admin-profile-preview.mjs";
import { reviewMabPolicyMatrix } from "../review-matrix.mjs";

const PATHS = new Set([
  "/api/radius/preview/mab",
  "/api/radius/preview/admin-profile",
  "/api/radius/preview/mab-matrix",
]);

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createModule(ctx) {
  const { json, readBody, requireAdmin, requireModuleAccess } = ctx;
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
      return json(res, 200, { ok: true, status: "preview-only", result: reviewMabPolicyMatrix(body) });
    },
  };
}
