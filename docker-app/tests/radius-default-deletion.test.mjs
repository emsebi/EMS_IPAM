import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/radius-ops/backend/index.mjs';

test('deleted defaults stay deleted on refresh and NAS updates reuse the remaining collection',async()=>{
 const db=new PGlite();
 const query=async(sql,params)=>{
  const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);
  return {...r,rows:r?.rows||[],rowCount:r?.rows?.length||r?.affectedRows||0};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 let result;
 const api=createModule({pool,json:(_r,status,body)=>result={status,...body},
  readBody:async req=>req.body,requireAdmin(){},requireModuleAccess:async()=>{},audit:async()=>{}});
 const call=async(method,path,body)=>{await api.handle({method,body},{},new URL('http://test/api/radius-ops/'+path),{role:'admin'});return result;};
 try{
  await migrateDatabase(pool);
  await query("INSERT INTO companies(id,name) VALUES('defaults-co','Defaults test')");
  await migrateModuleSchemas(pool,[{id:'radius-ops',dir:fileURLToPath(new URL('../../modules/radius-ops/',import.meta.url))}]);
  const oldGroup=(await call('GET','groups')).items[0];
  const oldCollection=(await call('GET','collections')).items[0];
  assert.equal(oldGroup.name,'Default Read-Only');
  assert.equal(oldCollection.name,'Default NAS');
  await call('POST','groups',{companyId:'defaults-co',name:'Keep profile',ciscoPrivilege:1,mikrotikGroup:'read',enabled:true});
  await call('POST','collections',{companyId:'defaults-co',name:'Keep collection',enabled:true});
  await call('DELETE','groups/'+oldGroup.id);
  await call('DELETE','collections/'+oldCollection.id);
  for(let i=0;i<2;i++){
   assert.deepEqual((await call('GET','groups')).items.map(x=>x.name),['Keep profile']);
   assert.deepEqual((await call('GET','collections')).items.map(x=>x.name),['Keep collection']);
  }
  await call('POST','devices',{companyId:'defaults-co',label:'Test NAS',nasIp:'192.0.2.10',secret:'testsecret',vendor:'cisco-ios',enabled:true});
  assert.deepEqual((await call('GET','groups')).items.map(x=>x.name),['Keep profile']);
  const collections=(await call('GET','collections')).items;
  assert.equal(collections.length,1);
  assert.equal(collections[0].name,'Keep collection');
  assert.equal(collections[0].members[0].label,'Test NAS');
 }finally{await db.close();}
});
