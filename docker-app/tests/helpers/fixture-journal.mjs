// Private append-only test-fixture evidence; no credentials or host payloads.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function writer(fd) {
  return {
    record(event) {
      fs.writeFileSync(fd, JSON.stringify({ ...event, observedAt: new Date().toISOString() }) + '\n');
      fs.fsyncSync(fd);
    },
    close() { fs.closeSync(fd); },
  };
}
export function createFixtureJournal(filename, runId) {
  assert.match(runId, uuid);
  const fd = fs.openSync(filename, 'wx', 0o600);
  const journal = writer(fd);
  try {
    journal.record({ kind: 'begin', version: 1, runId });
    const directory = fs.openSync(path.dirname(filename), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    return journal;
  } catch (error) { journal.close(); throw error; }
}
export function openFixtureJournal(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 65536, 'invalid private fixture journal');
    const text = fs.readFileSync(fd, 'utf8');
    assert.ok(text.endsWith('\n'), 'incomplete fixture journal');
    const events = text.trimEnd().split('\n').map(line => JSON.parse(line));
    const first = events.shift();
    assert.ok(first.kind === 'begin' && first.version === 1);
    assert.match(first.runId, uuid);
    const planned = new Map();
    const ids = new Set();
    for (const event of events) {
      assert.ok(Number.isFinite(Date.parse(event.observedAt)), 'missing evidence time');
      if (event.kind === 'creating') {
        assert.ok(['North', 'South'].some(label => event.name === 'EMS XLSX fixture ' + first.runId + ' ' + label));
        assert.ok(!planned.has(event.name), 'duplicate create intent');
        planned.set(event.name, { name: event.name, id: null });
      } else if (event.kind === 'created') {
        const entry = planned.get(event.name);
        assert.ok(entry && entry.id === null);
        assert.match(event.id, uuid);
        assert.ok(!ids.has(event.id));
        ids.add(event.id); entry.id = event.id;
      } else {
        assert.equal(event.kind, 'removed');
        const entry = [...planned.values()].find(item => item.id === event.id);
        assert.ok(entry && !entry.removed); entry.removed = true;
      }
    }
    return { ...writer(fd), runId: first.runId,
      owned: [...planned.values()].filter(item => item.id && !item.removed).map(({ id, name }) => ({ id, name })),
      unresolved: [...planned.values()].filter(item => !item.id).map(item => item.name) };
  } catch (error) { fs.closeSync(fd); throw error; }
}
