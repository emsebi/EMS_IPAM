import test from 'node:test';
import assert from 'node:assert/strict';
import { auditBranchRouterLinks } from '../../modules/branches/integrity.mjs';
const branch={id:'b1',companyId:'c1',name:'North'},host={id:'h1',companyId:'c1',ip:'10.0.0.1'},router={id:'r1',companyId:'c1',branchId:'b1',inventoryHostId:'h1'};
const audit=(changes={})=>auditBranchRouterLinks({branches:[branch],routers:[router],hosts:[host],...changes});
const codes=(r)=>r.issues.map(i=>i.code);
test('valid same-company links pass',()=>assert.deepEqual(audit(),{ok:true,issues:[]}));
test('unassigned routers remain valid',()=>assert.equal(audit({routers:[{...router,branchId:null,inventoryHostId:''}]}).ok,true));
test('missing and cross-company references are reported',()=>{
 assert.deepEqual(codes(audit({branches:[],hosts:[]})),['missing-branch','missing-host']);
 assert.deepEqual(codes(audit({branches:[{...branch,companyId:'c2'}],hosts:[{...host,companyId:'c2'}]})),['cross-company-branch','cross-company-host']);
});
test('duplicate identifiers fail closed',()=>{
 const r=audit({branches:[branch,{...branch}],routers:[router,{...router}],hosts:[host,{...host}]});
 assert.deepEqual(codes(r),['duplicate-branch-id','duplicate-router-id','duplicate-host-id']);
});
test('malformed collections and references fail closed',()=>{
 assert.deepEqual(codes(audit({branches:{}})),['invalid-inventory']);
 assert.deepEqual(codes(audit({routers:[{...router,branchId:'__proto__',inventoryHostId:{}}]})),['invalid-branch-reference','invalid-host-reference']);
});
