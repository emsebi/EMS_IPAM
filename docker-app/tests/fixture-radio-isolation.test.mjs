import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { assertFixtureRadioIsolation } from './helpers/fixture-radio-isolation.mjs';

test('Radio cleanup preflight is read-only and includes archived external children', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`
    INSERT INTO companies(id,name) VALUES ('fixture','Fixture'), ('outside','Outside');
    INSERT INTO address_spaces(id,company_id,name,cidr) VALUES
      ('f','fixture','LAN','192.0.2.0/24'), ('o','outside','LAN','192.0.2.0/24');
    INSERT INTO hosts(id,space_id,ip) VALUES ('parent','f','192.0.2.1'), ('child','o','192.0.2.1');
  `);
  await assertFixtureRadioIsolation(db, 'fixture');
  for (const archived of [false, true]) {
    await db.query('UPDATE hosts SET radio_parent_host_id=$1, deleted_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$3', ['parent', archived, 'child']);
    const before = (await db.query('SELECT * FROM hosts ORDER BY id')).rows;
    await db.exec('BEGIN READ ONLY');
    try {
      await assert.rejects(assertFixtureRadioIsolation(db, 'fixture'), /external Radio children/);
      assert.deepEqual((await db.query('SELECT * FROM hosts ORDER BY id')).rows, before);
    } finally { await db.exec('ROLLBACK'); }
  }
  await db.query('UPDATE hosts SET radio_parent_host_id=NULL WHERE id=$1', ['child']);
  await assertFixtureRadioIsolation(db, 'fixture');
});
