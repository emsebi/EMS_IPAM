// Read-only preflight for the fixture runner; this is not a concurrency lock.
// Other incoming references and full preservation evidence remain separate gates.
import assert from 'node:assert/strict';

export async function assertFixtureRadioIsolation(db, companyId) {
  assert.ok(typeof companyId === 'string' && companyId, 'fixture company ID required');
  const { rows } = await db.query(`
    SELECT count(*)::int AS count
    FROM hosts child
    JOIN address_spaces child_space ON child_space.id = child.space_id
    JOIN hosts parent ON parent.id = child.radio_parent_host_id
    JOIN address_spaces parent_space ON parent_space.id = parent.space_id
    WHERE parent_space.company_id = $1 AND child_space.company_id <> $1
  `, [companyId]);
  assert.equal(rows[0].count, 0, 'external Radio children reference fixture; refusing cleanup');
}
