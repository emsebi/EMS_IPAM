import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {migrateDatabase, migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/radius-ops/backend/index.mjs';

const dir=fileURLToPath(new URL('../../modules/radius-ops/',import.meta.url));
const tables=['radius_ops_devices','radius_ops_accounts','radius_ops_groups','radius_ops_collections','radius_ops_access_rules','radius_ops_collection_devices','radius_ops_secret_profiles','radcheck','radreply','radgroupreply','radusergroup','nas'];
async function fixture(legacy=false){
 const db=new PGlite(),temp=await mkdtemp(join(tmpdir(),'ems-collections-'));
 const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.affectedRows||r?.rows?.length||0};};
 const pool={query,connect:async()=>({query,release(){}})};
 await migrateDatabase(pool);
 let moduleDir=dir;
 if(legacy){
  moduleDir=temp;await mkdir(join(temp,'migrations'));
  for(const name of await readdir(join(dir,'migrations')))if(name<'013')await copyFile(join(dir,'migrations',name),join(temp,'migrations',name));
  await query("INSERT INTO companies(id,name) VALUES('legacy-a','Legacy A'),('legacy-b','Legacy B')");
 }
 assert.deepEqual((await migrateModuleSchemas(pool,[{id:'radius-ops',dir:moduleDir}])).failed,[]);
 let result;
 const api=createModule({pool,json:(_r,status,body)=>result={status,...body},readBody:async req=>req.body,requireAdmin(){},requireModuleAccess:async()=>{},audit:async()=>{}});
 const call=async(method,path,body)=>{await api.handle({method,body},{setHeader(){}},new URL('http://test/api/radius-ops/'+path),{role:'admin'});return result;};
 const allowed=async(username,ip='192.0.2.10')=>(await query('SELECT cisco_privilege,mikrotik_group FROM radius_ops_resolve_access($1,$2::inet)',[username,ip])).rows;
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`)).rows])));
 return {query,call,allowed,snapshot,upgrade:()=>migrateModuleSchemas(pool,[{id:'radius-ops',dir}]),close:async()=>{await db.close();await rm(temp,{recursive:true,force:true});}};
}
async function setup(f,companyId){
 const scope=companyId?{companyId}:{};
 const collection=(await f.call('POST','collections',{...scope,name:'Routers '+(companyId||'standalone'),enabled:true})).id;
 const group=(await f.call('POST','groups',{...scope,name:'Admins '+(companyId||'standalone'),ciscoPrivilege:15,mikrotikGroup:'full',enabled:true})).id;
 const secret=(await f.call('POST','secret-profiles',{...scope,name:'Secret '+(companyId||'standalone'),secret:'fixture-secret',enabled:true})).id;
 const nas=(await f.call('POST','devices',{...scope,label:'Test NAS',nasIp:companyId==='legacy-b'?'192.0.2.20':'192.0.2.10',secretProfileId:secret,collectionIds:[collection],enabled:true})).id;
 const account=(await f.call('POST','accounts',{...scope,username:companyId||'standalone',password:'fixture-password',accessRules:[{collectionId:collection,profileId:group}],enabled:true})).id;
 return {collection,group,secret,nas,account};
}

test('RADIUS CRUD and explicit NAS authorization work without any Company',async()=>{
 const f=await fixture();try{
  const x=await setup(f);
  assert.equal((await f.query('SELECT count(*)::int n FROM companies')).rows[0].n,0);
  for(const kind of ['devices','accounts','groups','collections','secret-profiles'])assert.ok((await f.call('GET',kind)).items.every(row=>row.companyId===null));
  assert.deepEqual(await f.allowed('standalone'),[{cisco_privilege:15,mikrotik_group:'full'}]);
  assert.deepEqual(await f.allowed('standalone','198.51.100.1'),[]);
  await f.call('PUT','groups/'+x.group,{name:'Updated',ciscoPrivilege:1,mikrotikGroup:'read',enabled:true});
  assert.deepEqual(await f.allowed('standalone'),[{cisco_privilege:1,mikrotik_group:'read'}]);
  assert.equal((await f.call('POST','accounts/'+x.account+'/reveal-password',{})).value,'fixture-password');
  assert.equal((await f.call('POST','secret-profiles/'+x.secret+'/reveal',{})).value,'fixture-secret');
  const extra=(await f.call('POST','collections',{name:'Second',enabled:true})).id;
  const full=(await f.call('POST','groups',{name:'Full',ciscoPrivilege:15,mikrotikGroup:'full',enabled:true})).id;
  await f.call('PUT','devices/'+x.nas,{label:'Test NAS',nasIp:'192.0.2.10',collectionIds:[x.collection,extra],enabled:true});
  await assert.rejects(f.call('PUT','accounts/'+x.account,{label:'Standalone',enabled:true,accessRules:[{collectionId:x.collection,profileId:x.group},{collectionId:extra,profileId:full}]}),{status:409});
  assert.deepEqual(await f.allowed('standalone'),[{cisco_privilege:1,mikrotik_group:'read'}]);
  await f.call('PUT','accounts/'+x.account,{label:'Unassigned',enabled:true,accessRules:[]});
  assert.deepEqual(await f.allowed('standalone'),[]);
 }finally{await f.close();}
});

test('001–012 upgrade preserves credentials, rows, legacy authorization and inventory links',async()=>{
 const f=await fixture(true);try{
  const a=await setup(f,'legacy-a'),b=await setup(f,'legacy-b');
  await f.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('legacy-space','legacy-a','Legacy space','192.0.2.0/24'); INSERT INTO hosts(id,space_id,name,ip) VALUES('legacy-host','legacy-space','Existing router','192.0.2.10')");
  await f.query('UPDATE radius_ops_devices SET host_id=$2 WHERE id=$1',[a.nas,'legacy-host']);
  const before=await f.snapshot();
  assert.deepEqual((await f.upgrade()).failed,[]);
  assert.deepEqual(await f.snapshot(),before);
  assert.deepEqual((await f.upgrade()).applied,[]);
  assert.deepEqual(await f.allowed('legacy-a'),[{cisco_privilege:15,mikrotik_group:'full'}]);
  assert.deepEqual(await f.allowed('legacy-a','192.0.2.20'),[]);
  await f.call('PUT','accounts/'+a.account,{label:'Renamed',enabled:true,accessRules:[{collectionId:a.collection,profileId:a.group}]});
  await f.call('PUT','devices/'+a.nas,{label:'Renamed NAS',nasIp:'192.0.2.10',enabled:true,collectionIds:[a.collection]});
  await f.call('PUT','secret-profiles/'+a.secret,{name:'Renamed secret',enabled:true});
  await f.call('PUT','groups/'+a.group,{name:'Renamed profile',ciscoPrivilege:15,mikrotikGroup:'full',enabled:true});
  await f.call('PUT','collections/'+a.collection,{name:'Renamed collection',enabled:true});
  for(const [table,id] of [['devices',a.nas],['accounts',a.account],['groups',a.group],['collections',a.collection],['secret_profiles',a.secret]])assert.equal((await f.query(`SELECT company_id FROM radius_ops_${table} WHERE id=$1`,[id])).rows[0].company_id,'legacy-a');
  assert.equal((await f.query('SELECT host_id FROM radius_ops_devices WHERE id=$1',[a.nas])).rows[0].host_id,'legacy-host');
  assert.equal((await f.call('POST','accounts/'+a.account+'/reveal-password',{})).value,'fixture-password');
  assert.equal((await f.call('POST','secret-profiles/'+a.secret+'/reveal',{})).value,'fixture-secret');
  await f.call('POST','accounts',{username:'new-user',password:'new-test',enabled:true,accessRules:[{collectionId:a.collection,profileId:a.group}]});
  assert.deepEqual(await f.allowed('new-user'),[{cisco_privilege:15,mikrotik_group:'full'}]);
  assert.deepEqual(await f.allowed('new-user','192.0.2.20'),[]);
  await f.call('PUT','groups/'+b.group,{name:'B renamed',ciscoPrivilege:15,mikrotikGroup:'full',enabled:true});
 }finally{await f.close();}
});

test('upgrade refuses malformed legacy links instead of silently widening access',async()=>{
 const f=await fixture(true);try{
  const a=await setup(f,'legacy-a'),b=await setup(f,'legacy-b');
  await f.query('UPDATE radius_ops_access_rules SET profile_id=$2 WHERE account_id=$1',[a.account,b.group]);
  assert.deepEqual(await f.allowed('legacy-a'),[]);
  const result=await f.upgrade();
  assert.equal(result.failed.length,1);assert.match(result.failed[0].error,/Inconsistent legacy RADIUS access links/);
  assert.deepEqual(await f.allowed('legacy-a'),[]);
 }finally{await f.close();}
});
