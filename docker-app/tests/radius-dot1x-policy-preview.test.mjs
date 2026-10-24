import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDot1xDecision } from '../../modules/radius/dot1x-policy-preview.mjs';

const nasProfile = { id: 'nas-1', companyId: 'co-a', deviceId: 'sw-1', name: 'SW1', vendor: 'cisco',
  nasIp: '192.0.2.10', enabled: true, services: ['dot1x'], authPort: 1812, acctPort: 1813 };
const principals = [{ id: 'user-1', companyId: 'co-a', enabled: true, roles: ['employees'] }];
const authentication = { status: 'verified', principalId: 'user-1', source: 'trusted-eap' };
const policy = { enabled: true, assignments: [{ role: 'employees', mode: 'accept-dynamic', vlan: 30 }] };
const preview = (patch = {}) => previewDot1xDecision({ companyId: 'co-a', authentication, nasProfile, principals, policy, ...patch });

test('verified EAP identity with exactly one approved role previews dynamic VLAN', () => {
  assert.deepEqual(preview(), { decision: 'accept', classification: 'principal', reason: 'role-dynamic-vlan',
    replyAttributes: { 'Tunnel-Type': 'VLAN', 'Tunnel-Medium-Type': 'IEEE-802', 'Tunnel-Private-Group-Id': '30' } });
});

test('failed EAP never gets guest access or fallback to MAB', () => {
  const result = preview({ authentication: { ...authentication, status: 'failed' } });
  assert.equal(result.decision, 'reject');
  assert.equal(result.reason, 'eap-not-verified');
  assert.deepEqual(result.replyAttributes, {});
});

test('no trusted EAP source or missing verified status fails closed', () => {
  for (const auth of [null, {}, { ...authentication, source: 'client-assertion' }, { ...authentication, status: true },
    { ...authentication, principalId: 'bad!' }]) assert.equal(preview({ authentication: auth }).decision, 'reject');
});

test('disabled or unrelated NAS cannot authorize 802.1X', () => {
  for (const nas of [{ ...nasProfile, enabled: false }, { ...nasProfile, companyId: 'co-b' },
    { ...nasProfile, services: ['mab'] }, { ...nasProfile, nasIp: '127.0.0.1' },
    { ...nasProfile, authPort: '1812' }, null]) assert.equal(preview({ nasProfile: nas }).reason, 'invalid-nas');
});

test('disabled, unknown, duplicated and cross-company identities reject', () => {
  assert.equal(preview({ principals: [{ ...principals[0], enabled: false }] }).reason, 'principal-disabled');
  assert.equal(preview({ authentication: { ...authentication, principalId: 'unknown' } }).reason, 'unknown-principal');
  assert.equal(preview({ principals: [...principals, principals[0]] }).reason, 'ambiguous-principal');
  assert.equal(preview({ principals: [{ ...principals[0], companyId: 'co-b' }] }).reason, 'cross-company-principal');
});

test('no role or ambiguous multiple matching roles rejects instead of guessing', () => {
  assert.equal(preview({ principals: [{ ...principals[0], roles: ['visitors'] }] }).reason, 'no-matching-role');
  assert.equal(preview({ principals: [{ ...principals[0], roles: ['employees', 'admin'] }], policy: { enabled: true,
    assignments: [...policy.assignments, { role: 'admin', mode: 'accept-static' }] } }).reason, 'ambiguous-role');
});

test('static VLAN and explicit reject mode have deterministic previews', () => {
  assert.deepEqual(preview({ policy: { enabled: true, assignments: [{ role: 'employees', mode: 'accept-static' }] } }).replyAttributes, {});
  assert.equal(preview({ policy: { enabled: true, assignments: [{ role: 'employees', mode: 'reject' }] } }).reason, 'role-rejected');
});

test('invalid VLANs, duplicate rules and unused invalid rules fail closed', () => {
  for (const rules of [[{ role: 'employees', mode: 'accept-dynamic', vlan: 4095 }],
    [policy.assignments[0], policy.assignments[0]],
    [policy.assignments[0], { role: 'unused', mode: 'accept-dynamic', vlan: null }],
    [{ role: 'employees', mode: 'accept-static', vlan: 20 }]]) {
    assert.equal(preview({ policy: { enabled: true, assignments: rules } }).reason, 'invalid-policy');
  }
});

test('malformed principals and injected extra fields are rejected', () => {
  assert.equal(preview({ principals: [{ ...principals[0], roles: ['employees', 'employees'] }] }).reason, 'invalid-principals');
  assert.equal(preview({ authentication: { ...authentication, password: 'secret' } }).reason, 'invalid-authentication');
  assert.equal(preview({ policy: { ...policy, guestVlan: 20 } }).reason, 'policy-disabled');
});

test('null-prototype JSON-like inputs remain supported', () => {
  const obj = (data) => Object.assign(Object.create(null), data);
  assert.equal(previewDot1xDecision(obj({ companyId: 'co-a', authentication: obj(authentication), nasProfile: obj(nasProfile),
    principals: [obj(principals[0])], policy: obj({ enabled: true, assignments: [obj(policy.assignments[0])] }) })).decision, 'accept');
});
