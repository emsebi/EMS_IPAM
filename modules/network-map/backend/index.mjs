import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fail,text,normalizeMac,settingsInput,expandScopes,emptyTopology,buildTopology,impact,traceMac,layoutInput} from './model.mjs';
import {vault} from './vault.mjs';
import {collectDevice,probeTcp} from '../discovery/ssh.mjs';

const base='/api/network-map',uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const defaults={username:'',port:22,timeout:8,concurrency:4,devices:[],scopes:[],rootId:'',saveConfig:true};
export function createModule(ctx) {
  const {pool,json,readBody,requireAdmin,audit,pingMany}=ctx;
  const directory=path.join(ctx.backupDir||process.env.BACKUP_DIR||'/backups','network-map');
  const secret=vault(path.join(directory,'private')),jobs=new Map(),healthLocks=new Set();
  const collector=ctx.collectNetworkDevice||collectDevice,probe=ctx.networkProbe||probeTcp;
  const folder=c=>path.join(directory,crypto.createHash('sha256').update(c).digest('hex').slice(0,24));
  const readSettings=async c=>(await pool.query('SELECT settings,password_ciphertext FROM network_map_settings WHERE company_id=$1',[c])).rows[0];
  const readState=async c=>(await pool.query('SELECT topology,layout FROM network_map_state WHERE company_id=$1',[c])).rows[0]||{topology:emptyTopology(),layout:{positions:{},background:''}};
  const saveTopology=async(c,topology)=>pool.query(`INSERT INTO network_map_state(company_id,topology) VALUES($1,$2::jsonb) ON CONFLICT(company_id) DO UPDATE SET topology=excluded.topology`,[c,JSON.stringify(topology)]);
  const busy=c=>jobs.get(c)?.status==='running'||healthLocks.has(c);
  async function verifyHostKey(c,address,port,fingerprint){
    await pool.query('INSERT INTO network_map_host_keys(company_id,address,port,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[c,address,port,fingerprint]);
    return (await pool.query('SELECT fingerprint FROM network_map_host_keys WHERE company_id=$1 AND address=$2 AND port=$3',[c,address,port])).rows[0]?.fingerprint===fingerprint;
  }
  async function archive(c,user,topology,configs) {
    const id=crypto.randomUUID(),dir=folder(c);await fs.mkdir(dir,{recursive:true,mode:0o700});
    const payload={format:'ems-network-map/1',createdAt:new Date().toISOString(),companyId:c,topology,
      configExport:{secretsRedacted:true,restorableWithoutAdditionalSecrets:false,devices:configs}};
    const file=path.join(dir,`${id}.json`);await fs.writeFile(file+'.tmp',JSON.stringify(payload,null,2),{mode:0o600});await fs.rename(file+'.tmp',file);
    await pool.query('INSERT INTO network_map_snapshots(id,company_id,created_by,source,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)',[id,c,user.username||user.id,'discovery',JSON.stringify(topology)]);
    const old=(await pool.query('SELECT id FROM network_map_snapshots WHERE company_id=$1 ORDER BY created_at DESC OFFSET 20',[c])).rows;
    for(const row of old){await fs.rm(path.join(dir,`${row.id}.json`),{force:true});await pool.query('DELETE FROM network_map_snapshots WHERE company_id=$1 AND id=$2',[c,row.id]);}
    return id;
  }
  async function runScan(c,user,record,job,deviceId) {
    const settings=record.settings,password=await secret.decrypt(record.password_ciphertext);
    const previous=(await readState(c)).topology,old=new Map(previous.nodes.map(n=>[n.id,n]));
    const allowed=new Set([...settings.devices.map(d=>d.address),...expandScopes(settings.scopes)]);
    const queue=deviceId?[settings.devices.find(d=>d.id===deviceId)||old.get(deviceId)]:[...settings.devices];
    if(deviceId&&(!queue[0]||!allowed.has(queue[0].address)))throw fail('Device is outside the saved scan scope.');
    const queued=new Set(queue.map(n=>n.address));
    if(!deviceId)for(const ip of expandScopes(settings.scopes))if(!queued.has(ip)){queue.push({id:ip,address:ip,name:ip,platform:'auto',probeFirst:true});queued.add(ip);}
    const nodes=new Map(previous.nodes.filter(n=>!n.id.startsWith('peer:')&&allowed.has(n.address)).map(n=>[n.id,n]));
    const configs={};job.total=queue.length;let cursor=0,collected=0;
    async function worker(){while(cursor<queue.length&&!job.cancelled){
      const target=queue[cursor++];if(collected>=500){job.limitReached=true;break;}
      if(target.probeFirst&&!await probe(target.address,settings.port,1200)){job.completed++;if(old.has(target.id))nodes.set(target.id,{...old.get(target.id),status:'unreachable',reachability:'unreachable',checkedAt:new Date().toISOString()});continue;}
      if(collected>=500){job.limitReached=true;break;}collected++;const at=new Date().toISOString();
      const result=await collector(target,settings,password,{createSshClient:ctx.createSshClient,verifyHostKey:(...args)=>verifyHostKey(c,...args)});
      const config=result.config;delete result.config;if(config)configs[target.id]=config;
      const previousNode=old.get(target.id)||{};
      const node={...previousNode,...target,...result,checkedAt:at,reachability:result.status==='unreachable'?'unreachable':result.status==='collection-error'?'unknown':'reachable',
        collectedAt:['online','partial'].includes(result.status)?at:previousNode.collectedAt||null};delete node.probeFirst;
      if(node.hostname&&target.name===target.address)node.name=node.hostname;
      nodes.set(node.id,node);job.completed++;
    }}
    await Promise.all(Array.from({length:settings.concurrency},worker));
    const aliases=new Set([...nodes.values()].flatMap(n=>[n.address,n.name,n.hostname,n.hostname?.split('.')[0]]).filter(Boolean).map(s=>s.toLowerCase()));
    for(const node of [...nodes.values()])for(const neighbor of node.neighbors||[]){
      if(nodes.size>=500)break;const keys=[neighbor.address,neighbor.deviceId,neighbor.deviceId?.split('.')[0]].filter(Boolean);
      if(keys.some(k=>aliases.has(k.toLowerCase())))continue;
      const id='peer:'+crypto.createHash('sha256').update(keys.join('|')).digest('hex').slice(0,16);
      nodes.set(id,{id,name:neighbor.deviceId||neighbor.address,address:neighbor.address||'',status:'unknown',platform:'unknown',ports:[],macs:[],features:{},neighbors:[],collectedAt:null});
      for(const k of keys)aliases.add(k.toLowerCase());
    }
    const topology=buildTopology([...nodes.values()],previous);
    job.snapshotId=await archive(c,user,topology,configs);await saveTopology(c,topology);
    job.status=job.cancelled?'cancelled':job.limitReached?'limited':'completed';job.finishedAt=new Date().toISOString();
    await audit(user,'network-map.scan','network_map',c,{companyId:c,detail:{devices:collected,status:job.status}});
  }
  let ouiPromise;
  async function vendor(mac){
    if((parseInt(mac.slice(0,2),16)&2)!==0)return {name:null,kind:'locally-administered'};
    const oui=await (ouiPromise??=fs.readFile(new URL('../data/oui.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>({entries:{}})));
    return {name:oui.entries?.[mac.replaceAll(':','').slice(0,6).toUpperCase()]||null,kind:'oui',source:'IEEE MA-L',updatedAt:oui.updatedAt||null};
  }
  async function macRecords(c){
    const registry=(await pool.query(`SELECT m.id,m.mac::text,m.name,m.owner,m.notes,m.device_type_id AS "deviceTypeId",t.name AS type FROM network_mac_registry m LEFT JOIN device_types t ON t.id=m.device_type_id WHERE m.company_id=$1 ORDER BY m.name`,[c])).rows;
    const hosts=(await pool.query(`SELECT h.id,h.mac,h.name,h.owner,h.type,h.ip FROM hosts h JOIN address_spaces s ON s.id=h.space_id WHERE s.company_id=$1 AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND coalesce(h.mac,'')<>''`,[c])).rows;
    const found=new Map(registry.map(m=>[m.mac,{...m,source:'registry'}]));
    for(const h of hosts){try{const mac=normalizeMac(h.mac);if(!found.has(mac))found.set(mac,{...h,mac,source:'ipam'});}catch{}}return [...found.values()];
  }
  return {match:(_req,url)=>url.pathname===base||url.pathname.startsWith(base+'/'),async handle(req,res,url,user){
    requireAdmin(user);const c=text(url.searchParams.get('companyId'),100);
    if(!c||(await pool.query('SELECT id FROM companies WHERE id=$1 AND deleted_at IS NULL',[c])).rowCount!==1)throw fail('Select an active company.');
    const route=url.pathname.slice(base.length),method=req.method;
    if(route==='/settings'&&method==='GET'){
      const row=await readSettings(c);return json(res,200,{ok:true,settings:{...defaults,...row?.settings},hasPassword:!!row?.password_ciphertext,
        archivePath:'backups/network-map/'+path.basename(folder(c)),hostKeyPolicy:'trust-on-first-use; changed keys blocked'});
    }
    if(route==='/settings'&&method==='PUT'){
      if(busy(c))throw fail('Wait for the current scan to finish.',409);
      const body=await readBody(req),settings=settingsInput(body),old=await readSettings(c);let cipher=old?.password_ciphertext||'';
      if(body.password!==undefined&&body.password!==''){
        if(typeof body.password!=='string'||body.password.length>1024)throw fail('Invalid password.');cipher=await secret.encrypt(body.password);
      }
      if(!cipher)throw fail('Connection password is required.');
      await pool.query(`INSERT INTO network_map_settings(company_id,settings,password_ciphertext) VALUES($1,$2::jsonb,$3) ON CONFLICT(company_id) DO UPDATE SET settings=excluded.settings,password_ciphertext=excluded.password_ciphertext,updated_at=now()`,[c,JSON.stringify(settings),cipher]);
      await audit(user,'network-map.settings','network_map',c,{companyId:c});return json(res,200,{ok:true});
    }
    if(route==='/state'&&method==='GET')return json(res,200,{ok:true,...await readState(c),job:jobs.get(c)||null});
    if(route==='/layout'&&method==='PUT'){
      const layout=layoutInput(await readBody(req));await pool.query(`INSERT INTO network_map_state(company_id,layout) VALUES($1,$2::jsonb) ON CONFLICT(company_id) DO UPDATE SET layout=excluded.layout`,[c,JSON.stringify(layout)]);return json(res,200,{ok:true});
    }
    if(route==='/scan'&&method==='POST'){
      if(busy(c))throw fail('A scan is already running.',409);
      const record=await readSettings(c);if(!record?.password_ciphertext)throw fail('Save connection settings first.');
      const body=await readBody(req),deviceId=text(body.deviceId,100);
      if(deviceId){const state=await readState(c);const allowed=new Set([...record.settings.devices.map(d=>d.address),...expandScopes(record.settings.scopes)]);if(!allowed.has(deviceId)||![...record.settings.devices,...state.topology.nodes].some(n=>n.id===deviceId))throw fail('Device is outside the saved scan scope.',404);}
      const job={id:crypto.randomUUID(),status:'running',startedAt:new Date().toISOString(),completed:0,total:0};jobs.set(c,job);
      runScan(c,user,record,job,deviceId).catch(()=>{job.status='failed';job.error='Collection or archive failed; previous saved snapshots remain available.';job.finishedAt=new Date().toISOString();});
      return json(res,202,{ok:true,job});
    }
    if(route==='/cancel'&&method==='POST'){const job=jobs.get(c);if(job?.status==='running')job.cancelled=true;return json(res,200,{ok:true});}
    if(route==='/health'&&method==='POST'){
      if(busy(c))throw fail('A discovery scan is running.',409);healthLocks.add(c);
      try{
        const state=await readState(c),record=await readSettings(c);if(!record)return json(res,200,{ok:true,topology:state.topology});
        const allowed=new Set([...record.settings.devices.map(d=>d.address),...expandScopes(record.settings.scopes)]);
        const targets=state.topology.nodes.filter(n=>allowed.has(n.address)),ips=targets.map(n=>n.address);
        const pings=pingMany?await pingMany(ips,{concurrency:8,timeoutSeconds:1}):new Map();let cursor=0;
        await Promise.all(Array.from({length:8},async()=>{while(cursor<targets.length){const n=targets[cursor++];n.reachability=pings.get(n.address)||await probe(n.address,record.settings.port,1500)?'reachable':'unreachable';n.reachabilityAt=new Date().toISOString();}}));
        await saveTopology(c,state.topology);return json(res,200,{ok:true,topology:state.topology});
      }finally{healthLocks.delete(c);}
    }
    if(route==='/impact'&&method==='GET'){
      const {topology}=await readState(c),record=await readSettings(c);return json(res,200,{ok:true,...impact(topology,record?.settings.rootId,{nodeId:url.searchParams.get('nodeId'),linkId:url.searchParams.get('linkId')})});
    }
    if(route==='/macs'&&method==='GET')return json(res,200,{ok:true,items:await macRecords(c)});
    if(route==='/macs'&&method==='POST'){
      const b=await readBody(req),mac=normalizeMac(b.mac),name=text(b.name);if(!name)throw fail('Name is required.');const typeId=text(b.deviceTypeId,100)||null;
      if(typeId&&!(await pool.query('SELECT id FROM device_types WHERE id=$1',[typeId])).rowCount)throw fail('Device type was not found.');
      const result=await pool.query(`INSERT INTO network_mac_registry(id,company_id,mac,name,device_type_id,owner,notes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(company_id,mac) DO UPDATE SET name=excluded.name,device_type_id=excluded.device_type_id,owner=excluded.owner,notes=excluded.notes,updated_at=now() RETURNING id`,[crypto.randomUUID(),c,mac,name,typeId,text(b.owner),text(b.notes,1000)]);
      await audit(user,'network-map.mac.save','network_mac',result.rows[0].id,{companyId:c});return json(res,200,{ok:true,id:result.rows[0].id});
    }
    if(route==='/trace'&&method==='GET'){
      const mac=normalizeMac(url.searchParams.get('mac')),{topology}=await readState(c),record=await readSettings(c);
      return json(res,200,{ok:true,...traceMac(topology,mac,record?.settings.rootId),vendor:await vendor(mac),record:(await macRecords(c)).find(m=>m.mac===mac)||null});
    }
    if(route==='/snapshots'&&method==='GET')return json(res,200,{ok:true,items:(await pool.query('SELECT id,created_at AS "createdAt",source FROM network_map_snapshots WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20',[c])).rows});
    const download=route.match(/^\/snapshots\/([^/]+)\/download$/);
    if(download&&method==='GET'){
      if(!uuid.test(download[1]))throw fail('Invalid snapshot.',404);
      if(!(await pool.query('SELECT id FROM network_map_snapshots WHERE id=$1 AND company_id=$2',[download[1],c])).rowCount)throw fail('Snapshot not found.',404);
      let data;try{data=await fs.readFile(path.join(folder(c),download[1]+'.json'));}catch{throw fail('Snapshot file is unavailable.',404);}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="network-map-${download[1]}.json"`,'Cache-Control':'no-store'});return res.end(data);
    }
    return json(res,404,{ok:false,error:'Network map endpoint not found.'});
  }};
}
