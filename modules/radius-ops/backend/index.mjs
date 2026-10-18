import crypto from 'node:crypto';
import {
  fail,name,user,password,secret,ip,nasSource,mac,aliases,vid,priv,
  checkVendor,checkAccountVendor,checkGroup,replies,cli,
} from './model.mjs';

const base='/api/radius-ops';
const idre=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const uid=v=>{if(typeof v!=='string'||!idre.test(v))throw fail('Invalid ID');return v;};
const active=v=>{if(typeof v!=='boolean')throw fail('Invalid enabled state');return v;};
const key=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,80}$/.test(v))throw fail('Invalid reference');return v;};
const text=(v,max=500)=>{if(v===undefined||v===null)return '';if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))throw fail('Invalid text');return v.trim();};
const groupRadiusName=id=>`emsgrp_${id.replaceAll('-','')}`;
const DEFAULT_COLLECTION_NAME='Default NAS';
const DEFAULT_PROFILE_NAME='Default Read-Only';

async function radiusRuntime(path,body){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),2500);
 try{
  const r=await fetch('http://radius_ops:18120'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:c.signal});
  const data=await r.json().catch(()=>({ok:false}));
  if(!r.ok)throw fail(r.status===410?'Live RADIUS session expired':'RADIUS live monitor unavailable',r.status===410?410:503);
  return data;
 }catch(e){if(e?.status)throw e;throw fail('RADIUS live monitor unavailable',503);}
 finally{clearTimeout(timer);}
}
async function radiusDiagnostics(){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),2500);
 try{
  const r=await fetch('http://radius_ops:18120/diagnostics',{signal:c.signal});
  const data=await r.json().catch(()=>({ok:false}));
  if(!r.ok)throw fail('RADIUS diagnostics unavailable',503);
  return data;
 }catch(e){if(e?.status)throw e;throw fail('RADIUS diagnostics unavailable',503);}
 finally{clearTimeout(timer);}
}
async function enrichLiveEvents(pool,items){
 const candidates=[];
 for(let i=0;i<items.length&&candidates.length<200;i++){
  const e=items[i];
  if(e?.type!=='authentication'&&e?.type!=='accounting')continue;
  try{ip(e.sourceIp);}catch{continue;}
  candidates.push({i,u:String(e.username||''),s:e.sourceIp});
 }
 if(!candidates.length)return items;
 const r=await pool.query(`WITH input AS (
   SELECT (x->>'i')::int AS i,x->>'u' AS username,(x->>'s')::inet AS source_ip
   FROM jsonb_array_elements($1::jsonb) x
 )
 SELECT input.i,d.label AS "deviceLabel",a.collection_name AS "collectionName",g.name AS "profileName"
 FROM input
 LEFT JOIN LATERAL (
   SELECT label FROM radius_ops_devices
   WHERE enabled AND input.source_ip <<= nas_ip
   ORDER BY masklen(nas_ip) DESC,id LIMIT 1
 ) d ON true
 LEFT JOIN LATERAL radius_ops_resolve_access(input.username,input.source_ip) a ON true
 LEFT JOIN radius_ops_groups g ON g.id=a.profile_id`,[JSON.stringify(candidates)]);
 const meta=new Map(r.rows.map(x=>[x.i,x]));
 return items.map((e,i)=>meta.has(i)?{...e,...meta.get(i)}:e);
}

function accessRules(v){
 if(v===undefined)return undefined;
 if(!Array.isArray(v)||v.length>256)throw fail('Invalid access rules');
 const out=v.map(r=>({collectionId:uid(r?.collectionId),profileId:uid(r?.profileId)}));
 if(new Set(out.map(r=>r.collectionId)).size!==out.length)throw fail('Duplicate collection access rule');
 return out;
}
function collectionIds(v){
 if(v===undefined)return undefined;
 if(!Array.isArray(v)||v.length>256)throw fail('Invalid NAS collection selection');
 return [...new Set(v.map(uid))];
}
async function assertAccessNoConflict(c,accountId=null){
 const params=accountId?[accountId]:[];
 const where=accountId?'WHERE ar.account_id=$1':'';
 const r=await c.query(`SELECT ar.account_id,cd.device_id,d.label,d.nas_ip::text AS nas_ip
   FROM radius_ops_access_rules ar
   JOIN radius_ops_collection_devices cd ON cd.collection_id=ar.collection_id
   JOIN radius_ops_devices d ON d.id=cd.device_id
   ${where}
   GROUP BY ar.account_id,cd.device_id,d.label,d.nas_ip
   HAVING count(DISTINCT ar.profile_id)>1 LIMIT 1`,params);
 if(r.rowCount)throw fail(`Conflicting permission profiles for NAS ${r.rows[0].label} (${r.rows[0].nas_ip})`,409);
}
async function ensureRadiusDefaults(c,companyId=null){
 const params=companyId?[companyId]:[];
 const scope=companyId?' AND c.id=$1':'';
 await c.query(`INSERT INTO radius_ops_collections(id,company_id,name,description,enabled)
   SELECT (
    substr(md5('ems-radius-default-collection:'||c.id),1,8)||'-'||substr(md5('ems-radius-default-collection:'||c.id),9,4)||'-'||
    substr(md5('ems-radius-default-collection:'||c.id),13,4)||'-'||substr(md5('ems-radius-default-collection:'||c.id),17,4)||'-'||
    substr(md5('ems-radius-default-collection:'||c.id),21,12)
   )::uuid,c.id,$${params.length+1},'Default NAS group for first-time setup',true
   FROM companies c WHERE c.deleted_at IS NULL${scope}
   ON CONFLICT(company_id,name) DO NOTHING`,[...params,DEFAULT_COLLECTION_NAME]);
 await c.query(`INSERT INTO radius_ops_groups(id,company_id,name,description,cisco_privilege,mikrotik_group,enabled)
   SELECT (
    substr(md5('ems-radius-default-profile:'||c.id),1,8)||'-'||substr(md5('ems-radius-default-profile:'||c.id),9,4)||'-'||
    substr(md5('ems-radius-default-profile:'||c.id),13,4)||'-'||substr(md5('ems-radius-default-profile:'||c.id),17,4)||'-'||
    substr(md5('ems-radius-default-profile:'||c.id),21,12)
   )::uuid,c.id,$${params.length+1},'Safe default permission profile',1,'read',true
   FROM companies c WHERE c.deleted_at IS NULL${scope}
   ON CONFLICT(company_id,name) DO NOTHING`,[...params,DEFAULT_PROFILE_NAME]);
}
async function defaultCollectionId(c,companyId){
 await ensureRadiusDefaults(c,companyId);
 const row=(await c.query('SELECT id FROM radius_ops_collections WHERE company_id=$1 AND name=$2 AND enabled',[companyId,DEFAULT_COLLECTION_NAME])).rows[0];
 if(!row)throw fail('Default NAS collection is unavailable',409);
 return row.id;
}
async function syncDeviceCollections(c,deviceId,companyId,ids){
 if(ids===undefined)return;
 let selected=[...ids];
 if(!selected.length)selected=[await defaultCollectionId(c,companyId)];
 await c.query('DELETE FROM radius_ops_collection_devices WHERE device_id=$1',[deviceId]);
 for(const collectionId of selected){
  const ok=(await c.query('SELECT 1 FROM radius_ops_collections WHERE id=$1 AND company_id=$2 AND enabled',[collectionId,companyId])).rowCount;
  if(!ok)throw fail('NAS collection does not belong to this company or is disabled',409);
  await c.query('INSERT INTO radius_ops_collection_devices(id,collection_id,device_id) VALUES($1,$2,$3)',
    [crypto.randomUUID(),collectionId,deviceId]);
 }
 await assertAccessNoConflict(c);
}
async function syncAccessRules(c,accountId,companyId,rules){
 if(rules===undefined)return;
 await c.query('DELETE FROM radius_ops_access_rules WHERE account_id=$1',[accountId]);
 for(const r of rules){
  const check=(await c.query(`SELECT
    EXISTS(SELECT 1 FROM radius_ops_collections WHERE id=$1 AND company_id=$3) AS collection_ok,
    EXISTS(SELECT 1 FROM radius_ops_groups WHERE id=$2 AND company_id=$3) AS profile_ok`,
    [r.collectionId,r.profileId,companyId])).rows[0];
  if(!check?.collection_ok||!check?.profile_ok)throw fail('Access collection/profile does not belong to this company',409);
  await c.query('INSERT INTO radius_ops_access_rules(id,account_id,collection_id,profile_id,enabled) VALUES($1,$2,$3,$4,true)',
    [crypto.randomUUID(),accountId,r.collectionId,r.profileId]);
 }
 await assertAccessNoConflict(c,accountId);
}

async function ensureLegacyFullAccessRule(c,companyId,profileId){
 const g=(await c.query('SELECT id FROM radius_ops_groups WHERE id=$1 AND company_id=$2',[profileId,companyId])).rows[0];
 if(!g)throw fail('RADIUS group does not belong to this company',409);
 let col=(await c.query("SELECT id FROM radius_ops_collections WHERE company_id=$1 AND name='All registered NAS'",[companyId])).rows[0];
 if(!col){
  const collectionId=crypto.randomUUID();
  await c.query("INSERT INTO radius_ops_collections(id,company_id,name,description,enabled) VALUES($1,$2,'All registered NAS','Compatibility collection for migrated users',true) ON CONFLICT(company_id,name) DO NOTHING",[collectionId,companyId]);
  col=(await c.query("SELECT id FROM radius_ops_collections WHERE company_id=$1 AND name='All registered NAS'",[companyId])).rows[0];
 }
 const devices=(await c.query('SELECT id FROM radius_ops_devices WHERE company_id=$1',[companyId])).rows;
 for(const d of devices)await c.query('INSERT INTO radius_ops_collection_devices(id,collection_id,device_id) VALUES($1,$2,$3) ON CONFLICT(collection_id,device_id) DO NOTHING',[crypto.randomUUID(),col.id,d.id]);
 return [{collectionId:col.id,profileId}];
}

async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function checkCompany(c,id){if(!(await c.query('SELECT 1 FROM companies WHERE id=$1 AND deleted_at IS NULL',[id])).rowCount)throw fail('Company not found',404);}
async function checkNasDuplicate(c,source,id=null){const r=await c.query('SELECT id,label,nas_ip::text AS "nasIp" FROM radius_ops_devices WHERE nas_ip=$1::inet AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1',[source,id]);if(r.rowCount)throw fail(`NAS IP/CIDR is already registered by ${r.rows[0].label} (${r.rows[0].nasIp})`,409);}
async function secretProfile(c,id,companyId,requireEnabled=true){const p=(await c.query('SELECT * FROM radius_ops_secret_profiles WHERE id=$1',[id])).rows[0];if(!p||p.company_id!==companyId)throw fail('Secret profile does not belong to this company',409);if(requireEnabled&&!p.enabled)throw fail('Secret profile is disabled',409);return p;}
async function inlineSecretProfile(c,companyId,label,value){const id=crypto.randomUUID(),profileName=(String(label||'NAS').slice(0,92)+' Secret '+id.slice(0,8));await c.query('INSERT INTO radius_ops_secret_profiles(id,company_id,name,secret,enabled) VALUES($1,$2,$3,$4,true)',[id,companyId,profileName,secret(value)]);return id;}
async function nasSync(c,d){const short='ems_'+d.id.replaceAll('-','');await c.query('DELETE FROM nas WHERE shortname=$1',[short]);let value=d.secret;if(d.secret_profile_id){const p=(await c.query('SELECT secret FROM radius_ops_secret_profiles WHERE id=$1',[d.secret_profile_id])).rows[0];if(p?.secret)value=p.secret;}if(!value)throw fail('NAS shared secret is unavailable',409);/*
 Keep every registered NAS in the FreeRADIUS client radix tree, even while the
 EMS object/profile/inventory link is disabled. This preserves the most-specific
 client match and lets SQL policy return Access-Reject instead of falling
 through to a broader /0 secret. Deleting the NAS removes this shadow.
 */await c.query('INSERT INTO nas(nasname,shortname,type,secret,description) VALUES($1,$2,$3,$4,$5)',[d.nas_ip,short,'other',value,d.label]);}
async function resyncSecretProfile(c,id){const rows=(await c.query('SELECT * FROM radius_ops_devices WHERE secret_profile_id=$1',[id])).rows;for(const d of rows)await nasSync(c,d);}
async function replySync(c,username,items){await c.query('DELETE FROM radreply WHERE username=$1',[username]);for(const [a,v] of items)await c.query('INSERT INTO radreply(username,attribute,op,value) VALUES($1,$2,$3,$4)',[username,a,':=',v]);}
async function groupSync(c,g){
 const groupname=groupRadiusName(g.id);
 await c.query('DELETE FROM radgroupreply WHERE groupname=$1',[groupname]);
 if(g.enabled){
  await c.query('INSERT INTO radgroupreply(groupname,attribute,op,value) VALUES($1,$2,$3,$4)',[groupname,'Cisco-AVPair',':=',`shell:priv-lvl=${priv(g.cisco_privilege)}`]);
  await c.query('INSERT INTO radgroupreply(groupname,attribute,op,value) VALUES($1,$2,$3,$4)',[groupname,'Mikrotik-Group',':=',checkGroup(g.mikrotik_group)]);
 }
 const members=(await c.query('SELECT * FROM radius_ops_accounts WHERE group_id=$1',[g.id])).rows;
 for(const member of members)await accountSync(c,member,undefined);
}
async function accountSync(c,a,newPassword){
 if(newPassword!==undefined){await c.query("DELETE FROM radcheck WHERE username=$1 AND attribute='Cleartext-Password'",[a.username]);await c.query('INSERT INTO radcheck(username,attribute,op,value) VALUES($1,$2,$3,$4)',[a.username,'Cleartext-Password',':=',password(newPassword)]);}
 if(!(await c.query("SELECT 1 FROM radcheck WHERE username=$1 AND attribute='Cleartext-Password'",[a.username])).rowCount)throw fail('Password is required');
 await c.query("DELETE FROM radcheck WHERE username=$1 AND attribute='Auth-Type'",[a.username]);
 await c.query('DELETE FROM radusergroup WHERE username=$1',[a.username]);
 await c.query('DELETE FROM radreply WHERE username=$1',[a.username]);
 if(!a.enabled){await c.query('INSERT INTO radcheck(username,attribute,op,value) VALUES($1,$2,$3,$4)',[a.username,'Auth-Type',':=','Reject']);return;}
 if(a.group_id){
  const g=(await c.query('SELECT * FROM radius_ops_groups WHERE id=$1',[a.group_id])).rows[0];
  if(!g||g.company_id!==a.company_id)throw fail('RADIUS group does not belong to this company',409);
  if(!g.enabled){await c.query('INSERT INTO radcheck(username,attribute,op,value) VALUES($1,$2,$3,$4)',[a.username,'Auth-Type',':=','Reject']);return;}
  // v24 authorization is selected dynamically by NAS collection.  Keep the
  // legacy group reference only as migration metadata; never emit a static
  // per-user group reply that could override the per-NAS permission profile.
  return;
 }
 // Backward-compatible path for pre-v23 accounts that had direct vendor attributes.
 await replySync(c,a.username,replies(a));
}
async function macClear(c,id){const rows=(await c.query('SELECT alias FROM radius_ops_mac_aliases WHERE mac_id=$1',[id])).rows;for(const r of rows){await c.query('DELETE FROM radcheck WHERE username=$1',[r.alias]);await c.query('DELETE FROM radreply WHERE username=$1',[r.alias]);}await c.query('DELETE FROM radius_ops_mac_aliases WHERE mac_id=$1',[id]);}
async function macSync(c,m){await macClear(c,m.id);if(!m.enabled)return;for(const alias of aliases(m.mac)){
 if((await c.query('SELECT 1 FROM radius_ops_accounts WHERE username=$1',[alias])).rowCount)throw fail('MAC alias conflicts with an account',409);
 await c.query('INSERT INTO radius_ops_mac_aliases(alias,mac_id) VALUES($1,$2)',[alias,m.id]);
 await c.query('INSERT INTO radcheck(username,attribute,op,value) VALUES($1,$2,$3,$4)',[alias,'Cleartext-Password',':=',alias]);
 await replySync(c,alias,m.vlan===null?[]:replies({vlan:m.vlan}));
}}
function fields(b,kind){
 if(kind==='devices')return {label:name(b.label),vendor:b.vendor===undefined?null:checkVendor(b.vendor),nasIp:nasSource(b.nasIp),companyId:b.companyId?key(b.companyId):null,hostId:b.hostId?key(b.hostId):null,enabled:active(b.enabled),secret:b.secret?secret(b.secret):null,secretProfileId:b.secretProfileId?uid(b.secretProfileId):null,collectionIds:collectionIds(b.collectionIds)};
 if(kind==='accounts')return {label:name(b.label||b.username),companyId:key(b.companyId),groupId:b.groupId?uid(b.groupId):null,vendor:checkAccountVendor(b.vendor||'generic'),privilege:priv(b.privilege??1),mikrotikGroup:checkGroup(b.mikrotikGroup||'read'),enabled:active(b.enabled),password:b.password?password(b.password):null,accessRules:accessRules(b.accessRules)};
 if(kind==='groups')return {name:name(b.name),description:text(b.description,500),companyId:key(b.companyId),ciscoPrivilege:priv(b.ciscoPrivilege),mikrotikGroup:checkGroup(b.mikrotikGroup||'read'),enabled:active(b.enabled)};
 if(kind==='collections')return {name:name(b.name),description:text(b.description,500),companyId:key(b.companyId),enabled:active(b.enabled)};
 if(kind==='secret-profiles')return {name:name(b.name),companyId:key(b.companyId),secret:b.secret?secret(b.secret):null,enabled:active(b.enabled)};
 return {label:name(b.label),mac:mac(b.mac),companyId:key(b.companyId),vlan:vid(b.vlan),enabled:active(b.enabled)};
}

export function createModule(ctx){const {pool,json,readBody,requireAdmin,requireModuleAccess,audit}=ctx;return {
 match:(_req,url)=>url.pathname===base||url.pathname.startsWith(base+'/'),
 async handle(req,res,url,actor){await requireModuleAccess(actor,'radius-ops');requireAdmin(actor);const p=url.pathname,m=req.method;
  if(m==='GET'&&p===base+'/health'){
   try{const c=new AbortController(),timer=setTimeout(()=>c.abort(),2000);try{const r=await fetch('http://radius_ops:18120/health',{signal:c.signal});return json(res,200,{ok:true,running:r.ok,eap:false});}finally{clearTimeout(timer);}}catch{return json(res,200,{ok:true,running:false,eap:false});}
  }
  if(m==='POST'&&p===base+'/precheck'){
   const body=await readBody(req),identity=String(body.identity??'');
   if(!/^[A-Za-z0-9_.:@-]{1,64}$/.test(identity))throw fail('Invalid RADIUS identity');
   const nasIp=ip(body.nasIp);
   const result=await pool.query(`WITH selected AS (
       SELECT * FROM radius_ops_resolve_nas($2::inet)
     )
     SELECT
       EXISTS(SELECT 1 FROM selected) AS "nasRegistered",
       COALESCE((SELECT active FROM selected LIMIT 1),false) AS "nasActive",
       EXISTS(SELECT 1 FROM radcheck WHERE username=$1 AND attribute='Cleartext-Password') AS "credentialsReady",
       radius_ops_identity_allowed($1,$2::inet) AS "policyAllowed"`,[identity,nasIp]);
   const r=result.rows[0],allowed=Boolean(r.nasRegistered&&r.nasActive&&r.credentialsReady&&r.policyAllowed);
   const reason=!r.nasRegistered?'nas-not-registered':!r.nasActive?'nas-disabled-or-inventory-denied':!r.credentialsReady?'identity-not-provisioned':!r.policyAllowed?'tenant-or-policy-denied':'ready';
   return json(res,200,{ok:true,allowed,reason,nasRegistered:Boolean(r.nasRegistered),nasActive:Boolean(r.nasActive),credentialsReady:Boolean(r.credentialsReady),policyAllowed:Boolean(r.policyAllowed),scope:'sql-policy-only',udpTested:false});
  }
  if(m==='GET'&&p===base+'/diagnostics'){res.setHeader('Cache-Control','no-store');const d=await radiusDiagnostics();const counts=(await pool.query(`SELECT
   (SELECT count(*)::int FROM radius_ops_devices WHERE enabled) AS "enabledNas",
   (SELECT count(*)::int FROM radius_ops_accounts WHERE enabled) AS "enabledUsers",
   (SELECT count(*)::int FROM radius_ops_collections WHERE enabled) AS "enabledCollections",
   (SELECT count(*)::int FROM radius_ops_groups WHERE enabled) AS "enabledProfiles"`)).rows[0];return json(res,200,{ok:true,...d,...counts});}
  if(m==='POST'&&p===base+'/live/start'){res.setHeader('Cache-Control','no-store');const r=await radiusRuntime('/live/start',{});await audit?.(actor,'start','radius-ops-live','live',{detail:{volatile:true}});return json(res,200,r);}
  if(m==='POST'&&p===base+'/live/events'){res.setHeader('Cache-Control','no-store');const b=await readBody(req),token=key(b.token),after=Number(b.after??0);if(!Number.isSafeInteger(after)||after<0)throw fail('Invalid live sequence');const r=await radiusRuntime('/live/events',{token,after});r.items=await enrichLiveEvents(pool,r.items||[]);return json(res,200,r);}
  if(m==='POST'&&p===base+'/live/stop'){res.setHeader('Cache-Control','no-store');const b=await readBody(req),token=key(b.token);const r=await radiusRuntime('/live/stop',{token});await audit?.(actor,'stop','radius-ops-live','live',{detail:{volatile:true}});return json(res,200,r);}
  if(m==='GET'&&p===base+'/overview'){
   const [d,g,a,macs,events]=await Promise.all([
    pool.query('SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int active FROM radius_ops_devices'),
    pool.query('SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int active FROM radius_ops_groups'),
    pool.query('SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int active FROM radius_ops_accounts'),
    pool.query('SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int active FROM radius_ops_macs'),
    pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE reply='Access-Accept')::int accepted FROM radpostauth WHERE authdate>now()-interval '24 hours'"),
   ]);
   return json(res,200,{ok:true,devices:d.rows[0],groups:g.rows[0],accounts:a.rows[0],macs:macs.rows[0],events:events.rows[0]});
  }
  if(m==='GET'&&p===base+'/inventory'){const r=await pool.query(`SELECT h.id,h.name,h.ip,h.type AS vendor,s.company_id AS "companyId",c.name AS "companyName" FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id WHERE h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.name,h.name LIMIT 3000`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/devices'){const r=await pool.query(`SELECT d.id,d.host_id AS "hostId",d.company_id AS "companyId",CASE WHEN masklen(d.nas_ip)=32 THEN host(d.nas_ip) ELSE d.nas_ip::text END AS "nasIp",d.label,d.vendor,d.enabled,d.secret_profile_id AS "secretProfileId",p.name AS "secretProfileName",h.name AS "hostName",c.name AS "companyName",COALESCE((SELECT json_agg(cd.collection_id ORDER BY col.name) FROM radius_ops_collection_devices cd JOIN radius_ops_collections col ON col.id=cd.collection_id WHERE cd.device_id=d.id),'[]'::json) AS "collectionIds",COALESCE((SELECT json_agg(col.name ORDER BY col.name) FROM radius_ops_collection_devices cd JOIN radius_ops_collections col ON col.id=cd.collection_id WHERE cd.device_id=d.id),'[]'::json) AS "collectionNames" FROM radius_ops_devices d LEFT JOIN radius_ops_secret_profiles p ON p.id=d.secret_profile_id LEFT JOIN hosts h ON h.id=d.host_id JOIN companies c ON c.id=d.company_id ORDER BY d.label`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/secret-profiles'){const r=await pool.query(`SELECT p.id,p.company_id AS "companyId",c.name AS "companyName",p.name,p.enabled,count(d.id)::int AS "assignedDevices",true AS "hasSecret" FROM radius_ops_secret_profiles p JOIN companies c ON c.id=p.company_id LEFT JOIN radius_ops_devices d ON d.secret_profile_id=p.id GROUP BY p.id,c.name ORDER BY c.name,p.name`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/groups'){await ensureRadiusDefaults(pool);const r=await pool.query(`SELECT g.id,g.company_id AS "companyId",c.name AS "companyName",g.name,g.description,g.cisco_privilege AS "ciscoPrivilege",g.mikrotik_group AS "mikrotikGroup",g.enabled,(g.name=$1) AS "isDefault",count(DISTINCT ar.account_id)::int AS members FROM radius_ops_groups g JOIN companies c ON c.id=g.company_id LEFT JOIN radius_ops_access_rules ar ON ar.profile_id=g.id GROUP BY g.id,c.name ORDER BY c.name,(g.name=$1) DESC,g.name`,[DEFAULT_PROFILE_NAME]);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/collections'){await ensureRadiusDefaults(pool);const r=await pool.query(`SELECT col.id,col.company_id AS "companyId",c.name AS "companyName",col.name,col.description,col.enabled,(col.name=$1) AS "isDefault",COALESCE(json_agg(json_build_object('id',d.id,'label',d.label,'nasIp',CASE WHEN masklen(d.nas_ip)=32 THEN host(d.nas_ip) ELSE d.nas_ip::text END) ORDER BY d.label) FILTER(WHERE d.id IS NOT NULL),'[]'::json) AS members,count(DISTINCT ar.account_id)::int AS "assignedUsers" FROM radius_ops_collections col JOIN companies c ON c.id=col.company_id LEFT JOIN radius_ops_collection_devices cd ON cd.collection_id=col.id LEFT JOIN radius_ops_devices d ON d.id=cd.device_id LEFT JOIN radius_ops_access_rules ar ON ar.collection_id=col.id GROUP BY col.id,c.name ORDER BY c.name,(col.name=$1) DESC,col.name`,[DEFAULT_COLLECTION_NAME]);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/accounts'){const r=await pool.query(`SELECT a.id,a.username,a.label,a.enabled,a.company_id AS "companyId",c.name AS "companyName",a.group_id AS "groupId",legacy.name AS "groupName",legacy.cisco_privilege AS "ciscoPrivilege",legacy.mikrotik_group AS "mikrotikGroup",COALESCE(json_agg(json_build_object('collectionId',ar.collection_id,'profileId',ar.profile_id,'collectionName',col.name,'profileName',g.name) ORDER BY col.name) FILTER(WHERE ar.id IS NOT NULL),'[]'::json) AS "accessRules" FROM radius_ops_accounts a JOIN companies c ON c.id=a.company_id LEFT JOIN radius_ops_groups legacy ON legacy.id=a.group_id LEFT JOIN radius_ops_access_rules ar ON ar.account_id=a.id LEFT JOIN radius_ops_collections col ON col.id=ar.collection_id LEFT JOIN radius_ops_groups g ON g.id=ar.profile_id GROUP BY a.id,c.name,legacy.id ORDER BY c.name,a.username`);return json(res,200,{ok:true,items:r.rows});}
  {
   const hit=p.match(/^\/api\/radius-ops\/secret-profiles\/([^/]+)\/reveal$/);
   if(m==='POST'&&hit){
    const id=uid(hit[1]),row=(await pool.query('SELECT id,name,secret FROM radius_ops_secret_profiles WHERE id=$1',[id])).rows[0];
    if(!row)throw fail('Secret profile not found',404);
    res.setHeader('Cache-Control','no-store, private, max-age=0');res.setHeader('Pragma','no-cache');
    await audit?.(actor,'reveal','radius-secret-profile',id,{detail:{name:row.name}});
    return json(res,200,{ok:true,id:row.id,name:row.name,value:row.secret});
   }
  }
  {
   const hit=p.match(/^\/api\/radius-ops\/accounts\/([^/]+)\/reveal-password$/);
   if(m==='POST'&&hit){
    const id=uid(hit[1]),row=(await pool.query(`SELECT a.id,a.username,rc.value AS password
      FROM radius_ops_accounts a
      LEFT JOIN LATERAL (
       SELECT value FROM radcheck
       WHERE username=a.username AND attribute='Cleartext-Password'
       ORDER BY id DESC LIMIT 1
      ) rc ON true
      WHERE a.id=$1`,[id])).rows[0];
    if(!row)throw fail('RADIUS user not found',404);
    if(!row.password)throw fail('RADIUS password is unavailable',404);
    res.setHeader('Cache-Control','no-store, private, max-age=0');res.setHeader('Pragma','no-cache');
    await audit?.(actor,'reveal','radius-user-password',id,{detail:{username:row.username}});
    return json(res,200,{ok:true,id:row.id,name:row.username,value:row.password});
   }
  }
  if(m==='GET'&&p===base+'/macs'){const r=await pool.query(`SELECT m.id,m.company_id AS "companyId",c.name AS "companyName",m.mac::text,m.label,m.vlan,m.enabled FROM radius_ops_macs m JOIN companies c ON c.id=m.company_id ORDER BY m.label`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/events'){const [e,a]=await Promise.all([pool.query(`SELECT p.id,p.username,p.reply,p.authdate AS "at",p.sourceipaddress AS "sourceIp", d.label AS "deviceLabel", c.name AS "companyName" FROM radpostauth p LEFT JOIN radius_ops_devices d ON p.sourceipaddress::inet <<= d.nas_ip LEFT JOIN companies c ON c.id=d.company_id ORDER BY p.id DESC LIMIT 100`),pool.query('SELECT username,nasipaddress,acctstarttime AS "startedAt",acctstoptime AS "stoppedAt" FROM radacct ORDER BY radacctid DESC LIMIT 50')]);return json(res,200,{ok:true,items:e.rows,sessions:a.rows});}
  if(m==='POST'&&p===base+'/config'){const b=await readBody(req),id=uid(b.id),vendor=checkVendor(b.vendor),r=(await pool.query('SELECT d.nas_ip::text AS "nasIp",COALESCE(p.secret,d.secret) AS secret FROM radius_ops_devices d LEFT JOIN radius_ops_secret_profiles p ON p.id=d.secret_profile_id WHERE d.id=$1',[id])).rows[0];if(!r)throw fail('NAS not found',404);return json(res,200,{ok:true,text:cli({...r,vendor},b.radiusIp,b.mode||'admin',b.port||'GigabitEthernet0/1')});}

  const match=p.match(/^\/api\/radius-ops\/(devices|groups|collections|secret-profiles|accounts|macs)(?:\/([^/]+))?$/);
  if(!match||!['POST','PUT','DELETE'].includes(m))throw fail('Unknown RADIUS endpoint',404);
  const kind=match[1],id=match[2]?uid(match[2]):crypto.randomUUID();
  if((m==='POST'&&match[2])||(m!=='POST'&&!match[2]))throw fail('Invalid method/path',404);
  const b=m==='DELETE'?null:await readBody(req),f=b?fields(b,kind):null;

  await transaction(pool,async c=>{
   if(kind==='secret-profiles'){
    if(m==='POST'){await checkCompany(c,f.companyId);if(!f.secret)throw fail('Shared secret is required');await c.query('INSERT INTO radius_ops_secret_profiles(id,company_id,name,secret,enabled) VALUES($1,$2,$3,$4,$5)',[id,f.companyId,f.name,f.secret,f.enabled]);}
    else{const old=(await c.query('SELECT * FROM radius_ops_secret_profiles WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('Secret profile not found',404);
     if(m==='DELETE'){if((await c.query('SELECT 1 FROM radius_ops_devices WHERE secret_profile_id=$1 LIMIT 1',[id])).rowCount)throw fail('Secret profile is assigned to a NAS',409);await c.query('DELETE FROM radius_ops_secret_profiles WHERE id=$1',[id]);}
     else{await checkCompany(c,f.companyId);if(f.companyId!==old.company_id&&(await c.query('SELECT 1 FROM radius_ops_devices WHERE secret_profile_id=$1 LIMIT 1',[id])).rowCount)throw fail('Cannot move an assigned secret profile to another company',409);const value=f.secret||old.secret;await c.query('UPDATE radius_ops_secret_profiles SET company_id=$2,name=$3,secret=$4,enabled=$5,updated_at=now() WHERE id=$1',[id,f.companyId,f.name,value,f.enabled]);await c.query('UPDATE radius_ops_devices SET secret=$2 WHERE secret_profile_id=$1',[id,value]);await resyncSecretProfile(c,id);}
    }
   }else if(kind==='devices'){
    if(m==='POST'){
     let companyId=f.companyId,hostId=f.hostId;
     if(hostId){const r=(await c.query(`SELECT h.id,s.company_id AS "companyId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE OF h`,[hostId])).rows[0];if(!r)throw fail('Inventory host not found',404);if(companyId&&companyId!==r.companyId)throw fail('Inventory host belongs to another company',409);companyId=r.companyId;}
     if(!companyId)throw fail('Company is required');await checkCompany(c,companyId);await ensureRadiusDefaults(c,companyId);await checkNasDuplicate(c,f.nasIp);let profileId=f.secretProfileId;if(!profileId){if(!f.secret)throw fail('Secret profile is required');profileId=await inlineSecretProfile(c,companyId,f.label,f.secret);}const p=await secretProfile(c,profileId,companyId);const d=(await c.query('INSERT INTO radius_ops_devices(id,host_id,company_id,nas_ip,label,vendor,secret,secret_profile_id,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,hostId,companyId,f.nasIp,f.label,f.vendor||'other',p.secret,profileId,f.enabled])).rows[0];await syncDeviceCollections(c,id,companyId,f.collectionIds||[]);await nasSync(c,d);
    }else{const old=(await c.query('SELECT * FROM radius_ops_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('NAS not found',404);
     if(m==='DELETE'){await c.query('DELETE FROM nas WHERE shortname=$1',['ems_'+id.replaceAll('-','')]);await c.query('DELETE FROM radius_ops_devices WHERE id=$1',[id]);}
     else{let companyId=f.companyId||old.company_id,hostId=Object.prototype.hasOwnProperty.call(b,'hostId')?f.hostId:old.host_id;if(hostId){const r=(await c.query(`SELECT h.id,s.company_id AS "companyId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,[hostId])).rows[0];if(!r)throw fail('Inventory host not found',404);if(companyId!==r.companyId)throw fail('Inventory host belongs to another company',409);}await checkCompany(c,companyId);await ensureRadiusDefaults(c,companyId);await checkNasDuplicate(c,f.nasIp,id);let profileId=f.secretProfileId||old.secret_profile_id;if(f.secret)profileId=await inlineSecretProfile(c,companyId,f.label,f.secret);const p=await secretProfile(c,profileId,companyId);const d=(await c.query('UPDATE radius_ops_devices SET host_id=$2,company_id=$3,nas_ip=$4,label=$5,vendor=$6,secret=$7,secret_profile_id=$8,enabled=$9 WHERE id=$1 RETURNING *',[id,hostId,companyId,f.nasIp,f.label,f.vendor||old.vendor,p.secret,profileId,f.enabled])).rows[0];await syncDeviceCollections(c,id,companyId,f.collectionIds);await nasSync(c,d);}
    }
   }else if(kind==='groups'){
    if(m==='POST'){await checkCompany(c,f.companyId);const g=(await c.query('INSERT INTO radius_ops_groups(id,company_id,name,description,cisco_privilege,mikrotik_group,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,f.companyId,f.name,f.description,f.ciscoPrivilege,f.mikrotikGroup,f.enabled])).rows[0];await groupSync(c,g);}
    else{const old=(await c.query('SELECT * FROM radius_ops_groups WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('RADIUS group not found',404);
     if(m==='DELETE'){const members=(await c.query('SELECT count(*)::int n FROM radius_ops_accounts WHERE group_id=$1',[id])).rows[0].n;const assigned=(await c.query('SELECT count(*)::int n FROM radius_ops_access_rules WHERE profile_id=$1',[id])).rows[0].n;if(members||assigned)throw fail('Move or delete users using this permission profile first',409);await c.query('DELETE FROM radgroupreply WHERE groupname=$1',[groupRadiusName(id)]);await c.query('DELETE FROM radius_ops_groups WHERE id=$1',[id]);}
     else{await checkCompany(c,f.companyId);const g=(await c.query('UPDATE radius_ops_groups SET company_id=$2,name=$3,description=$4,cisco_privilege=$5,mikrotik_group=$6,enabled=$7,updated_at=now() WHERE id=$1 RETURNING *',[id,f.companyId,f.name,f.description,f.ciscoPrivilege,f.mikrotikGroup,f.enabled])).rows[0];await groupSync(c,g);}
    }
   }else if(kind==='collections'){
    if(m==='POST'){
     await checkCompany(c,f.companyId);
     await c.query('INSERT INTO radius_ops_collections(id,company_id,name,description,enabled) VALUES($1,$2,$3,$4,$5)',[id,f.companyId,f.name,f.description,f.enabled]);
    }else{
     const old=(await c.query('SELECT * FROM radius_ops_collections WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('NAS collection not found',404);
     if(m==='DELETE'){
      if((await c.query('SELECT 1 FROM radius_ops_access_rules WHERE collection_id=$1 LIMIT 1',[id])).rowCount)throw fail('Remove user access rules for this collection first',409);
      await c.query('DELETE FROM radius_ops_collections WHERE id=$1',[id]);
     }else{
      await checkCompany(c,f.companyId);
      if(f.companyId!==old.company_id&&(await c.query('SELECT 1 FROM radius_ops_collection_devices WHERE collection_id=$1 LIMIT 1',[id])).rowCount)throw fail('Remove NAS members before moving this collection to another company',409);
      if(f.companyId!==old.company_id&&(await c.query('SELECT 1 FROM radius_ops_access_rules WHERE collection_id=$1 LIMIT 1',[id])).rowCount)throw fail('Cannot move an assigned collection to another company',409);
      await c.query('UPDATE radius_ops_collections SET company_id=$2,name=$3,description=$4,enabled=$5,updated_at=now() WHERE id=$1',[id,f.companyId,f.name,f.description,f.enabled]);
      await assertAccessNoConflict(c);
     }
    }
   }else if(kind==='accounts'){
    if(m==='POST'){const username=user(b.username);await checkCompany(c,f.companyId);await ensureRadiusDefaults(c,f.companyId);if((await c.query('SELECT 1 FROM radius_ops_mac_aliases WHERE alias=$1',[username])).rowCount)throw fail('Username belongs to MAC',409);if(!f.password)throw fail('Password required');const rules=f.accessRules===undefined&&f.groupId?await ensureLegacyFullAccessRule(c,f.companyId,f.groupId):(f.accessRules||[]);const a=(await c.query('INSERT INTO radius_ops_accounts(id,company_id,username,label,vendor,privilege,mikrotik_group,group_id,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,f.companyId,username,f.label,f.vendor,f.privilege,f.mikrotikGroup,f.accessRules===undefined?f.groupId:null,f.enabled])).rows[0];await syncAccessRules(c,id,f.companyId,rules);await accountSync(c,a,f.password);}
    else{const old=(await c.query('SELECT * FROM radius_ops_accounts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('Account not found',404);
     if(m==='DELETE'){await c.query('DELETE FROM radcheck WHERE username=$1',[old.username]);await c.query('DELETE FROM radreply WHERE username=$1',[old.username]);await c.query('DELETE FROM radusergroup WHERE username=$1',[old.username]);await c.query('DELETE FROM radius_ops_accounts WHERE id=$1',[id]);}
     else{await checkCompany(c,f.companyId);await ensureRadiusDefaults(c,f.companyId);let rules=f.accessRules;if(rules===undefined&&f.groupId)rules=await ensureLegacyFullAccessRule(c,f.companyId,f.groupId);if(f.companyId!==old.company_id&&(await c.query('SELECT 1 FROM radius_ops_access_rules WHERE account_id=$1 LIMIT 1',[id])).rowCount&&rules===undefined)throw fail('Access rules are required when moving a user to another company',409);const a=(await c.query('UPDATE radius_ops_accounts SET company_id=$2,label=$3,vendor=$4,privilege=$5,mikrotik_group=$6,group_id=$7,enabled=$8 WHERE id=$1 RETURNING *',[id,f.companyId,f.label,f.vendor,f.privilege,f.mikrotikGroup,f.accessRules===undefined?f.groupId:null,f.enabled])).rows[0];await syncAccessRules(c,id,f.companyId,rules);await accountSync(c,a,f.password??undefined);}
    }
   }else{
    if(m==='POST'){await checkCompany(c,f.companyId);const x=(await c.query('INSERT INTO radius_ops_macs(id,company_id,mac,label,vlan,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,f.companyId,f.mac,f.label,f.vlan,f.enabled])).rows[0];await macSync(c,x);}
    else{const old=(await c.query('SELECT * FROM radius_ops_macs WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('MAC not found',404);await macClear(c,id);
     if(m==='DELETE')await c.query('DELETE FROM radius_ops_macs WHERE id=$1',[id]);
     else{await checkCompany(c,f.companyId);const x=(await c.query('UPDATE radius_ops_macs SET company_id=$2,mac=$3,label=$4,vlan=$5,enabled=$6 WHERE id=$1 RETURNING *',[id,f.companyId,f.mac,f.label,f.vlan,f.enabled])).rows[0];await macSync(c,x);}
    }
   }
  });
  await audit?.(actor,m.toLowerCase(),'radius-ops-'+kind,id,{detail:{operation:m}});
  return json(res,m==='POST'?201:200,{ok:true,id});
 }
};}
