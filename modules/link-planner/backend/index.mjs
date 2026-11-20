import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {coordinate,endpoint,greatCircleMeters,normalizeInput} from '../public/model.mjs';

const PREFIX='/api/link-planner/';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terrainProvider='https://api.opentopodata.org/v1/srtm90m';
const sampleCount=81;
export function createModule(ctx) {
 const {pool,json,readBody,requireAdmin,requireModuleAccess,audit}=ctx;
 const fetcher=ctx.terrainFetch||globalThis.fetch;
 const cache=new Map();
 const cooldown=new Map();
 let requestInFlight=null;
 const validatePair=(params)=>{
   const a=endpoint({latitude:params.get('latA'),longitude:params.get('lonA')},'A');
   const b=endpoint({latitude:params.get('latB'),longitude:params.get('lonB')},'B');
   const km=greatCircleMeters(a,b)/1000;
   if(km<.01||km>300)throw fail('Path must be between 10 metres and 300 km.');
   return {a,b,km};
 };
 const loadTerrain=async(a,b)=>{
   if(Math.abs(a.latitude)>60||Math.abs(b.latitude)>60)throw fail('SRTM90 coverage is only latitude -60° to +60°. Terrain unavailable outside that range.',422);
   const url=new URL(terrainProvider);
   url.searchParams.set('locations',[a,b].map(p=>p.latitude.toFixed(6)+','+p.longitude.toFixed(6)).join('|'));
   url.searchParams.set('samples',String(sampleCount));
   url.searchParams.set('interpolation','bilinear');
   url.searchParams.set('nodata_value','null');
   let response;
   try{
     response=await fetcher(url.toString(),{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
   }catch(e){throw fail('Terrain service is unreachable or timed out. No clearance prediction was generated.',503);}
   if(!response.ok)throw fail('Public SRTM terrain service returned HTTP '+response.status+'. Retry later.',503);
   let data;
   try{data=await response.json();}catch{throw fail('Invalid terrain service response.',503);}
   if(data?.status!=='OK'||!Array.isArray(data.results)||data.results.length!==sampleCount)
     throw fail('Terrain service did not return all '+sampleCount+' requested samples.',503);
   const elevations=data.results.map(item=>item?.elevation===null?null:Number(item?.elevation));
   if(elevations.some(n=>n!==null&&(!Number.isFinite(n)||n< -12000||n>12000)))
     throw fail('Terrain elevation data contains invalid samples.',503);
   return {ok:true,dataset:'srtm90m',resolutionNote:'approximately 90 m raster; sample spacing depends on path length',sampleCount,
     missing:elevations.filter(v=>v===null).length,elevations,retrievedAt:new Date().toISOString(),
     source:'Open Topo Data public API (SRTM90m)',sourceUrl:'https://www.opentopodata.org/datasets/srtm/'};
 };
 return {
  match:(_req,url)=>url.pathname.startsWith(PREFIX),
  async handle(req,res,url,user){
   requireAdmin(user);
   await requireModuleAccess(user,'link-planner');
   const pathname=url.pathname,method=req.method;
   if(pathname==='/api/link-planner/map'){
     if(method!=='GET')throw fail('Method not allowed',405);
     const file=await fs.readFile(new URL('../public/map-frame.html',import.meta.url));
     res.writeHead(200,{
       'Content-Type':'text/html; charset=utf-8','Content-Length':file.length,'Cache-Control':'no-store',
       'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
       'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
     });
     res.end(file);return;
   }
   if(pathname==='/api/link-planner/terrain'){
     if(method!=='GET')throw fail('Method not allowed',405);
     const {a,b}=validatePair(url.searchParams);
     if(Math.abs(a.latitude)>60||Math.abs(b.latitude)>60)
       throw fail('SRTM90 covers latitudes -60° to +60°. Terrain is unavailable for this path.',422);
     const key=[a.latitude,a.longitude,b.latitude,b.longitude].map(x=>x.toFixed(6)).join(',');
     const stored=cache.get(key);
     if(stored&&stored.expires>Date.now())return json(res,200,{...stored.value,cached:true});
     const id=String(user.id||user.username||'admin'),now=Date.now();
     if(now-(cooldown.get(id)||0)<2000)throw fail('Terrain service rate limit: wait two seconds before trying again.',429);
     if(requestInFlight)throw fail('Another terrain request is in progress. Retry shortly.',429);
     cooldown.set(id,now);
     // Outbound requests are restricted to one fixed HTTPS terrain provider, never a user URL.
     const work=loadTerrain(a,b);requestInFlight=work;
     let payload;
     try{payload=await work;}finally{if(requestInFlight===work)requestInFlight=null;}
     if(cache.size>=40)cache.delete(cache.keys().next().value);
     cache.set(key,{value:payload,expires:now+600000});
     return json(res,200,payload);
   }
   if(pathname==='/api/link-planner/scenarios'){
     if(method==='GET'){
       const records=await pool.query('SELECT id::text,name,config,updated_at AS "updatedAt" FROM link_planner_scenarios ORDER BY updated_at DESC LIMIT 100');
       return json(res,200,{ok:true,items:records.rows});
     }
     if(method==='POST'){
       const body=await readBody(req);
       const name=String(body.name||'').trim().slice(0,80);
       if(!name)throw fail('Scenario name is required.');
       const config=normalizeInput(body.config);
       const total=(await pool.query('SELECT count(*)::int AS n FROM link_planner_scenarios')).rows[0]?.n||0;
       if(Number(total)>=100)throw fail('Scenario limit reached (100). Remove an old scenario.',409);
       const id=crypto.randomUUID();
       const result=await pool.query(
         'INSERT INTO link_planner_scenarios(id,name,config) VALUES($1,$2,$3::jsonb) RETURNING id::text,name,config,updated_at AS "updatedAt"',
         [id,name,JSON.stringify(config)]
       );
       await audit(user,'link-planner.save','link_planner_scenario',id,{detail:{name}});
       return json(res,201,{ok:true,item:result.rows[0]});
     }
     throw fail('Method not allowed',405);
   }
   const match=pathname.match(/^\/api\/link-planner\/scenarios\/([0-9a-f-]+)$/i);
   if(match){
     const id=match[1];
     if(!uuid.test(id))throw fail('Invalid scenario identifier.');
     if(method==='DELETE'){
       const result=await pool.query('DELETE FROM link_planner_scenarios WHERE id=$1 RETURNING name',[id]);
       if(!result.rowCount)throw fail('Scenario not found.',404);
       await audit(user,'link-planner.delete','link_planner_scenario',id,{detail:{name:result.rows[0].name}});
       return json(res,200,{ok:true});
     }
     if(method==='GET'){
       const result=await pool.query('SELECT id::text,name,config,updated_at AS "updatedAt" FROM link_planner_scenarios WHERE id=$1',[id]);
       if(!result.rows.length)throw fail('Scenario not found.',404);
       return json(res,200,{ok:true,item:result.rows[0]});
     }
     throw fail('Method not allowed',405);
   }
   throw fail('Link Planner resource not found.',404);
  }
 };
}
