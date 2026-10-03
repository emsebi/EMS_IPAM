import crypto from "node:crypto";
export function createModule(ctx) {
  const { pool, json, readBody, cleanText, validColor, requireAdmin, audit, broadcast } = ctx;
  return {
    match: (req,url) => /^\/api\/device-types(?:\/[^/]+)?$/.test(url.pathname) && ["GET","POST","PUT","DELETE"].includes(req.method),
    async handle(req,res,url,user) {
      const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/device-types") {
    const rows = await pool.query(`SELECT id,name,color,created_at AS "createdAt",updated_at AS "updatedAt" FROM device_types ORDER BY lower(name)`);
    return json(res, 200, { ok: true, items: rows.rows });
  }

  if (req.method === "POST" && pathname === "/api/device-types") {
    requireAdmin(user);
    const body = await readBody(req);
    const name = cleanText(body.name, 100);
    if (!name) throw new Error("نام نوع تجهیز الزامی است.");
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO device_types(id,name,color) VALUES($1,$2,$3)`, [id,name,validColor(body.color,"#3157d5")]);
    await audit(user,"create","device_type",id,{detail:{name}});
    return json(res,201,{ok:true,id});
  }

  const deviceTypeMatch = pathname.match(/^\/api\/device-types\/([^/]+)$/);
  if (deviceTypeMatch && req.method === "PUT") {
    requireAdmin(user);
    const body = await readBody(req);
    const name = cleanText(body.name,100);
    if (!name) throw new Error("نام نوع تجهیز الزامی است.");
    const before = await pool.query("SELECT name FROM device_types WHERE id=$1",[deviceTypeMatch[1]]);
    if (!before.rowCount) throw Object.assign(new Error("نوع تجهیز پیدا نشد."),{status:404});
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const locked=await client.query("SELECT name FROM device_types WHERE id=$1 FOR UPDATE",[deviceTypeMatch[1]]);
      if (!locked.rowCount) throw Object.assign(new Error("نوع تجهیز پیدا نشد."),{status:404});
      await client.query("UPDATE device_types SET name=$2,color=$3,updated_at=now() WHERE id=$1",[deviceTypeMatch[1],name,validColor(body.color,"#3157d5")]);
      await client.query("UPDATE hosts SET type=$2,updated_at=now() WHERE type=$1",[locked.rows[0].name,name]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    await audit(user,"update","device_type",deviceTypeMatch[1],{detail:{name}});
    broadcast({type:"host"});
    return json(res,200,{ok:true});
  }

  if (deviceTypeMatch && req.method === "DELETE") {
    requireAdmin(user);
    const found = await pool.query("SELECT name FROM device_types WHERE id=$1",[deviceTypeMatch[1]]);
    if (!found.rowCount) throw Object.assign(new Error("نوع تجهیز پیدا نشد."),{status:404});
    const used = await pool.query("SELECT count(*)::int AS count FROM hosts WHERE type=$1 AND deleted_at IS NULL",[found.rows[0].name]);
    if (used.rows[0].count > 0) throw new Error(`این نوع تجهیز توسط ${used.rows[0].count} تجهیز استفاده می‌شود؛ ابتدا نوع آن تجهیزات را تغییر دهید.`);
    await pool.query("DELETE FROM device_types WHERE id=$1",[deviceTypeMatch[1]]);
    await audit(user,"delete","device_type",deviceTypeMatch[1]);
    return json(res,200,{ok:true});
  }

      return json(res,405,{ok:false,error:"Method not allowed"});
    }
  };
}
