import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase, migrateModuleSchemas } from "../server/migrations.mjs";
import { createModule } from "../../modules/radius/backend/index.mjs";

function adapter(db){const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0}};return {query,connect:async()=>({query,release(){}})}}
const radiusDir=fileURLToPath(new URL("../../modules/radius/",import.meta.url));

async function fixture(){
 const db=new PGlite();const pool=adapter(db);await migrateDatabase(pool);await migrateModuleSchemas(pool,[{id:"radius",dir:radiusDir}]);
 await pool.query("INSERT INTO companies(id,name) VALUES('co-a','A')");
 await pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('space-a','co-a','LAN','192.0.2.0/24')");
 await pool.query("INSERT INTO hosts(id,space_id,ip,name) VALUES('sw-1','space-a','192.0.2.10','SW1')");
 await pool.query(`INSERT INTO radius_nas_profiles(id,company_id,device_id,name,vendor,nas_ip,enabled,services)
   VALUES('nas-1','co-a','sw-1','SW1','cisco','192.0.2.10',true,'["mab"]'::jsonb)`);
 let response;
 const handler=createModule({pool,json:(_res,status,value)=>{response={status,value};return response},readBody:async(req)=>req.body,
  requireAdmin:()=>{},requireModuleAccess:async()=>{},audit:async()=>{},broadcast:()=>{}});
 const call=async(method,path,body)=>{const req={method,body};const url=new URL("http://x"+path);assert.equal(handler.match(req,url),true);await handler.handle(req,{},url,{role:"admin"});return response};
 return {db,pool,call};
}

test("per-NAS MAB policy CRUD persists requested known/unknown behavior",async()=>{
 const f=await fixture();
 try{
  const p={id:"policy-1",nasProfileId:"nas-1",enabled:true,knownMode:"accept-dynamic",knownVlan:20,unknownMode:"reject",guestVlan:null};
  assert.equal((await f.call("POST","/api/radius/mab-policies",p)).status,201);
  let list=await f.call("GET","/api/radius/mab-policies");
  assert.equal(list.value.items[0].knownMode,"accept-dynamic");
  assert.equal(list.value.items[0].unknownMode,"reject");
  const updated=await f.call("PUT","/api/radius/mab-policies/policy-1",{...p,unknownMode:"guest-vlan",guestVlan:30});
  assert.equal(updated.value.item.guestVlan,30);
  await f.call("DELETE","/api/radius/mab-policies/policy-1");
  list=await f.call("GET","/api/radius/mab-policies");
  assert.equal(list.value.items.length,0);
 }finally{await f.db.close()}
});

test("MAB policy refuses missing NAS and invalid VLAN/mode combinations",async()=>{
 const f=await fixture();
 try{
  const base={id:"policy-1",nasProfileId:"nas-1",enabled:true,knownMode:"accept-static",knownVlan:null,unknownMode:"reject",guestVlan:null};
  await assert.rejects(()=>f.call("POST","/api/radius/mab-policies",{...base,nasProfileId:"missing"}),/not found/);
  await assert.rejects(()=>f.call("POST","/api/radius/mab-policies",{...base,knownMode:"accept-dynamic",knownVlan:null}),/invalid-known-vlan/);
  await assert.rejects(()=>f.call("POST","/api/radius/mab-policies",{...base,guestVlan:30}),/unexpected-guest-vlan/);
 }finally{await f.db.close()}
});

test("MAB policy updates fail closed when NAS is disabled or lacks MAB service",async()=>{
 const f=await fixture();
 try{
  const policy={id:"policy-guard",nasProfileId:"nas-1",enabled:true,knownMode:"reject",knownVlan:null,unknownMode:"reject",guestVlan:null};
  assert.equal((await f.call("POST","/api/radius/mab-policies",policy)).status,201);
  await f.pool.query("UPDATE radius_nas_profiles SET enabled=false WHERE id='nas-1'");
  await assert.rejects(()=>f.call("PUT","/api/radius/mab-policies/policy-guard",policy),/nas-mab-disabled/);
  await f.pool.query("UPDATE radius_nas_profiles SET enabled=true,services='[\"dot1x\"]'::jsonb WHERE id='nas-1'");
  await assert.rejects(()=>f.call("PUT","/api/radius/mab-policies/policy-guard",policy),/nas-mab-disabled/);
  await f.pool.query("UPDATE radius_nas_profiles SET services='[\"mab\"]'::jsonb WHERE id='nas-1'");
  assert.equal((await f.call("PUT","/api/radius/mab-policies/policy-guard",policy)).status,200);
 }finally{await f.db.close()}
});
