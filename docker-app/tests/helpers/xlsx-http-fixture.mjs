// Disposable-database rehearsal only. A live runner still needs a durable
// recovery for ambiguous replies, private preservation checks and fixed loopback transport.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFixtureJournal, openFixtureJournal } from './fixture-journal.mjs';

export async function withXlsxHttpFixture(call, exercise, { journalPath } = {}) {
  const runId = randomUUID();
  const marker = 'EMS XLSX fixture ' + runId;
  const owned = [];
  const sites = [];
  const errors = [];
  let result, journal;
  try {
    if (journalPath) journal = createFixtureJournal(journalPath, runId);
    for (const [label, mac] of [['North', '02:00:00:00:10:01'], ['South', '02:00:00:00:10:02']]) {
      const name = marker + ' ' + label;
      journal?.record({ kind: 'creating', name });
      const company = await call('POST', '/api/companies', { name, kind: 'branch' }, 201);
      assert.ok(typeof company.id === 'string' && company.id, 'created company ID required');
      // Record each successful create before the next operation can fail.
      owned.push({ id: company.id, name });
      journal?.record({ kind: 'created', id: company.id, name });
      const space = await call('POST', '/api/spaces', {
        companyId: company.id, name: 'Synthetic XLSX LAN', cidr: '192.0.2.0/24',
      }, 201);
      assert.ok(typeof space.id === 'string' && space.id, 'created Space ID required');
      const site = { companyId: company.id, spaceId: space.id };
      sites.push(site);
      await call('PUT', '/api/hosts', { spaceId: site.spaceId, ip: '192.0.2.50', name: label, mac });
    }
    await call('PUT', '/api/hosts', { spaceId: sites[0].spaceId, ip: '192.0.2.93', name: 'Unrelated destination sentinel' });
    await call('PUT', '/api/hosts', { spaceId: sites[1].spaceId, ip: '192.0.2.94', name: 'Same-IP sibling sentinel' });
    result = await exercise(...sites);
  } catch (error) {
    errors.push(error);
  } finally {
    try { errors.push(...await cleanupRecorded(call, owned, journal)); }
    finally { journal?.close(); }
  }
  if (errors.length) throw new AggregateError(errors, 'XLSX fixture run or cleanup failed');
  return result;
}

async function cleanupRecorded(call, owned, journal) {
  const errors = [];
  for (const company of [...owned].reverse()) {
    try {
      const current = await call('GET', '/api/companies/' + encodeURIComponent(company.id));
      assert.deepEqual([current.company.id, current.company.name], [company.id, company.name],
        'fixture ownership changed; refusing cleanup');
      await call('DELETE', '/api/companies/' + encodeURIComponent(company.id));
      await call('DELETE', '/api/trash/company/' + encodeURIComponent(company.id));
      journal?.record({ kind: 'removed', id: company.id });
    } catch (error) { errors.push(error); }
  }
  return errors;
}

export async function recoverXlsxHttpFixture(call, journalPath) {
  const journal = openFixtureJournal(journalPath);
  try {
    assert.equal(journal.unresolved.length, 0, 'unresolved create response; manual reconciliation required');
    const errors = await cleanupRecorded(call, journal.owned, journal);
    if (errors.length) throw new AggregateError(errors, 'XLSX fixture recovery failed');
  } finally { journal.close(); }
}
