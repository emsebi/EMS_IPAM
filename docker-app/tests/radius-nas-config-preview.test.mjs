import test from 'node:test';
import assert from 'node:assert/strict';
import { previewNasClientConfig } from '../../modules/radius/nas-config-preview.mjs';

const devices = [{ id: 'sw-1', companyId: 'co-a' }];
const profile = { id: 'nas-1', companyId: 'co-a', deviceId: 'sw-1', name: 'Core', vendor: 'cisco',
  nasIp: '192.0.2.1', enabled: false, services: ['mab'] };
const preview = (patch = {}) => previewNasClientConfig({ ...profile, ...patch }, { devices });

test('generates a commented, inert FreeRADIUS client skeleton for manual review', () => {
  const result = preview();
  assert.equal(result.status, 'draft-only');
  assert.match(result.text, /#   ipaddr = 192\.0\.2\.1/);
  assert.match(result.text, /#   require_message_authenticator = yes/);
  assert.match(result.text, /# Profile enabled in inventory: no/);
  for (const line of result.text.split('\n').filter(Boolean)) assert.ok(line.startsWith('#'), line);
  assert.doesNotMatch(result.text, /^client /m);
  assert.doesNotMatch(result.text, /^secret =/m);
});

test('even enabled NAS profiles produce no active FreeRADIUS configuration', () => {
  const result = preview({ enabled: true });
  assert.equal(result.status, 'draft-only');
  assert.match(result.text, /# Profile enabled in inventory: yes/);
  assert.doesNotMatch(result.text, /\nclient |\n\s+secret =/);
});

test('rejects unsupported fields and cannot echo credentials into output', () => {
  const result = preview({ secret: 'super-secret-123' });
  assert.equal(result.status, 'invalid');
  assert.equal(result.text, '');
  assert.doesNotMatch(JSON.stringify(result), /super-secret-123/);
});

test('cannot emit config for cross-company or invalid NAS addresses', () => {
  for (const patch of [{ companyId: 'co-b' }, { nasIp: '127.0.0.1' }, { nasIp: '192.0.2.1\nclient attacker' }]) {
    const result = preview(patch);
    assert.equal(result.status, 'invalid');
    assert.equal(result.text, '');
  }
});

test('client label encoding does not collide on punctuation', () => {
  const a = preview({ id: 'sw.1' }).text.match(/# client (\S+)/)?.[1];
  const b = preview({ id: 'sw-1' }).text.match(/# client (\S+)/)?.[1];
  assert.notEqual(a, b);
});
