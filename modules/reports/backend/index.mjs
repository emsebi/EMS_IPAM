const SUMMARY = "/api/reports/summary";
const AUDIT = "/api/reports/audit";

const boundedLimit = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 200 ? number : 50;
};

async function optionalCount(pool, table, where = "") {
  const exists = await pool.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  if (!exists.rows[0]?.name) return 0;
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} ${where}`);
  return Number(result.rows[0]?.count || 0);
}

async function preferredOptionalCount(pool, primaryTable, fallbackTable) {
  const primary = await optionalCount(pool, primaryTable);
  return primary > 0 ? primary : optionalCount(pool, fallbackTable);
}

export function createModule(ctx) {
  const { pool, json, requireAdmin, requireModuleAccess } = ctx;
  return {
    match: (req, url) => req.method === "GET" && (url.pathname === SUMMARY || url.pathname === AUDIT),
    async handle(req, res, url, user) {
      requireAdmin(user);
      await requireModuleAccess(user, "reports");

      if (url.pathname === SUMMARY) {
        const [companies, branches, hosts, personnel, accessPoints, stations, routers, radiusNas, radiusPolicies] = await Promise.all([
          pool.query("SELECT count(*)::int AS count FROM companies WHERE deleted_at IS NULL AND kind <> 'branch'"),
          pool.query("SELECT count(*)::int AS count FROM companies WHERE deleted_at IS NULL AND kind='branch'"),
          pool.query("SELECT count(*)::int AS count FROM hosts WHERE deleted_at IS NULL"),
          pool.query("SELECT count(*)::int AS count FROM personnel WHERE active=true"),
          pool.query("SELECT count(*)::int AS count FROM hosts WHERE deleted_at IS NULL AND radio_mode='ap'"),
          pool.query("SELECT count(*)::int AS count FROM hosts WHERE deleted_at IS NULL AND radio_mode='station'"),
          optionalCount(pool, "branch_routers"),
          preferredOptionalCount(pool, "radius_ops_devices", "radius_nas_profiles"),
          optionalCount(pool, "radius_mab_policies"),
        ]);
        return json(res, 200, { ok: true, summary: {
          companies: Number(companies.rows[0].count), branches: Number(branches.rows[0].count),
          hosts: Number(hosts.rows[0].count), activePersonnel: Number(personnel.rows[0].count),
          accessPoints: Number(accessPoints.rows[0].count), stations: Number(stations.rows[0].count),
          routers, radiusNas, radiusPolicies,
        } });
      }

      const limit = boundedLimit(url.searchParams.get("limit"));
      const rows = await pool.query(
        `SELECT a.action,a.entity_type AS "entityType",a.created_at AS "createdAt",
                u.username,c.name AS "companyName"
           FROM audit_log a
           LEFT JOIN users u ON u.id=a.user_id
           LEFT JOIN companies c ON c.id=a.company_id
          ORDER BY a.created_at DESC,a.id DESC LIMIT $1`, [limit],
      );
      return json(res, 200, { ok: true, items: rows.rows.map((row) => ({
        action: row.action, entityType: row.entityType, createdAt: row.createdAt,
        username: row.username || "", companyName: row.companyName || "",
      })) });
    },
  };
}
