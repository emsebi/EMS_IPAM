import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase, migrateModuleSchemas } from "../server/migrations.mjs";
import { createModule } from "../../modules/branches/backend/index.mjs";

function adapter(db){const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0}};return {query,connect:async()=>({query,release(){}})}}
const moduleDir=fileURLToPath(new URL("../../modules/branches/",import.meta.url));

async function fixture(){
  const db=new PGlite(); const pool=adapter(db);
  await migrateDatabase(pool); await migrateModuleSchemas(pool,[{id:"branches",dir:moduleDir}]);
  await pool.query("INSERT INTO companies(id,name,kind) VALUES('co-a','Company A','company'),('co-b','Company B','company')");
  await pool.query("INSERT INTO companies(id,parent_company_id,name,kind) VALUES('br-a','co-a','Branch A','branch')");
  await pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('sp-a','br-a','LAN','10.10.0.0/24'),('sp-b','co-b','LAN','10.20.0.0/24')");
  await pool.query("INSERT INTO hosts(id,space_id,ip,name) VALUES('host-a','sp-a','10.10.0.1','Router A'),('host-b','sp-b','10.20.0.1','Other')");
  let response;
  const handler=createModule({pool,json:(_res,status,value)=>{response={status,value};return response},readBody:async(req)=>req.body,
    requireAdmin:()=>{},requireModuleAccess:async(_user,id)=>assert.equal(id,"branches"),audit:async()=>{},broadcast:()=>{}});
  const call=async(method,path,body)=>{const req={method,body};const url=new URL("http://x"+path);assert.equal(handler.match(req,url),true);await handler.handle(req,{},url,{role:"admin"});return response};
  return {db,pool,call};
}

const router={id:"r-a",companyId:"co-a",branchId:"br-a",inventoryHostId:"host-a",name:"Branch Router",
  managementAddress:"10.10.0.1",publicAddress:"203.0.113.10",vendor:"mikrotik",model:"CCR",notes:"",
  accessMethods:[{protocol:"ssh",port:22},{protocol:"winbox",port:8291}]};

test("module migration creates only router-owned storage and no duplicate branch table",async()=>{
 const f=await fixture(); try{
  assert.equal((await f.pool.query("SELECT to_regclass('public.branch_routers') AS x")).rows[0].x,"branch_routers");
  assert.equal((await f.pool.query("SELECT to_regclass('public.branch_records') AS x")).rows[0].x,null);
  const cols=(await f.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='branch_routers'")).rows.map(x=>x.column_name);
  assert.equal(cols.some(x=>/(secret|password|token|community|credential)/i.test(x)),false);
 } finally{await f.db.close()}
});

test("router CRUD accepts a host inside its selected branch",async()=>{
 const f=await fixture(); try{
  assert.equal((await f.call("POST","/api/branches/routers",router)).status,201);
  let list=await f.call("GET","/api/branches/routers");
  assert.equal(list.value.items[0].branchName,"Branch A");
  assert.equal(list.value.items[0].inventoryIp,"10.10.0.1");
  const updated=await f.call("PUT","/api/branches/routers/r-a",{...router,name:"Branch Router Updated",publicAddress:"203.0.113.11"});
  assert.equal(updated.value.item.name,"Branch Router Updated");
  await f.call("DELETE","/api/branches/routers/r-a");
  list=await f.call("GET","/api/branches/routers"); assert.equal(list.value.items.length,0);
 } finally{await f.db.close()}
});

test("router cannot attach to a branch or inventory host from another company",async()=>{
 const f=await fixture(); try{
  await assert.rejects(()=>f.call("POST","/api/branches/routers",{...router,companyId:"co-b"}),/Branch does not belong/);
  await assert.rejects(()=>f.call("POST","/api/branches/routers",{...router,inventoryHostId:"host-b"}),/another company or branch/);
 } finally{await f.db.close()}
});

test("standalone company router is allowed without a branch or IPAM host",async()=>{
 const f=await fixture(); try{
  const result=await f.call("POST","/api/branches/routers",{...router,id:"r-standalone",branchId:null,inventoryHostId:null,
    managementAddress:"router.example.test",publicAddress:null});
  assert.equal(result.status,201); assert.equal(result.value.item.branchId,null); assert.equal(result.value.item.inventoryHostId,null);
 } finally{await f.db.close()}
});

test("credential-like data is rejected before persistence",async()=>{
 const f=await fixture(); try{
  await assert.rejects(()=>f.call("POST","/api/branches/routers",{...router,password:"never"}),/forbidden-field/);
  await assert.rejects(()=>f.call("POST","/api/branches/routers",{...router,accessMethods:[{protocol:"ssh",port:22,community:"public"}]}),/invalid-access-method/);
 } finally{await f.db.close()}
});
