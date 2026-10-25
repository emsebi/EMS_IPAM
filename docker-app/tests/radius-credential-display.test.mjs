import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createModule} from '../../modules/radius-ops/backend/index.mjs';
import {cli} from '../../modules/radius-ops/backend/model.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backend=readFileSync(resolve(root,'modules/radius-ops/backend/index.mjs'),'utf8');


test('NAS config generation does not select stored secret and uses a placeholder',()=>{
  const block=backend.split("if(m==='POST'&&p===base+'/config')")[1]
    ?.split('const match=p.match')[0];
  assert.ok(block,'missing config route');
  assert.match(block,/SELECT d\.nas_ip::text AS "nasIp" FROM radius_ops_devices/);
  assert.doesNotMatch(block,/COALESCE|p\.secret|d\.secret|secret_profile_id/);
  assert.match(block,/secret:'SET_SHARED_SECRET_HERE'/);
});

test('generated Cisco and MikroTik CLI never include a real stored credential',()=>{
  for(const vendor of ['cisco-ios','cisco-legacy','mikrotik']){
    const value=cli({vendor,secret:'SET_SHARED_SECRET_HERE'},'192.0.2.5');
    assert.match(value,/SET_SHARED_SECRET_HERE/);
    assert.doesNotMatch(value,/real-secret-sentinel/);
  }
});


const id='00000000-0000-4000-8000-000000000001';
const secretRoute=`secret-profiles/${id}/reveal`,passwordRoute=`accounts/${id}/reveal-password`;
function fixture({rows,denyModule=false,failAudit=false}={}){
 const calls=[],audits=[],headers={},responses=[];
 const handler=createModule({
  pool:{async query(sql,params){calls.push({sql,params});return {rows:rows??[{id,name:'Example NAS',secret:'test-secret',username:'example-user',password:'test-password'}]};}},
  requireModuleAccess:async()=>{if(denyModule)throw Object.assign(Error('Module denied'),{status:403});},
  requireAdmin:actor=>{if(actor?.role!=='admin')throw Object.assign(Error('Admin required'),{status:403});},
  audit:async(...args)=>{if(failAudit)throw Error('Audit unavailable');audits.push(args);},
  json:(_res,status,body)=>{responses.push({status,body});return body;},
 });
 const res={setHeader:(name,value)=>{headers[name]=value;}};
 return {calls,audits,headers,responses,call:(route,{role='admin',method='POST'}={})=>handler.handle({method},res,new URL('http://localhost/api/radius-ops/'+route),role?{id:'admin-id',role}:null)};
}
test('administrator explicitly reveals a saved NAS Secret without caching or auditing its value',async()=>{
 const f=fixture(),body=await f.call(secretRoute);
 assert.equal(body.value,'test-secret');assert.equal(body.id,id);
 assert.deepEqual(f.calls[0].params,[id]);assert.match(f.headers['Cache-Control'],/no-store/);
 assert.equal(f.headers.Pragma,'no-cache');assert.equal(f.audits[0][1],'reveal');
 assert.equal(f.audits[0][2],'radius-secret-profile');assert.equal(JSON.stringify(f.audits).includes(body.value),false);
});
test('administrator explicitly reveals the saved RADIUS account password',async()=>{
 const f=fixture(),body=await f.call(passwordRoute);
 assert.equal(body.value,'test-password');assert.equal(body.name,'example-user');
 assert.deepEqual(f.calls[0].params,[id]);assert.match(f.calls[0].sql,/Cleartext-Password/);
 assert.match(f.headers['Cache-Control'],/no-store/);assert.equal(f.audits[0][2],'radius-user-password');
 assert.equal(JSON.stringify(f.audits).includes(body.value),false);
});
test('credential reveal denies non-admins and missing module access before reading stored values',async()=>{
 for(const route of [secretRoute,passwordRoute]){
  for(const role of [null,'viewer','support','helpdesk']){
   const f=fixture();await assert.rejects(f.call(route,{role}),{status:403});assert.equal(f.calls.length,0);assert.equal(f.responses.length,0);
  }
  const f=fixture({denyModule:true});await assert.rejects(f.call(route),{status:403});assert.equal(f.calls.length,0);
 }
});
test('credential reveal rejects GET and invalid IDs and reports missing values',async()=>{
 for(const route of [secretRoute,passwordRoute]){
  const f=fixture();await assert.rejects(f.call(route,{method:'GET'}),{status:404});assert.equal(f.calls.length,0);
  await assert.rejects(f.call(route.replace(id,'not-a-valid-id')),{status:400});assert.equal(f.calls.length,0);
  const absent=fixture({rows:[]});await assert.rejects(absent.call(route),{status:404});assert.equal(absent.responses.length,0);
 }
 const f=fixture({rows:[{id,username:'example-user',password:null}]});await assert.rejects(f.call(passwordRoute),{status:404});
});
test('failed reveal audit does not return a stored credential',async()=>{
 const f=fixture({failAudit:true});await assert.rejects(f.call(passwordRoute),/Audit unavailable/);assert.equal(f.responses.length,0);
});
