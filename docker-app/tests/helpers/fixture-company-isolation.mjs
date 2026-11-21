// SELECT-only rehearsal guard, not a lock against concurrent application writes.
// Fixture creation never creates child companies, grants or Personnel: any such row blocks cleanup.
import assert from 'node:assert/strict';

export async function assertFixtureCompanyIsolation(db, companyId) {
  assert.ok(typeof companyId === 'string' && companyId, 'fixture company ID required');
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*)::int FROM companies WHERE parent_company_id = $1) AS children,
      (SELECT count(*)::int FROM user_company_access WHERE company_id = $1) AS company_grants,
      (SELECT count(*)::int FROM user_space_access access
        JOIN address_spaces space ON space.id = access.space_id
        WHERE space.company_id = $1) AS space_grants,
      (SELECT count(*)::int FROM personnel WHERE company_id = $1) AS personnel
  `, [companyId]);
  assert.equal(rows[0].children, 0, 'child companies reference fixture; refusing cleanup');
  assert.equal(rows[0].company_grants, 0, 'Company grants reference fixture; refusing cleanup');
  assert.equal(rows[0].space_grants, 0, 'Space grants reference fixture; refusing cleanup');
  assert.equal(rows[0].personnel, 0, 'Personnel reference fixture; refusing cleanup');
}
