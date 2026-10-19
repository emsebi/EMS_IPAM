import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/radius-ops/backend/index.mjs';

test('default deletion persists and dependent users move only to equivalent profiles and collections',async()=>{
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
  const keepGroup=(await call('GET','groups')).items[0];
  const duplicate=(await call('POST','groups',{companyId:'defaults-co',name:'Duplicate read-only',ciscoPrivilege:1,mikrotikGroup:'read',enabled:true})).id;
  const account=(await call('POST','accounts',{companyId:'defaults-co',username:'duplicate-test',password:'testpass',enabled:true,
   accessRules:[{collectionId:collections[0].id,profileId:duplicate}]})).id;
  const authorization=async()=> (await query("SELECT cisco_privilege,mikrotik_group FROM radius_ops_resolve_access('duplicate-test','192.0.2.10'::inet)")).rows;
  const before=await authorization();
  assert.deepEqual(before,[{cisco_privilege:1,mikrotik_group:'read'}]);
  await call('DELETE','groups/'+duplicate);
  assert.equal((await query('SELECT profile_id FROM radius_ops_access_rules WHERE account_id=$1',[account])).rows[0].profile_id,keepGroup.id);
  assert.deepEqual(await authorization(),before);
  assert.equal((await query("SELECT value FROM radcheck WHERE username='duplicate-test' AND attribute='Cleartext-Password'")).rows[0].value,'testpass');
  // Other companies and different rights cannot replace the last referenced profile.
  await query("INSERT INTO companies(id,name) VALUES('other-co','Other tenant')");
  await call('POST','groups',{companyId:'other-co',name:'Foreign read-only',ciscoPrivilege:1,mikrotikGroup:'read',enabled:true});
  await call('POST','groups',{companyId:'defaults-co',name:'Administrator',ciscoPrivilege:15,mikrotikGroup:'full',enabled:true});
  await assert.rejects(call('DELETE','groups/'+keepGroup.id),{status:409});
  assert.deepEqual(await authorization(),before);
  const duplicateCollection=(await call('POST','collections',{companyId:'defaults-co',name:'Duplicate NAS',enabled:true})).id;
  const nas=(await call('GET','devices')).items[0];
  await query('INSERT INTO radius_ops_collection_devices(id,collection_id,device_id) VALUES($1,$2,$3)',[crypto.randomUUID(),duplicateCollection,nas.id]);
  await query('UPDATE radius_ops_access_rules SET collection_id=$2 WHERE account_id=$1',[account,duplicateCollection]);
  await call('DELETE','collections/'+duplicateCollection);
  assert.equal((await query('SELECT collection_id FROM radius_ops_access_rules WHERE account_id=$1',[account])).rows[0].collection_id,collections[0].id);
  assert.deepEqual(await authorization(),before);
  const wider=(await call('POST','collections',{companyId:'defaults-co',name:'Different membership',enabled:true})).id;
  await assert.rejects(call('DELETE','collections/'+collections[0].id),{status:409});
  assert.deepEqual(await authorization(),before);
 }finally{await db.close();}
});
