import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDeviceAdminProfile } from '../../modules/radius/admin-profile-preview.mjs';
const preview = (vendor, profile) => previewDeviceAdminProfile({ vendor, profile });
test('Cisco privilege levels 0-15 are displayed for review', () => {
  for (const privilege of [0, 1, 7, 15]) {
    const result = preview('cisco', { enabled: true, ciscoPrivilege: privilege });
    assert.equal(result.decision, 'preview');
    assert.equal(result.effectivePrivilege, privilege);
    assert.equal(result.replyAttributes['Cisco-AVPair'], `shell:priv-lvl=${privilege}`);
  }
});
test('invalid Cisco privilege fails closed', () => {
  for (const privilege of [-1, 16, '15', 1.5, null, NaN]) {
    assert.equal(preview('cisco', { enabled: true, ciscoPrivilege: privilege }).reason, 'invalid-cisco-privilege');
  }
});
test('MikroTik group preview', () => {
  const result = preview('mikrotik', { enabled: true, mikrotikGroup: 'read-only' });
  assert.equal(result.decision, 'preview');
  assert.deepEqual(result.replyAttributes, { 'Mikrotik-Group': 'read-only' });
});
test('malformed MikroTik groups are rejected', () => {
  for (const group of ['', 'group with spaces', 'full;admin', 'full\nX', '../full', 'x'.repeat(33), null, 5]) {
    assert.equal(preview('mikrotik', { enabled: true, mikrotikGroup: group }).reason, 'invalid-mikrotik-group');
  }
});
test('disabled profiles and unsupported vendors reject', () => {
  assert.deepEqual(preview('cisco', { enabled: false, ciscoPrivilege: 15 }), {
    decision: 'reject', reason: 'profile-disabled', replyAttributes: {},
  });
  assert.equal(preview('cisco', null).reason, 'profile-disabled');
  assert.equal(preview('juniper', { enabled: true }).reason, 'unsupported-vendor');
});
