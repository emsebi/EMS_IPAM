import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/network-map/backend/index.mjs';

const connectionString=process.env.EMS_TEST_POSTGRES_URL;
if(!connectionString)throw new Error('EMS_TEST_POSTGRES_URL is required for the PostgreSQL network-map gate.');

const moduleDir=fileURLToPath(new URL('../../modules/network-map/',import.meta.url));

test('network-map migration and manual discovery persist on PostgreSQL 16',async()=>{
 const pool=new pg.Pool({connectionString}),backupDir=await fs.mkdtemp(path.join(os.tmpdir(),'ems-map-pg-'));
 try{
  await migrateDatabase(pool);
  await pool.query("INSERT INTO companies(id,name) VALUES('map-pg-co','Map PostgreSQL gate')");
  const first=await migrateModuleSchemas(pool,[{id:'network-map',dir:moduleDir}]);
  assert.deepEqual(first.failed,[]);
  assert.deepEqual(first.applied,[{moduleId:'network-map',version:'001-discovery'}]);
  const second=await migrateModuleSchemas(pool,[{id:'network-map',dir:moduleDir}]);
  assert.deepEqual(second,{applied:[],failed:[]});

  let response,collects=0;
  const context={pool,backupDir,json:(_res,status,body)=>response={status,body},readBody:async req=>req.body,
   requireAdmin:user=>{if(user?.role!=='admin')throw Object.assign(new Error('forbidden'),{status:403});},audit:async()=>{},
   networkProbe:async()=>true,collectNetworkDevice:async(_target,_settings,password)=>{
    collects++;assert.equal(password,'postgres-map-pass');
    return {status:'online',hostname:'pg-core',model:'C9300',os:'17.12',ports:[{name:'Gi1/0/1',status:'up',mode:'trunk',vlan:'10'}],
     macs:[{mac:'00:11:22:33:44:55',port:'Gi1/0/1',vlan:'10'}],neighbors:[],features:{LLDP:{enabled:true}},
     config:'hostname pg-core\nusername read-only secret [REDACTED]'};
   }};
  const call=async(module,method,route,body)=>{
   const url=new URL('http://test/api/network-map'+route+(route.includes('?')?'&':'?')+'companyId=map-pg-co');
   await module.handle({method,body},{writeHead(){},end(){}},url,{role:'admin',username:'postgres-gate'});
   return response;
  };
  let module=createModule(context);
  const settings={username:'read-only',password:'postgres-map-pass',devices:[{address:'192.0.2.10',platform:'cisco',name:'PG Core'}],
   scopes:[],rootId:'192.0.2.10',port:22,timeout:8,concurrency:2,saveConfig:true};
  assert.equal((await call(module,'PUT','/settings',settings)).status,200);
  assert.equal(collects,0,'saving settings must not start discovery');
  const stored=(await pool.query("SELECT password_ciphertext,pg_typeof(settings)::text AS settings_type FROM network_map_settings WHERE company_id='map-pg-co'")).rows[0];
  assert.equal(stored.settings_type,'jsonb');
  assert.ok(stored.password_ciphertext.startsWith('v1:'));
  assert.equal(stored.password_ciphertext.includes('postgres-map-pass'),false);
  assert.equal((await call(module,'POST','/scan',{})).status,202);
  for(let i=0;i<100;i++){
   const state=await call(module,'GET','/state');
   if(state.body.job?.status!=='running')break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  let state=await call(module,'GET','/state');
  assert.equal(state.body.job.status,'completed');
  assert.equal(collects,1);
  assert.equal(state.body.topology.nodes[0].hostname,'pg-core');
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM network_map_snapshots WHERE company_id='map-pg-co'")).rows[0].count,1);

  module=createModule(context);
  const listed=await call(module,'GET','/settings');
  assert.equal(listed.body.hasPassword,true);
  assert.equal(JSON.stringify(listed.body).includes('postgres-map-pass'),false);
  state=await call(module,'GET','/state');
  assert.equal(state.body.topology.nodes[0].hostname,'pg-core');
  const archive=await fs.readdir(path.join(backupDir,'network-map'),{recursive:true});
  assert.ok(archive.some(name=>name.endsWith('.json')));
 }finally{
  await pool.end();
  await fs.rm(backupDir,{recursive:true,force:true});
 }
});
