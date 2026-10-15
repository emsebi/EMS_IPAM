import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { migrateDatabase, migrateModuleSchemas } from "../server/migrations.mjs";
import { createModule } from "../../modules/reports/backend/index.mjs";

function adapter(db){const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0}};return {query,connect:async()=>({query,release(){}})}}
const radiusDir=fileURLToPath(new URL("../../modules/radius/",import.meta.url));

test("reports summarize core and optional module data without exposing audit detail",async()=>{
 const db=new PGlite();const pool=adapter(db);
 try{
  await migrateDatabase(pool);await migrateModuleSchemas(pool,[{id:"radius",dir:radiusDir}]);
  await pool.query("INSERT INTO companies(id,name,kind) VALUES('co','Company','company')");
  await pool.query("INSERT INTO companies(id,parent_company_id,name,kind) VALUES('br','co','Branch','branch')");
  await pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('sp','co','LAN','192.0.2.0/24')");
  await pool.query("INSERT INTO hosts(id,space_id,ip,name,radio_mode) VALUES('ap','sp','192.0.2.10','AP','ap'),('st','sp','192.0.2.11','ST','station')");
  await pool.query("INSERT INTO personnel(id,full_name,active,company_id) VALUES('p','Person',true,'co')");
  await pool.query(`INSERT INTO radius_nas_profiles(id,company_id,device_id,name,vendor,nas_ip,services)
    VALUES('nas','co','ap','NAS','cisco','192.0.2.10','["mab"]'::jsonb)`);
  await pool.query("INSERT INTO radius_mab_policies(id,nas_profile_id) VALUES('pol','nas')");
  await pool.query("INSERT INTO audit_log(action,entity_type,entity_id,company_id,detail) VALUES('test.action','host','ap','co','{\"secret\":\"do-not-return\"}'::jsonb)");
  let response;
  const mod=createModule({pool,json:(_res,status,value)=>{response={status,value};return response},requireAdmin:()=>{},requireModuleAccess:async()=>{}});
  await mod.handle({method:"GET"},{},new URL("http://x/api/reports/summary"),{role:"admin"});
  assert.deepEqual(response.value.summary,{companies:1,branches:1,hosts:2,activePersonnel:1,accessPoints:1,stations:1,radiusNas:1,radiusPolicies:1});
  await mod.handle({method:"GET"},{},new URL("http://x/api/reports/audit?limit=10"),{role:"admin"});
  assert.equal(response.value.items[0].action,"test.action");
  assert.equal(JSON.stringify(response.value).includes("do-not-return"),false);
  assert.equal(Object.hasOwn(response.value.items[0],"detail"),false);
 }finally{await db.close()}
});

test("reports return zero for optional module tables that are not installed",async()=>{
 const db=new PGlite();const pool=adapter(db);
 try{
  await migrateDatabase(pool);let response;
  const mod=createModule({pool,json:(_res,status,value)=>{response={status,value};return response},requireAdmin:()=>{},requireModuleAccess:async()=>{}});
  await mod.handle({method:"GET"},{},new URL("http://x/api/reports/summary"),{role:"admin"});
  assert.equal(response.value.summary.radiusNas,0);assert.equal(response.value.summary.radiusPolicies,0);
 }finally{await db.close()}
});
