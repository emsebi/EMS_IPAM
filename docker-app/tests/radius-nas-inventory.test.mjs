import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNasIp, prepareNasProfile, prepareNasInventory } from '../../modules/radius/nas-inventory.mjs';

const devices = [{ id: 'sw-1', companyId: 'co-a' }, { id: 'sw-2', companyId: 'co-b' }];
const nas = { id: 'nas-1', companyId: 'co-a', deviceId: 'sw-1', name: 'Access Switch',
  vendor: 'cisco', nasIp: '192.0.2.10', enabled: false, services: ['mab', 'dot1x'] };
const prepare = (patch = {}, inventory = devices) => prepareNasProfile({ ...nas, ...patch }, { devices: inventory });

test('NAS profile remains explicitly disabled and never stores a shared secret', () => {
  const result = prepare();
  assert.equal(result.ok, true);
  assert.equal(result.value.enabled, false);
  assert.deepEqual(result.value.services, ['dot1x', 'mab']);
  assert.equal(result.value.authPort, 1812);
  assert.equal(result.value.acctPort, 1813);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('literal NAS addresses only; reject loopback, multicast, link-local, CIDR and URL', () => {
  for (const value of ['0.0.0.0', '127.0.0.1', '224.0.0.1', '169.254.1.2', '255.255.255.255',
    '::', '::1', 'ff02::1', 'fe80::1', '::ffff:192.0.2.1', 'fe80::1%eth0',
    'switch.example', '192.0.2.1/32', 'https://192.0.2.1', '192.0.2.999', ' 192.0.2.1']) {
    assert.equal(normalizeNasIp(value), null, value);
  }
  assert.equal(normalizeNasIp('192.0.2.10'), '192.0.2.10');
  assert.equal(normalizeNasIp('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeNasIp('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(normalizeNasIp('0:0:0:0:0:ffff:c000:201'), null);
});

test('cannot implicitly enable a NAS or accept string booleans', () => {
  assert.ok(prepare({ enabled: undefined }).issues.includes('invalid-enabled'));
  assert.ok(prepare({ enabled: 'false' }).issues.includes('invalid-enabled'));
  assert.equal(prepare({ enabled: true }).value.enabled, true);
});

test('reject credential-like and arbitrary fields instead of accidentally persisting them', () => {
  for (const key of ['secret', 'secretRef', 'password', 'token', 'notes', 'unexpected']) {
    const result = prepare({ [key]: 'do-not-store' });
    assert.equal(result.ok, false, key);
    assert.ok(result.issues.includes('unsupported-field'));
    assert.equal(result.value, null);
  }
});

test('reject malformed service lists, vendors and ports', () => {
  for (const services of [[], ['mab', 'mab'], ['eap'], 'mab', ['mab', 7], null]) {
    assert.ok(prepare({ services }).issues.includes('invalid-services'));
  }
  for (const vendor of ['juniper', 'Cisco', null]) assert.ok(prepare({ vendor }).issues.includes('invalid-vendor'));
  for (const patch of [{ authPort: '1812' }, { acctPort: 0 }, { authPort: 1813 }, { authPort: 65536 }]) {
    assert.ok(prepare(patch).issues.includes('invalid-ports'));
  }
});

test('device references must be unambiguous and company-scoped', () => {
  assert.ok(prepare({ deviceId: 'sw-missing' }).issues.includes('invalid-device-reference'));
  assert.ok(prepare({ companyId: 'co-b' }).issues.includes('cross-company-device'));
  assert.ok(prepare({}, [...devices, devices[0]]).issues.includes('invalid-device-reference'));
  assert.ok(prepare({}, null).issues.includes('invalid-device-inventory'));
});

test('reject prototype-polluted, accessor-bearing and array records', () => {
  assert.equal(prepareNasProfile([], { devices }).ok, false);
  assert.equal(prepareNasProfile(Object.create({ enabled: true }), { devices }).ok, false);
  const withGetter = { ...nas };
  Object.defineProperty(withGetter, 'enabled', { enumerable: true, get: () => true });
  assert.equal(prepareNasProfile(withGetter, { devices }).ok, false);
  assert.equal(prepare({}, [{ ...devices[0], get id() { return 'sw-1'; } }]).ok, false);
});

test('accept null-prototype JSON-like records', () => {
  const input = Object.assign(Object.create(null), nas);
  const inventory = devices.map((device) => Object.assign(Object.create(null), device));
  assert.equal(prepareNasProfile(input, { devices: inventory }).ok, true);
});

test('inventory rejects duplicate source IPs across companies and duplicate IDs', () => {
  const other = { ...nas, id: 'nas-2', companyId: 'co-b', deviceId: 'sw-2' };
  const duplicateIp = prepareNasInventory({ profiles: [nas, other], devices });
  assert.equal(duplicateIp.ok, false);
  assert.equal(duplicateIp.profiles.length, 0);
  assert.ok(duplicateIp.issues.some((issue) => issue.reasons.includes('duplicate-nas-ip')));
  assert.ok(prepareNasInventory({ profiles: [nas, { ...other, id: 'nas-1', nasIp: '192.0.2.11' }], devices })
    .issues.some((issue) => issue.reasons.includes('duplicate-id')));
});

test('inventory catches equivalent IPv6 source addresses across tenants', () => {
  const first = { ...nas, nasIp: '2001:db8::1' };
  const second = { ...nas, id: 'nas-2', companyId: 'co-b', deviceId: 'sw-2', nasIp: '2001:0db8:0:0:0:0:0:1' };
  const result = prepareNasInventory({ profiles: [first, second], devices });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.reasons.includes('duplicate-nas-ip')));
});

test('inventory rejects multiple profiles for one device', () => {
  const result = prepareNasInventory({ profiles: [nas, { ...nas, id: 'nas-2', nasIp: '192.0.2.11' }], devices });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.reasons.includes('duplicate-device')));
});

test('valid inventory keeps company separation and sanitized output', () => {
  const result = prepareNasInventory({ profiles: [nas, { ...nas, id: 'nas-2', nasIp: '2001:db8::2', companyId: 'co-b', deviceId: 'sw-2' }], devices });
  assert.equal(result.ok, true);
  assert.equal(result.profiles.length, 2);
  assert.equal(result.issues.length, 0);
});

test('malformed inventory fails without partial acceptance', () => {
  assert.deepEqual(prepareNasInventory({ profiles: 'bad', devices }), { ok: false, profiles: [], issues: ['invalid-inventory'] });
  assert.equal(prepareNasInventory({ profiles: [nas, { ...nas, id: 'bad!', nasIp: '192.0.2.11' }], devices }).profiles.length, 0);
});
