import fs from 'node:fs/promises';
import path from 'node:path';

const URLS = new Set(['/api/radio/locations', '/api/radio/location', '/api/radio/map']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const finiteCoordinate = (v, min, max) => {
  if (v === null || v === undefined || String(v).trim() === '') throw fail('Both latitude and longitude are required.');
  const number = Number(v);
  if (!Number.isFinite(number) || number < min || number > max) throw fail('Invalid geographic coordinates.');
  return Math.round(number * 1e6) / 1e6;
};

export function createRadioGeo(ctx) {
  const {pool, json, readBody, requireModuleAccess, requireAdmin, canAccessSpace, audit} = ctx;
  const folder = path.join(ctx.backupDir || process.env.BACKUP_DIR || '/backups', 'radio-documentation');
  const file = path.join(folder, 'locations.json');

  async function readSaved() {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(data.items)) throw new Error('Malformed saved radio locations.');
      return data.items;
    } catch (error) {
      if (['ENOENT','EACCES','EPERM'].includes(error.code)) return [];
      throw error;
    }
  }

  async function hostRecord(id) {
    const found = await pool.query(
      'SELECT h.id, h.radio_mode AS "radioMode", h.space_id AS "spaceId", s.company_id AS "companyId" ' +
      'FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id ' +
      "WHERE h.id=$1 AND h.radio_mode IN ('ap','station') AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL",
      [id]
    );
    return found.rows[0] || null;
  }

  return {
    match: (_req, url) => URLS.has(url.pathname),
    async handle(req,res,url,user) {
      await requireModuleAccess(user,'radio');
      if (url.pathname === '/api/radio/map') {
        if (req.method !== 'GET') throw fail('Method not allowed.',405);
        const html = await fs.readFile(new URL('../public/map-frame.html',import.meta.url));
        res.writeHead(200,{
          'Content-Type':'text/html; charset=utf-8',
          'Content-Length':html.length,
          'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff',
          'Referrer-Policy':'strict-origin-when-cross-origin',
          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
        });
        res.end(html); return;
      }
      if (url.pathname === '/api/radio/locations') {
        if (req.method !== 'GET') throw fail('Method not allowed.',405);
        const apId=String(url.searchParams.get('apId') || '').trim().slice(0,80);
        const ap=await hostRecord(apId);
        if (!ap || ap.radioMode !== 'ap' || !(await canAccessSpace(user,ap.spaceId))) throw fail('Access point not found.',404);
        const rows=(await pool.query(
          'SELECT h.id, h.space_id AS "spaceId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id ' +
          "WHERE (h.id=$1 OR (h.radio_parent_host_id=$1 AND h.radio_mode='station')) " +
          'AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND s.company_id=$2',
          [apId,ap.companyId]
        )).rows;
        const allowed=new Set();
        for(const row of rows) if(await canAccessSpace(user,row.spaceId)) allowed.add(row.id);
        const records=(await pool.query(
          'SELECT host_id AS "hostId", latitude, longitude FROM radio_doc_locations WHERE host_id=ANY($1::text[])',
          [[...allowed]]
        )).rows;
        // Database records take precedence; NULL records mark a deliberately cleared location.
        const documented=new Map(records.map(record=>[record.hostId,record]));
        for (const legacy of await readSaved()) {
          if (allowed.has(legacy.hostId) && !documented.has(legacy.hostId)) documented.set(legacy.hostId,legacy);
        }
        const items=[...documented.values()].filter(item=>item.latitude!==null && item.longitude!==null)
          .map(({hostId,latitude,longitude})=>({hostId,latitude:Number(latitude),longitude:Number(longitude)}));
        return json(res,200,{ok:true,items});
      }
      if (url.pathname === '/api/radio/location') {
        if (req.method !== 'PUT') throw fail('Method not allowed.',405);
        requireAdmin(user);
        const body=await readBody(req);
        const hostId=String(body.hostId||'').trim().slice(0,80);
        const host=await hostRecord(hostId);
        if (!host || !(await canAccessSpace(user,host.spaceId))) throw fail('Radio host not found.',404);
        const clear=(body.latitude===null || body.latitude==='') && (body.longitude===null || body.longitude==='');
        const latitude=clear?null:finiteCoordinate(body.latitude,-90,90);
        const longitude=clear?null:finiteCoordinate(body.longitude,-180,180);
        // Upsert also for clears, so a legacy JSON record cannot reappear on the next GET.
        await pool.query(
          'INSERT INTO radio_doc_locations(host_id,latitude,longitude) VALUES($1,$2,$3) ' +
          'ON CONFLICT(host_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,updated_at=now()',
          [hostId,latitude,longitude]
        );
        const item=clear?null:{hostId,latitude,longitude,updatedAt:new Date().toISOString()};
        await audit(user,'radio.location','host',hostId,{companyId:host.companyId,spaceId:host.spaceId,detail:{coordinatesSaved:!!item}});
        return json(res,200,{ok:true,item});
      }
    }
  };
}
