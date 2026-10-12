import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMac, validVlan, previewMabDecision } from '../../modules/radius/policy-preview.mjs';
const knownMacs = [{ mac: '02:00:00:00:00:50', enabled: true, vlan: 20 }];
const policy = { enabled: true, known: { mode: 'accept-static' }, unknown: { mode: 'reject' } };
const preview = (extra = {}) => previewMabDecision({ mac: knownMacs[0].mac, knownMacs, policy, ...extra });
test('MAC normalization and invalid group MACs', () => {
  for (const value of ['02:00:00:00:00:50', '02-00-00-00-00-50', '0200.0000.0050', '020000000050']) assert.equal(normalizeMac(value), '02:00:00:00:00:50');
  for (const value of ['', '00:00:00:00:00:00', '01:00:5e:00:00:01', null, 42]) assert.equal(normalizeMac(value), null);
});
test('VLAN validation', () => {
  for (const v of [1, '20', 4094]) assert.equal(validVlan(v), Number(v));
  for (const v of [0, 4095, '20 ', '0020', null, -1, 1.2]) assert.equal(validVlan(v), null);
});
test('deny by default and invalid input', () => {
  assert.equal(preview({ policy: {} }).decision, 'reject');
  assert.equal(preview({ policy: { enabled: true } }).reason, 'invalid-policy');
  assert.equal(preview({ mac: 'invalid' }).reason, 'invalid-mac');
  assert.equal(preview({ knownMacs: {} }).reason, 'invalid-inventory');
  assert.equal(preview({ switchId: {} }).reason, 'invalid-switch-id');
});
test('known MAC static and dynamic VLAN', () => {
  assert.deepEqual(preview().replyAttributes, {});
  assert.equal(preview().decision, 'accept');
  const result = preview({ policy: { ...policy, known: { mode: 'accept-dynamic' } } });
  assert.equal(result.replyAttributes['Tunnel-Private-Group-Id'], '20');
});
test('unknown MAC rejects unless guest VLAN explicitly configured', () => {
  assert.equal(preview({ mac: '02:00:00:00:00:51' }).reason, 'unknown-mac');
  assert.equal(preview({ mac: '02:00:00:00:00:51', policy: { ...policy, unknown: { mode: 'guest-vlan', vlan: 30 } } }).replyAttributes['Tunnel-Private-Group-Id'], '30');
});
test('duplicate and disabled MACs reject', () => {
  assert.equal(preview({ knownMacs: [...knownMacs, ...knownMacs] }).reason, 'ambiguous-mac');
  assert.equal(preview({ knownMacs: [{ ...knownMacs[0], enabled: false }] }).reason, 'mac-not-approved');
});
test('switch override and disabled switch', () => {
  const p = { ...policy, switchOverrides: { a: { known: { mode: 'accept-dynamic', vlan: 30 } }, b: { enabled: false } } };
  assert.equal(preview({ policy: p, switchId: 'a', knownMacs: [{ ...knownMacs[0], vlan: null }] }).replyAttributes['Tunnel-Private-Group-Id'], '30');
  assert.equal(preview({ policy: p, switchId: 'b' }).reason, 'switch-policy-disabled');
});

test('malformed NAS IDs and null overrides never inherit permissive guest policy', () => {
  const permissive = { ...policy, unknown: { mode: 'guest-vlan', vlan: 999 } };
  const mac = '02:00:00:00:00:51';
  for (const switchId of [null, 2, {}, [], '../bad', 'a'.repeat(65), ' sw-1', 'sw/1']) {
    assert.equal(preview({ mac, switchId, policy: permissive }).reason, 'invalid-switch-id');
  }
  for (const invalid of [null, [], false, { enabled: 'false' }]) {
    assert.equal(preview({ mac, switchId: 'sw-1', policy: { ...permissive, switchOverrides: { 'sw-1': invalid } } }).reason, 'invalid-policy');
  }
  assert.equal(preview({ mac, switchId: 'sw-1', policy: { ...permissive, switchOverrides: { 'sw-1': { enabled: false } } } }).reason, 'switch-policy-disabled');
});
