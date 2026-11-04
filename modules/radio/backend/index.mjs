import {createRadioGeo} from './geo.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

export function createModule(ctx) {
  const geo = createRadioGeo(ctx);
  const { pool,json,readBody,cleanText,requireAdmin,requireModuleAccess,canAccessSpace,pingMany,storePingResults,audit,broadcast } = ctx;
  // A module-owned JSON file; never stores credentials or config.
  const radioDir = path.join(ctx.backupDir || process.env.BACKUP_DIR || '/backups', 'radio-documentation');
  const radioFile = path.join(radioDir, 'uplinks.json');
  async function readLinks() {
    try {
      const data = JSON.parse(await fs.readFile(radioFile, 'utf8'));
      return Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      if (['ENOENT','EACCES','EPERM'].includes(error.code)) return [];
      throw error;
    }
  }
  async function getHost(id, onlyAp = false) {
    const result=await pool.query(`SELECT h.id,h.space_id AS "spaceId",s.company_id AS "companyId",h.radio_mode AS "radioMode"
      FROM hosts h JOIN address_spaces s ON s.id=h.space_id
      JOIN companies c ON c.id=s.company_id
      WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,[id]);
    const host=result.rows[0];
    if(!host || (onlyAp && host.radioMode!=='ap')) throw Object.assign(new Error('Radio device not found.'),{status:404});
    return host;
  }
  return { match: (req,url) => (req.method === "POST" && url.pathname === "/api/ping/host") || url.pathname === "/api/radio/uplink" || geo.match(req,url),
    async handle(req,res,url,user) {
      const pathname=url.pathname;
      if (geo.match(req,url)) return geo.handle(req,res,url,user);
      if (pathname === '/api/radio/uplink') {
        await requireModuleAccess(user, 'radio');
        const body = req.method==='PUT' ? await readBody(req) : {};
        if (!['GET','PUT'].includes(req.method)) throw Object.assign(new Error('Method not allowed.'),{status:405});
        if (req.method==='PUT') requireAdmin(user);
        const apId=cleanText(req.method==='GET'?url.searchParams.get('apId'):body.apId,80);
        const ap=await getHost(apId,true);
        if (!(await canAccessSpace(user,ap.spaceId))) throw Object.assign(new Error('Access denied.'),{status:404});
        if (req.method==='GET') {
          const savedRows=(await pool.query(
            'SELECT ap_id AS "apId", destination_id AS "destinationId", port, updated_at AS "updatedAt" FROM radio_doc_uplinks WHERE ap_id=$1',
            [apId]
          )).rows;
          const saved=savedRows.length?savedRows[0]:(await readLinks()).find(item=>item.apId===apId);
          if (!saved?.destinationId) return json(res,200,{ok:true,link:null});
          const destination=await getHost(saved.destinationId).catch(()=>null);
          if (!destination || destination.companyId!==ap.companyId || !(await canAccessSpace(user,destination.spaceId)))
            return json(res,200,{ok:true,link:null});
          return json(res,200,{ok:true,link:saved});
        }
        const destinationId=cleanText(body.destinationId,80);
        const port=cleanText(body.port,64);
        if (destinationId) {
          const destination=await getHost(destinationId);
          if (destination.companyId!==ap.companyId || destination.id===ap.id || ['ap','station'].includes(destination.radioMode) || !(await canAccessSpace(user,destination.spaceId)))
            throw Object.assign(new Error('Choose a switch or system in the same accessible inventory.'),{status:400});
        }
        const link=destinationId?{apId,destinationId,port,updatedAt:new Date().toISOString()}:null;
        // Radio-only database table, not the root-owned backup bind mount.
        // NULL destination records a clear so legacy JSON cannot restore a removed link.
        await pool.query(
          'INSERT INTO radio_doc_uplinks(ap_id,destination_id,port) VALUES($1,$2,$3) ' +
          'ON CONFLICT(ap_id) DO UPDATE SET destination_id=EXCLUDED.destination_id,port=EXCLUDED.port,updated_at=now()',
          [apId,destinationId||null,destinationId?port:'']
        );
        await audit(user,'radio.uplink','host',apId,{companyId:ap.companyId,spaceId:ap.spaceId,detail:{destinationId,port}});
        return json(res,200,{ok:true,link});
      }
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
    if (!host || !(await canAccessSpace(user, host.spaceId))) throw Object.assign(new Error("Radio device was not found or access was denied."), { status: 404 });
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
