import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/network-map/backend/index.mjs';
import {redactConfig} from '../../modules/network-map/discovery/device-parsers.mjs';
import {settingsInput,impact,traceMac,traceSavedIp} from '../../modules/network-map/backend/model.mjs';

const moduleDir=fileURLToPath(new URL('../../modules/network-map/',import.meta.url));
function adapter(db){
 const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0};};
 return {query,connect:async()=>({query,release(){}})};
}
async function fixture(){
 const db=new PGlite(),pool=adapter(db),backupDir=await fs.mkdtemp(path.join(os.tmpdir(),'ems-map-'));
 await migrateDatabase(pool);await pool.query("INSERT INTO companies(id,name) VALUES('map-co','Map test')");
 await migrateModuleSchemas(pool,[{id:'network-map',dir:moduleDir}]);
 let response,collects=0,probes=0;
 const module=createModule({pool,backupDir,json:(_res,status,body)=>response={status,body},readBody:async req=>req.body,
  requireAdmin:user=>{if(user?.role!=='admin')throw Object.assign(new Error('forbidden'),{status:403});},audit:async()=>{},
  networkProbe:async()=>{probes++;return true;},collectNetworkDevice:async(target,_settings,password)=>{collects++;assert.equal(password,'map-pass');return {
   status:'online',hostname:'core-sw',model:'C9300',os:'17.12',ports:[{name:'Gi1/0/1',status:'up',mode:'trunk'}],
   macs:[{mac:'00:11:22:33:44:55',port:'Gi1/0/2',vlan:'10'}],neighbors:[],features:{LLDP:{enabled:true}},config:'hostname core-sw\nusername netread secret [REDACTED]'};}
 });
 const call=async(method,route,body,user={role:'admin',username:'tester'})=>{const url=new URL('http://test/api/network-map'+route+(route.includes('?')?'&':'?')+'companyId=map-co');await module.handle({method,body},{writeHead(){},end(){}},url,user);return response;};
 return {db,pool,backupDir,call,getCollects:()=>collects,getProbes:()=>probes,close:async()=>{await db.close();await fs.rm(backupDir,{recursive:true,force:true});}};
}

test('saved IP trace isolates company and space, excludes archived data and never collects',async()=>{
 const f=await fixture();try{
  await f.pool.query("INSERT INTO companies(id,name) VALUES('other-co','Other fixture')");
  await f.pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('s1','map-co','One','192.0.2.0/24'),('s2','map-co','Two','192.0.2.0/25'),('s3','other-co','Other','192.0.2.0/24'),('s4','map-co','Archived','192.0.2.0/26')");
  await f.pool.query("UPDATE address_spaces SET deleted_at=now() WHERE id='s4'");
  await f.pool.query(`INSERT INTO hosts(id,space_id,ip,mac) VALUES
   ('h1','s1','192.0.2.50','0011.2233.4455'),('h2','s2','192.0.2.50','00:11:22:33:44:66'),
   ('h3','s3','192.0.2.50','00:11:22:33:44:77'),('h4','s4','192.0.2.50','00:11:22:33:44:88'),
   ('h5','s1','192.0.2.51',''),('h6','s1','192.0.2.52','00:11:22:33:44:99')`);
  await f.pool.query("UPDATE hosts SET deleted_at=now() WHERE id='h6'");
  const topology={nodes:[{id:'edge',name:'Edge',status:'online',platform:'cisco',collectedAt:'2020-01-01T00:00:00Z',ports:[{name:'Gi1',mode:'access'}],macs:[{mac:'00:11:22:33:44:55',port:'Gi1',vlan:'10'}]}],links:[]};
  await f.pool.query("INSERT INTO network_map_state(company_id,topology) VALUES('map-co',$1::jsonb)",[JSON.stringify(topology)]);
  const all=(await f.call('GET','/trace-ip?ip=192.0.2.50')).body;
  assert.equal(all.resolution,'ambiguous');assert.deepEqual(all.records.map(r=>r.hostId),['h1','h2']);
  const one=(await f.call('GET','/trace-ip?ip=192.0.2.50&spaceId=s1')).body;
  assert.equal(one.resolution,'inventory-match');assert.equal(one.confidence,'uncertain');
  assert.equal(one.records[0].observedAt,null);assert.ok(one.records[0].recordUpdatedAt);assert.equal(one.records[0].source,'ipam-inventory');
  assert.equal(one.matches[0].trace.observations[0].port,'Gi1');assert.equal(one.matches[0].trace.observations[0].stale,true);
  assert.equal((await f.call('GET','/trace-ip?ip=192.0.2.50&spaceId=s3')).body.resolution,'not-found');
  assert.equal((await f.call('GET','/trace-ip?ip=192.0.2.51')).body.resolution,'missing-mac');
  assert.equal((await f.call('GET','/trace-ip?ip=192.0.2.52')).body.resolution,'not-found');
  await assert.rejects(f.call('GET','/trace-ip?ip=192.0.2.0/24'),/single IPv4/);
  await assert.rejects(f.call('GET','/trace-ip?ip=192.0.2.50',null,{role:'user'}),/forbidden/);
  assert.equal(f.getCollects(),0);assert.equal(f.getProbes(),0);
 }finally{await f.close();}
});

test('saved IP trace bounds evidence and treats missing observation time as stale',()=>{
 const rows=Array.from({length:101},(_,i)=>({id:String(i),mac:'00:11:22:33:44:55'}));
 const topology={nodes:[{id:'edge',status:'online',ports:[],macs:[{mac:'00:11:22:33:44:55',port:'Gi1'}]}],links:[]};
 const result=traceSavedIp(topology,'192.0.2.50',rows,'edge');
 assert.equal(result.truncated,true);assert.equal(result.records.length,100);assert.equal(result.resolution,'ambiguous');
 assert.equal(result.matches[0].trace.observations[0].stale,true);
 assert.equal(traceSavedIp(topology,'192.0.2.50',[{id:'bad',mac:'invalid'}],'edge').resolution,'missing-mac');
});

test('read-only settings encrypt the password and scan only after an explicit POST',async()=>{
 const f=await fixture();try{
  const input={username:'netread',password:'map-pass',devices:[{address:'192.0.2.10',platform:'cisco',name:'Core'}],scopes:[],rootId:'192.0.2.10',port:22,timeout:8,concurrency:2,saveConfig:true};
  assert.equal((await f.call('PUT','/settings',input)).status,200);
  assert.equal(f.getCollects(),0);
  const stored=(await f.pool.query("SELECT password_ciphertext,settings FROM network_map_settings WHERE company_id='map-co'")).rows[0];
  assert.notEqual(stored.password_ciphertext,'map-pass');assert.ok(stored.password_ciphertext.startsWith('v1:'));
  const listed=await f.call('GET','/settings');assert.equal(listed.body.hasPassword,true);assert.equal(JSON.stringify(listed.body).includes('map-pass'),false);assert.equal(f.getCollects(),0);
  assert.equal((await f.call('POST','/scan',{})).status,202);
  for(let i=0;i<100;i++){const state=await f.call('GET','/state');if(state.body.job?.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  const state=await f.call('GET','/state');assert.equal(state.body.job.status,'completed');assert.equal(f.getCollects(),1);
  assert.equal(state.body.topology.nodes[0].hostname,'core-sw');
  const archive=await fs.readdir(path.join(f.backupDir,'network-map'),{recursive:true});assert.ok(archive.some(name=>name.endsWith('.json')));
 }finally{await f.close();}
});

test('scope validation, impact and MAC trace are bounded and deterministic',()=>{
 assert.throws(()=>settingsInput({username:'u',devices:[],scopes:['127.0.0.1/32']}),/not allowed/);
 assert.throws(()=>settingsInput({username:'u',devices:[],scopes:['192.0.2.1/19']}),/\/20 through \/32/);
 const topology={nodes:[{id:'core',status:'online'},{id:'edge',status:'online',collectedAt:new Date().toISOString(),platform:'cisco',ports:[{name:'Gi1',mode:'access'}],macs:[{mac:'00:11:22:33:44:55',port:'Gi1'}]}],links:[{id:'uplink',source:'core',target:'edge',state:'up'}]};
 assert.deepEqual(impact(topology,'core',{linkId:'uplink'}).affected,['edge']);
 const trace=traceMac(topology,'0011.2233.4455','core');assert.equal(trace.candidates.length,1);assert.deepEqual(trace.paths[0].links,['uplink']);
});

test('configuration redaction removes values instead of retaining the matching line',()=>{
 const sentinels=['ios-password-value','radius-secret-value','snmp-community-value','routeros-password-value','snmp-auth-value','snmp-priv-value','wifi-psk-value'];
 const raw=`username netread password ${sentinels[0]}\nradius server EMS key ${sentinels[1]}\nsnmp-server community ${sentinels[2]} RO\n/user add name=netread password=${sentinels[3]} group=read\nsnmp-server user monitor EMS v3 auth sha ${sentinels[4]} priv aes 128 ${sentinels[5]}\nwpa-psk ascii ${sentinels[6]}`;
 const output=redactConfig(raw);for(const value of sentinels)assert.equal(output.includes(value),false);assert.match(output,/\[REDACTED\]/);assert.match(output,/username netread password/);
});
