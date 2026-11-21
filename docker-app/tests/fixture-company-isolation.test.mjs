import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { assertFixtureCompanyIsolation } from './helpers/fixture-company-isolation.mjs';

test('Company cleanup preflight preserves hierarchy and grants, including archived/inactive records', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`
    INSERT INTO companies(id,name) VALUES ('fixture','Fixture'), ('outside','Outside');
    INSERT INTO address_spaces(id,company_id,name,cidr) VALUES
      ('f','fixture','LAN','192.0.2.0/24'), ('o','outside','LAN','192.0.2.0/24');
    INSERT INTO users(id,username,password_hash,role,active) VALUES ('reader','reader','synthetic','viewer',false);
    INSERT INTO user_company_access VALUES ('reader','outside');
    INSERT INTO user_space_access VALUES ('reader','o');
  `);
  const snapshot = async () => {
    const rows = [];
    for (const table of ['companies', 'address_spaces', 'users', 'user_company_access', 'user_space_access']) {
      rows.push((await db.query('SELECT * FROM ' + table + ' ORDER BY 1,2')).rows);
    }
    return rows;
  };
  for (const archived of [false, true]) {
    await db.query('UPDATE companies SET deleted_at=CASE WHEN $1 THEN now() ELSE NULL END', [archived]);
    await db.query('UPDATE address_spaces SET deleted_at=CASE WHEN $1 THEN now() ELSE NULL END', [archived]);
    await assertFixtureCompanyIsolation(db, 'fixture'); // Unrelated grants do not block.
    for (const [add, remove, message] of [
      ["UPDATE companies SET parent_company_id='fixture' WHERE id='outside'", "UPDATE companies SET parent_company_id=NULL WHERE id='outside'", /child companies/],
      ["INSERT INTO user_company_access VALUES ('reader','fixture')", "DELETE FROM user_company_access WHERE company_id='fixture'", /Company grants/],
      ["INSERT INTO user_space_access VALUES ('reader','f')", "DELETE FROM user_space_access WHERE space_id='f'", /Space grants/],
    ]) {
      await db.exec(add);
      const before = await snapshot();
      await db.exec('BEGIN READ ONLY');
      try {
        await assert.rejects(assertFixtureCompanyIsolation(db, 'fixture'), message);
        assert.deepEqual(await snapshot(), before);
      } finally { await db.exec('ROLLBACK'); }
      await db.exec(remove);
      await assertFixtureCompanyIsolation(db, 'fixture');
    }
  }
});
