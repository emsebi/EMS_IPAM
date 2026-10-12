import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEndpoint, prepareBranch, prepareRouter, groupRoutersByBranch } from '../../modules/branches/model.mjs';

const branch = { id: 'branch-1', companyId: 'company-1', name: 'North Office', code: 'NO' };
const router = { id: 'router-1', companyId: 'company-1', branchId: 'branch-1', name: 'Edge Router', managementAddress: '10.0.0.1', publicAddress: '203.0.113.10', vendor: 'mikrotik', accessMethods: [{ protocol: 'ssh', port: 22 }, { protocol: 'winbox', port: 8291 }] };

test('branch normalization preserves Unicode labels and trims fields without mutating input', () => {
  const input = Object.freeze({ ...branch, name: ' شعبه شمال ' });
  const result = prepareBranch(input);
  assert.equal(result.ok, true); assert.equal(result.value.name, 'شعبه شمال'); assert.equal(input.name, ' شعبه شمال '); assert.equal(result.value.address, '');
});
test('branch requires a valid company and rejects secret-like fields', () => {
  assert.ok(prepareBranch({ ...branch, companyId: '' }).issues.includes('invalid-company-id'));
  assert.ok(prepareBranch({ ...branch, password: 'never-store' }).issues.includes('forbidden-field:password'));
  assert.ok(prepareBranch({ ...branch, notes: 'a\nb' }).issues.includes('invalid-notes')); assert.equal(prepareBranch([]).ok, false);
});
test('endpoint normalization accepts IP/DNS but not URLs, CIDR or host:port', () => {
  assert.equal(normalizeEndpoint('Router.Example.COM'), 'router.example.com'); assert.equal(normalizeEndpoint('2001:db8::1'), '2001:db8::1');
  for (const input of ['http://router.local','10.0.0.1/24','10.0.0.1:22','999.999.999.999','router..local','a b','']) assert.equal(normalizeEndpoint(input), null, input);
});
test('router branch links are company-scoped and standalone routers are allowed', () => {
  assert.equal(prepareRouter(router,[branch]).ok,true); assert.equal(prepareRouter({...router,branchId:null},[]).ok,true);
  assert.ok(prepareRouter({...router,companyId:'company-2'},[branch]).issues.includes('cross-company-branch'));
});
test('router methods describe protocol/port only and publicAddress must be IP', () => {
  assert.ok(prepareRouter({...router,accessMethods:[{protocol:'ssh',port:22,secret:'x'}]},[branch]).issues.includes('invalid-access-method'));
  assert.ok(prepareRouter({...router,publicAddress:'example.com'},[branch]).issues.includes('invalid-public-address'));
  assert.equal(prepareRouter({...router,publicAddress:'2001:db8::1'},[branch]).ok,true);
});
test('router may link to IPAM host ID without credentials', () => {
  const result=prepareRouter({...router,inventoryHostId:'host-123'},[branch]); assert.equal(result.ok,true); assert.equal(result.value.inventoryHostId,'host-123');
  assert.ok(prepareRouter({...router,inventoryHostId:'../bad'},[branch]).issues.includes('invalid-inventory-host-id'));
});
test('UI grouping keeps companies separate and unassigned routers visible', () => {
  const result=groupRoutersByBranch({branches:[branch],routers:[{...router,name:'Zulu'},{...router,id:'router-2',name:'Alpha'},{...router,id:'router-3',branchId:null,name:'Unassigned'}],companyId:'company-1'});
  assert.equal(result.ok,true); assert.deepEqual(result.groups[0].routers.map(x=>x.name),['Alpha','Zulu']); assert.deepEqual(result.unassigned.map(x=>x.name),['Unassigned']);
});
