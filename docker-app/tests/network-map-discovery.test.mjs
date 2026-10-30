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
import {settingsInput,impact,traceMac} from '../../modules/network-map/backend/model.mjs';

const moduleDir=fileURLToPath(new URL('../../modules/network-map/',import.meta.url));
function adapter(db){
 const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0};};
 return {query,connect:async()=>({query,release(){}})};
}
async function fixture(){
 const db=new PGlite(),pool=adapter(db),backupDir=await fs.mkdtemp(path.join(os.tmpdir(),'ems-map-'));
 await migrateDatabase(pool);await pool.query("INSERT INTO companies(id,name) VALUES('map-co','Map test')");
 await migrateModuleSchemas(pool,[{id:'network-map',dir:moduleDir}]);
 let response,collects=0;
 const module=createModule({pool,backupDir,json:(_res,status,body)=>response={status,body},readBody:async req=>req.body,
  requireAdmin:user=>{if(user?.role!=='admin')throw Object.assign(new Error('forbidden'),{status:403});},audit:async()=>{},
  networkProbe:async()=>true,collectNetworkDevice:async(target,_settings,password)=>{collects++;assert.equal(password,'map-pass');return {
   status:'online',hostname:'core-sw',model:'C9300',os:'17.12',ports:[{name:'Gi1/0/1',status:'up',mode:'trunk'}],
   macs:[{mac:'00:11:22:33:44:55',port:'Gi1/0/2',vlan:'10'}],neighbors:[],features:{LLDP:{enabled:true}},config:'hostname core-sw\nusername netread secret [REDACTED]'};}
 });
 const call=async(method,route,body)=>{const url=new URL('http://test/api/network-map'+route+(route.includes('?')?'&':'?')+'companyId=map-co');await module.handle({method,body},{writeHead(){},end(){}},url,{role:'admin',username:'tester'});return response;};
 return {db,pool,backupDir,call,getCollects:()=>collects,close:async()=>{await db.close();await fs.rm(backupDir,{recursive:true,force:true});}};
}

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
