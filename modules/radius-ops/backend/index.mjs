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

async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function checkCompany(c,id){if(!(await c.query('SELECT 1 FROM companies WHERE id=$1 AND deleted_at IS NULL',[id])).rowCount)throw fail('Company not found',404);}
async function checkNasOverlap(c,source,id=null){const r=await c.query('SELECT id,label,nas_ip::text AS "nasIp" FROM radius_ops_devices WHERE nas_ip && $1::inet AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1',[source,id]);if(r.rowCount)throw fail(`NAS IP/CIDR overlaps with ${r.rows[0].label} (${r.rows[0].nasIp})`,409);}
async function nasSync(c,d){const short='ems_'+d.id.replaceAll('-','');await c.query('DELETE FROM nas WHERE shortname=$1',[short]);if(d.enabled)await c.query('INSERT INTO nas(nasname,shortname,type,secret,description) VALUES($1,$2,$3,$4,$5)',[d.nas_ip,short,'other',d.secret,d.label]);}
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
  await c.query('INSERT INTO radusergroup(username,groupname,priority) VALUES($1,$2,1)',[a.username,groupRadiusName(g.id)]);
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
 if(kind==='devices')return {label:name(b.label),vendor:b.vendor===undefined?null:checkVendor(b.vendor),nasIp:nasSource(b.nasIp),companyId:b.companyId?key(b.companyId):null,hostId:b.hostId?key(b.hostId):null,enabled:active(b.enabled),secret:b.secret?secret(b.secret):null};
 if(kind==='accounts')return {label:name(b.label||b.username),companyId:key(b.companyId),groupId:b.groupId?uid(b.groupId):null,vendor:checkAccountVendor(b.vendor||'generic'),privilege:priv(b.privilege??1),mikrotikGroup:checkGroup(b.mikrotikGroup||'read'),enabled:active(b.enabled),password:b.password?password(b.password):null};
 if(kind==='groups')return {name:name(b.name),description:text(b.description,500),companyId:key(b.companyId),ciscoPrivilege:priv(b.ciscoPrivilege),mikrotikGroup:checkGroup(b.mikrotikGroup||'read'),enabled:active(b.enabled)};
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
   const result=await pool.query(`SELECT
     EXISTS(SELECT 1 FROM radius_ops_devices d WHERE d.enabled AND $2::inet <<= d.nas_ip) AS "nasRegistered",
     EXISTS(SELECT 1 FROM radcheck WHERE username=$1 AND attribute='Cleartext-Password') AS "credentialsReady",
     radius_ops_identity_allowed($1,$2::inet) AS "policyAllowed"`,[identity,nasIp]);
   const r=result.rows[0],allowed=Boolean(r.nasRegistered&&r.credentialsReady&&r.policyAllowed);
   const reason=!r.nasRegistered?'nas-not-registered':!r.credentialsReady?'identity-not-provisioned':!r.policyAllowed?'tenant-or-inventory-denied':'ready';
   return json(res,200,{ok:true,allowed,reason,nasRegistered:Boolean(r.nasRegistered),credentialsReady:Boolean(r.credentialsReady),policyAllowed:Boolean(r.policyAllowed),scope:'sql-policy-only',udpTested:false});
  }
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
  if(m==='GET'&&p===base+'/devices'){const r=await pool.query(`SELECT d.id,d.host_id AS "hostId",d.company_id AS "companyId",CASE WHEN masklen(d.nas_ip)=32 THEN host(d.nas_ip) ELSE d.nas_ip::text END AS "nasIp",d.label,d.vendor,d.enabled,h.name AS "hostName",c.name AS "companyName" FROM radius_ops_devices d LEFT JOIN hosts h ON h.id=d.host_id JOIN companies c ON c.id=d.company_id ORDER BY d.label`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/groups'){const r=await pool.query(`SELECT g.id,g.company_id AS "companyId",c.name AS "companyName",g.name,g.description,g.cisco_privilege AS "ciscoPrivilege",g.mikrotik_group AS "mikrotikGroup",g.enabled,count(a.id)::int AS members FROM radius_ops_groups g JOIN companies c ON c.id=g.company_id LEFT JOIN radius_ops_accounts a ON a.group_id=g.id GROUP BY g.id,c.name ORDER BY c.name,g.name`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/accounts'){const r=await pool.query(`SELECT a.id,a.username,a.label,a.enabled,a.company_id AS "companyId",c.name AS "companyName",a.group_id AS "groupId",g.name AS "groupName",g.cisco_privilege AS "ciscoPrivilege",g.mikrotik_group AS "mikrotikGroup" FROM radius_ops_accounts a JOIN companies c ON c.id=a.company_id LEFT JOIN radius_ops_groups g ON g.id=a.group_id ORDER BY c.name,a.username`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/macs'){const r=await pool.query(`SELECT m.id,m.company_id AS "companyId",c.name AS "companyName",m.mac::text,m.label,m.vlan,m.enabled FROM radius_ops_macs m JOIN companies c ON c.id=m.company_id ORDER BY m.label`);return json(res,200,{ok:true,items:r.rows});}
  if(m==='GET'&&p===base+'/events'){const [e,a]=await Promise.all([pool.query(`SELECT p.id,p.username,p.reply,p.authdate AS "at",p.sourceipaddress AS "sourceIp", d.label AS "deviceLabel", c.name AS "companyName" FROM radpostauth p LEFT JOIN radius_ops_devices d ON p.sourceipaddress::inet <<= d.nas_ip LEFT JOIN companies c ON c.id=d.company_id ORDER BY p.id DESC LIMIT 100`),pool.query('SELECT username,nasipaddress,acctstarttime AS "startedAt",acctstoptime AS "stoppedAt" FROM radacct ORDER BY radacctid DESC LIMIT 50')]);return json(res,200,{ok:true,items:e.rows,sessions:a.rows});}
  if(m==='POST'&&p===base+'/config'){const b=await readBody(req),id=uid(b.id),vendor=checkVendor(b.vendor),r=(await pool.query('SELECT nas_ip::text AS "nasIp",secret FROM radius_ops_devices WHERE id=$1',[id])).rows[0];if(!r)throw fail('NAS not found',404);return json(res,200,{ok:true,text:cli({...r,vendor},b.radiusIp,b.mode||'admin',b.port||'GigabitEthernet0/1')});}

  const match=p.match(/^\/api\/radius-ops\/(devices|groups|accounts|macs)(?:\/([^/]+))?$/);
  if(!match||!['POST','PUT','DELETE'].includes(m))throw fail('Unknown RADIUS endpoint',404);
  const kind=match[1],id=match[2]?uid(match[2]):crypto.randomUUID();
  if((m==='POST'&&match[2])||(m!=='POST'&&!match[2]))throw fail('Invalid method/path',404);
  const b=m==='DELETE'?null:await readBody(req),f=b?fields(b,kind):null;

  await transaction(pool,async c=>{
   if(kind==='devices'){
    if(m==='POST'){
     let companyId=f.companyId,hostId=f.hostId;
     if(hostId){const r=(await c.query(`SELECT h.id,s.company_id AS "companyId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE OF h`,[hostId])).rows[0];if(!r)throw fail('Inventory host not found',404);if(companyId&&companyId!==r.companyId)throw fail('Inventory host belongs to another company',409);companyId=r.companyId;}
     if(!companyId)throw fail('Company is required');await checkCompany(c,companyId);if(!f.secret)throw fail('NAS secret required');await checkNasOverlap(c,f.nasIp);
     const d=(await c.query('INSERT INTO radius_ops_devices(id,host_id,company_id,nas_ip,label,vendor,secret,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,nas_ip::text,label,secret,enabled',[id,hostId,companyId,f.nasIp,f.label,f.vendor||'other',f.secret,f.enabled])).rows[0];await nasSync(c,d);
    }else{const old=(await c.query('SELECT * FROM radius_ops_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('NAS not found',404);
     if(m==='DELETE'){await c.query('DELETE FROM nas WHERE shortname=$1',['ems_'+id.replaceAll('-','')]);await c.query('DELETE FROM radius_ops_devices WHERE id=$1',[id]);}
     else{let companyId=f.companyId||old.company_id,hostId=Object.prototype.hasOwnProperty.call(b,'hostId')?f.hostId:old.host_id;if(hostId){const r=(await c.query(`SELECT h.id,s.company_id AS "companyId" FROM hosts h JOIN address_spaces s ON s.id=h.space_id JOIN companies c ON c.id=s.company_id WHERE h.id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL`,[hostId])).rows[0];if(!r)throw fail('Inventory host not found',404);if(companyId!==r.companyId)throw fail('Inventory host belongs to another company',409);}await checkCompany(c,companyId);await checkNasOverlap(c,f.nasIp,id);
      const d=(await c.query('UPDATE radius_ops_devices SET host_id=$2,company_id=$3,nas_ip=$4,label=$5,vendor=$6,secret=$7,enabled=$8 WHERE id=$1 RETURNING id,nas_ip::text,label,secret,enabled',[id,hostId,companyId,f.nasIp,f.label,f.vendor||old.vendor,f.secret||old.secret,f.enabled])).rows[0];await nasSync(c,d);}
    }
   }else if(kind==='groups'){
    if(m==='POST'){await checkCompany(c,f.companyId);const g=(await c.query('INSERT INTO radius_ops_groups(id,company_id,name,description,cisco_privilege,mikrotik_group,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,f.companyId,f.name,f.description,f.ciscoPrivilege,f.mikrotikGroup,f.enabled])).rows[0];await groupSync(c,g);}
    else{const old=(await c.query('SELECT * FROM radius_ops_groups WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('RADIUS group not found',404);
     if(m==='DELETE'){const members=(await c.query('SELECT count(*)::int n FROM radius_ops_accounts WHERE group_id=$1',[id])).rows[0].n;if(members)throw fail('Move or delete users in this group first',409);await c.query('DELETE FROM radgroupreply WHERE groupname=$1',[groupRadiusName(id)]);await c.query('DELETE FROM radius_ops_groups WHERE id=$1',[id]);}
     else{await checkCompany(c,f.companyId);const g=(await c.query('UPDATE radius_ops_groups SET company_id=$2,name=$3,description=$4,cisco_privilege=$5,mikrotik_group=$6,enabled=$7,updated_at=now() WHERE id=$1 RETURNING *',[id,f.companyId,f.name,f.description,f.ciscoPrivilege,f.mikrotikGroup,f.enabled])).rows[0];await groupSync(c,g);}
    }
   }else if(kind==='accounts'){
    if(m==='POST'){const username=user(b.username);await checkCompany(c,f.companyId);if((await c.query('SELECT 1 FROM radius_ops_mac_aliases WHERE alias=$1',[username])).rowCount)throw fail('Username belongs to MAC',409);if(!f.password)throw fail('Password required');if(!f.groupId)throw fail('RADIUS group is required');const g=(await c.query('SELECT id,company_id FROM radius_ops_groups WHERE id=$1',[f.groupId])).rows[0];if(!g||g.company_id!==f.companyId)throw fail('RADIUS group does not belong to this company',409);const a=(await c.query('INSERT INTO radius_ops_accounts(id,company_id,username,label,vendor,privilege,mikrotik_group,group_id,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,f.companyId,username,f.label,f.vendor,f.privilege,f.mikrotikGroup,f.groupId,f.enabled])).rows[0];await accountSync(c,a,f.password);}
    else{const old=(await c.query('SELECT * FROM radius_ops_accounts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('Account not found',404);
     if(m==='DELETE'){await c.query('DELETE FROM radcheck WHERE username=$1',[old.username]);await c.query('DELETE FROM radreply WHERE username=$1',[old.username]);await c.query('DELETE FROM radusergroup WHERE username=$1',[old.username]);await c.query('DELETE FROM radius_ops_accounts WHERE id=$1',[id]);}
     else{await checkCompany(c,f.companyId);if(!f.groupId)throw fail('RADIUS group is required');const g=(await c.query('SELECT id,company_id FROM radius_ops_groups WHERE id=$1',[f.groupId])).rows[0];if(!g||g.company_id!==f.companyId)throw fail('RADIUS group does not belong to this company',409);const a=(await c.query('UPDATE radius_ops_accounts SET company_id=$2,label=$3,vendor=$4,privilege=$5,mikrotik_group=$6,group_id=$7,enabled=$8 WHERE id=$1 RETURNING *',[id,f.companyId,f.label,f.vendor,f.privilege,f.mikrotikGroup,f.groupId,f.enabled])).rows[0];await accountSync(c,a,f.password??undefined);}
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
