export function createModule(ctx) {
  const { pool,json,readBody,cleanText,requireModuleAccess,canAccessSpace,pingMany,storePingResults,audit,broadcast } = ctx;
  return { match: (req,url) => req.method === "POST" && url.pathname === "/api/ping/host",
    async handle(req,res,url,user) {
      const pathname=url.pathname;
  if (req.method === "POST" && pathname === "/api/ping/host") {
    await requireModuleAccess(user, "radio");
    const body = await readBody(req);
    const id = cleanText(body.id, 80);
    const found = await pool.query(
      `SELECT h.id,h.space_id AS "spaceId",h.ip,s.company_id AS "companyId"
         FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id
        WHERE h.id=$1 AND h.radio_mode IN ('ap','station') AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [id],
    );
    const host = found.rows[0];
    if (!host || !(await canAccessSpace(user, host.spaceId))) throw Object.assign(new Error("تجهیز پیدا نشد یا دسترسی ندارید."), { status: 404 });
    const results = await pingMany([host.ip], { concurrency: 1, timeoutSeconds: 1 });
    await storePingResults(host.spaceId, results);
    const online = results.get(host.ip) === true;
    await audit(user, "ping", "host", host.id, { companyId: host.companyId, spaceId: host.spaceId, detail: { ip: host.ip, online } });
    broadcast({ type: "host", companyId: host.companyId, spaceId: host.spaceId, entityId: host.id });
    return json(res, 200, { ok: true, ip: host.ip, online });
  }

    }
  };
}
