import { prepareRouter } from "../model.mjs";

const ROOT = "/api/branches/routers";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const safeId = (value) => typeof value === "string" && idPattern.test(value) ? value : null;
const pathId = (pathname) => pathname.startsWith(ROOT + "/") ? decodeURIComponent(pathname.slice(ROOT.length + 1)) : null;

function mapRouter(row) {
  return {
    id: row.id, companyId: row.companyId, branchId: row.branchId, inventoryHostId: row.inventoryHostId,
    name: row.name, managementAddress: row.managementAddress, publicAddress: row.publicAddress,
    vendor: row.vendor, model: row.model, notes: row.notes,
    accessMethods: Array.isArray(row.accessMethods) ? row.accessMethods : [],
  };
}

async function companyRecord(pool, id) {
  const found = await pool.query(
    `SELECT id,parent_company_id AS "parentCompanyId",kind,name
       FROM companies WHERE id=$1 AND deleted_at IS NULL`, [id],
  );
  return found.rowCount === 1 ? found.rows[0] : null;
}

async function hostRecord(pool, id) {
  if (!id) return null;
  const found = await pool.query(
    `SELECT h.id,h.ip,s.company_id AS "companyId"
       FROM hosts h JOIN address_spaces s ON s.id=h.space_id
       JOIN companies c ON c.id=s.company_id
      WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`, [id],
  );
  return found.rowCount === 1 ? found.rows[0] : null;
}

async function prepareStoredRouter(pool, input, forcedId = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badRequest("Invalid router profile.");
  const candidate = { ...input, ...(forcedId ? { id: forcedId } : {}) };
  if (forcedId && input.id !== undefined && input.id !== forcedId) throw badRequest("Router ID does not match route.");
  const company = safeId(candidate.companyId) ? await companyRecord(pool, candidate.companyId) : null;
  if (!company) throw badRequest("Owning company was not found.");

  let branches = [];
  if (candidate.branchId) {
    const branch = safeId(candidate.branchId) ? await companyRecord(pool, candidate.branchId) : null;
    if (!branch || branch.kind !== "branch") throw badRequest("Branch was not found.");
    if (branch.parentCompanyId !== company.id) throw badRequest("Branch does not belong to the selected company.");
    branches = [{ id: branch.id, companyId: company.id, name: branch.name }];
  }

  const result = prepareRouter(candidate, branches);
  if (!result.ok) throw badRequest(`Invalid router profile: ${result.issues.join(", ")}`);
  const value = result.value;

  if (value.inventoryHostId) {
    const host = await hostRecord(pool, value.inventoryHostId);
    if (!host) throw badRequest("Linked inventory device was not found.");
    const allowedCompanies = new Set([value.companyId, value.branchId].filter(Boolean));
    if (!allowedCompanies.has(host.companyId)) throw badRequest("Linked inventory device belongs to another company or branch.");
  }
  return value;
}

export function createModule(ctx) {
  const { pool, json, readBody, requireAdmin, requireModuleAccess, audit, broadcast } = ctx;
  return {
    match(req, url) {
      if (url.pathname === ROOT) return ["GET", "POST"].includes(req.method);
      if (url.pathname.startsWith(ROOT + "/")) return ["PUT", "DELETE"].includes(req.method);
      return false;
    },
    async handle(req, res, url, user) {
      requireAdmin(user);
      await requireModuleAccess(user, "branches");

      if (url.pathname === ROOT && req.method === "GET") {
        const result = await pool.query(
          `SELECT r.id,r.company_id AS "companyId",r.branch_id AS "branchId",r.inventory_host_id AS "inventoryHostId",
                  r.name,r.management_address AS "managementAddress",r.public_address AS "publicAddress",
                  r.vendor,r.model,r.notes,r.access_methods AS "accessMethods",
                  c.name AS "companyName",b.name AS "branchName",h.ip AS "inventoryIp"
             FROM branch_routers r
             JOIN companies c ON c.id=r.company_id AND c.deleted_at IS NULL
             LEFT JOIN companies b ON b.id=r.branch_id AND b.deleted_at IS NULL
             LEFT JOIN hosts h ON h.id=r.inventory_host_id AND h.deleted_at IS NULL
            ORDER BY c.name,b.name NULLS LAST,r.name`,
        );
        return json(res, 200, { ok: true, items: result.rows.map((row) => ({ ...mapRouter(row),
          companyName: row.companyName, branchName: row.branchName || "", inventoryIp: row.inventoryIp || "" })) });
      }

      if (url.pathname === ROOT && req.method === "POST") {
        const value = await prepareStoredRouter(pool, await readBody(req));
        const saved = await pool.query(
          `INSERT INTO branch_routers(id,company_id,branch_id,inventory_host_id,name,management_address,public_address,vendor,model,notes,access_methods)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           RETURNING id,company_id AS "companyId",branch_id AS "branchId",inventory_host_id AS "inventoryHostId",
             name,management_address AS "managementAddress",public_address AS "publicAddress",vendor,model,notes,access_methods AS "accessMethods"`,
          [value.id,value.companyId,value.branchId,value.inventoryHostId,value.name,value.managementAddress,value.publicAddress,
           value.vendor,value.model,value.notes,JSON.stringify(value.accessMethods)],
        );
        await audit?.(user, "branches.router.create", "branch_router", value.id, { companyId: value.companyId, detail: { branchId: value.branchId, inventoryHostId: value.inventoryHostId } });
        broadcast?.({ type: "branches", companyId: value.companyId, entityId: value.id });
        return json(res, 201, { ok: true, item: mapRouter(saved.rows[0]) });
      }

      const routerId = pathId(url.pathname);
      if (!safeId(routerId)) throw badRequest("Invalid router ID.");

      if (req.method === "PUT") {
        const value = await prepareStoredRouter(pool, await readBody(req), routerId);
        const saved = await pool.query(
          `UPDATE branch_routers SET company_id=$2,branch_id=$3,inventory_host_id=$4,name=$5,management_address=$6,
             public_address=$7,vendor=$8,model=$9,notes=$10,access_methods=$11::jsonb,updated_at=now()
           WHERE id=$1 RETURNING id,company_id AS "companyId",branch_id AS "branchId",inventory_host_id AS "inventoryHostId",
             name,management_address AS "managementAddress",public_address AS "publicAddress",vendor,model,notes,access_methods AS "accessMethods"`,
          [value.id,value.companyId,value.branchId,value.inventoryHostId,value.name,value.managementAddress,value.publicAddress,
           value.vendor,value.model,value.notes,JSON.stringify(value.accessMethods)],
        );
        if (!saved.rowCount) throw notFound("Router was not found.");
        await audit?.(user, "branches.router.update", "branch_router", value.id, { companyId: value.companyId, detail: { branchId: value.branchId, inventoryHostId: value.inventoryHostId } });
        broadcast?.({ type: "branches", companyId: value.companyId, entityId: value.id });
        return json(res, 200, { ok: true, item: mapRouter(saved.rows[0]) });
      }

      const removed = await pool.query("DELETE FROM branch_routers WHERE id=$1 RETURNING id,company_id AS \"companyId\"", [routerId]);
      if (!removed.rowCount) throw notFound("Router was not found.");
      await audit?.(user, "branches.router.delete", "branch_router", routerId, { companyId: removed.rows[0].companyId });
      broadcast?.({ type: "branches", companyId: removed.rows[0].companyId, entityId: routerId });
      return json(res, 200, { ok: true });
    },
  };
}
