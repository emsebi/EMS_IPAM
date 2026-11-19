// Shared HTTP assertions for synthetic fixtures. This does NOT provision fixtures,
// authorize live execution, handle credentials, or clean up an installed database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function exerciseXlsxImport(call, destination, sibling) {
  for (const site of [destination, sibling]) {
    assert.ok(site && typeof site.companyId === 'string' && site.companyId.length,
      'explicit fixture companyId required');
    assert.ok(typeof site.spaceId === 'string' && site.spaceId.length,
      'explicit fixture spaceId required');
  }
  assert.notEqual(destination.companyId, sibling.companyId, 'distinct fixture branches required');
  assert.notEqual(destination.spaceId, sibling.spaceId, 'distinct fixture Spaces required');
  const read = site => call('GET', '/api/spaces/' + encodeURIComponent(site.spaceId) + '/data');
  const before = await read(destination);
  const other = await read(sibling);
  for (const [site, data] of [[destination, before], [sibling, other]]) {
    assert.deepEqual([data.space.id, data.space.companyId, data.space.cidr],
      [site.spaceId, site.companyId, '192.0.2.0/24'], 'fixture destination identity mismatch');
    assert.ok(data.hosts.some(host => host.ip === '192.0.2.50'), 'fixture existing host required');
  }
  assert.ok(!before.hosts.some(host => ['192.0.2.94', '192.0.2.95', '203.0.113.1'].includes(host.ip)),
    'fixture import addresses must be unused in the destination');
  const original = before.hosts.find(host => host.ip === '192.0.2.50');
  const untouched = before.hosts.filter(host => host.id !== original.id);
  // Existing two-sheet openpyxl fixture: synthetic RFC 5737 addresses only.
  const workbook = await fs.readFile(new URL('../fixtures/ipam-two-sheets.xlsx', import.meta.url));
  const body = { destinationSpaceId: destination.spaceId, filename: 'ipam-two-sheets.xlsx',
    base64: workbook.toString('base64'), mode: 'update' };
  const root = '/api/imports/ipam/';
  const preview = await call('POST', root + 'preview', body);
  assert.deepEqual(preview.summary, { total: 3, valid: 2, invalid: 1, existing: 1, newRecords: 1 });
  assert.deepEqual(preview.sample, [
    { ip: '192.0.2.50', name: 'سوئیچ آزمایشی', notes: 'طبقه اول & اتاق <۱>' },
    { ip: '192.0.2.94', name: 'رادیوی آزمایشی', notes: 'خط اول\nخط دوم' },
  ]);
  assert.deepEqual(await read(destination), before, 'preview must not write');
  assert.deepEqual(await read(sibling), other, 'preview must not change the sibling');
  const result = await call('POST', root + 'commit', body);
  assert.deepEqual(result.result, { total: 3, invalid: 1, created: 1, updated: 1, skipped: 0 });
  const after = await read(destination);
  for (const row of preview.sample) {
    const host = after.hosts.find(item => item.ip === row.ip);
    assert.ok(host, 'expected imported fixture host');
    assert.deepEqual([host.name, host.notes], [row.name, row.notes]);
  }
  const updated = after.hosts.find(host => host.ip === original.ip);
  assert.deepEqual([updated.id, updated.mac], [original.id, original.mac]);
  assert.deepEqual(after.hosts.filter(host => !['192.0.2.50', '192.0.2.94'].includes(host.ip)),
    untouched, 'unrelated destination hosts must remain identical');
  assert.ok(!after.hosts.some(host => ['192.0.2.95', '203.0.113.1'].includes(host.ip)));
  const retry = await call('POST', root + 'commit', { ...body, mode: 'skip' });
  assert.deepEqual(retry.result, { total: 3, invalid: 1, created: 0, updated: 0, skipped: 2 });
  assert.deepEqual(await read(destination), after);
  assert.deepEqual(after.space, before.space);
  assert.deepEqual(await read(sibling), other, 'same-IP sibling records must remain identical');
  return { destinationSpaceId: destination.spaceId, siblingSpaceId: sibling.spaceId,
    existingHostId: original.id, createdHostId: after.hosts.find(host => host.ip === '192.0.2.94').id };
}
