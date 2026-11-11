import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { migrateDatabase } from '../server/migrations.mjs';

const domainMigration = await readFile(new URL('../server/migrations/002-default-routing-domains.sql', import.meta.url), 'utf8');

const seed = `
  INSERT INTO companies(id,name) VALUES ('a','Branch A'), ('b','Branch B'), ('empty','Empty branch');
  INSERT INTO address_spaces(id,company_id,name,cidr,deleted_at) VALUES
    ('a1','a','LAN','192.0.2.0/24',NULL), ('b1','b','LAN','192.0.2.0/24',NULL),
    ('old','a','Archive','198.51.100.0/24',now());
  INSERT INTO hosts(id,space_id,ip) VALUES ('ha','a1','192.0.2.10'), ('hb','b1','192.0.2.10');
  INSERT INTO prefixes(id,space_id,name,cidr) VALUES ('pa','a1','LAN','192.0.2.0/25'), ('pb','b1','LAN','192.0.2.0/25');
  INSERT INTO users(id,username,password_hash,role) VALUES ('reader','reader','fixture','viewer');
  INSERT INTO user_space_access VALUES ('reader','b1');
  INSERT INTO user_company_access VALUES ('reader','a');
`;

async function legacyRows(db) {
  const snapshot = {};
  for (const table of ['companies', 'address_spaces', 'hosts', 'prefixes', 'users', 'user_space_access', 'user_company_access']) {
    const result = await db.query(`SELECT to_jsonb(r) - 'routing_domain_id' AS legacy FROM ${table} r ORDER BY legacy`);
    snapshot[table] = result.rows;
  }
  return snapshot;
}

test('MS-03 additive upgrade preserves legacy Spaces, grants and old writers across rollback and retry', async t => {
  const connectionString = process.env.EMS_TEST_POSTGRES_URL;
  const db = connectionString ? new pg.Client({ connectionString }) : new PGlite();
  if (connectionString) await db.connect();
  t.after(() => connectionString ? db.end() : db.close());
  const exec = sql => connectionString ? db.query(sql) : db.exec(sql);
  const rows = async sql => (await db.query(sql)).rows;
  const schema = 'ms03_' + randomUUID().replaceAll('-', '');
  await exec('BEGIN');
  try {
    await exec('CREATE SCHEMA ' + schema + '; SET LOCAL search_path TO ' + schema);
    await exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    await exec(seed);
    const original = await legacyRows(db);
    const bindings = () => rows('SELECT id, company_id, routing_domain_id FROM address_spaces ORDER BY id');
    const defaults = () => rows('SELECT company_id, id FROM routing_domains WHERE is_default ORDER BY company_id');

    // Deliberately fail after the backfill. Roll back both the new schema and the data.
    await exec('SAVEPOINT before_upgrade');
    await exec(domainMigration);
    const crossBranch = "UPDATE address_spaces SET routing_domain_id = (SELECT id FROM routing_domains WHERE company_id = 'b' AND is_default) WHERE id = 'a1'";
    await assert.rejects(exec(crossBranch), { code: '23503', constraint: 'space_domain_company_fk' });
    await exec('ROLLBACK TO SAVEPOINT before_upgrade');
    assert.deepEqual(await rows("SELECT to_regclass('routing_domains') AS table_id"), [{ table_id: null }]);
    assert.deepEqual(await rows("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'address_spaces' AND column_name = 'routing_domain_id'"), []);
    assert.deepEqual(await legacyRows(db), original);

    await exec(domainMigration);
    const domains = await defaults();
    assert.deepEqual(domains.map(d => d.company_id), ['a', 'b', 'empty']);
    const domainByCompany = new Map(domains.map(d => [d.company_id, d.id]));
    const assigned = await bindings();
    assert.equal(assigned.length, 3);
    for (const space of assigned) assert.equal(space.routing_domain_id, domainByCompany.get(space.company_id));
    assert.deepEqual(await legacyRows(db), original);

    // Simulate reverting to a writer that knows only the original Space columns.
    await exec("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES ('legacy','a','Legacy write','203.0.113.0/24')");
    assert.deepEqual(await rows("SELECT routing_domain_id FROM address_spaces WHERE id='legacy'"), [{ routing_domain_id: domainByCompany.get('a') }]);
    await exec('SAVEPOINT before_duplicate');
    await assert.rejects(exec("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES ('dup','a','Second VRF','192.0.2.0/24')"), { code: '23505', constraint: 'address_spaces_company_id_cidr_key' });
    await exec('ROLLBACK TO SAVEPOINT before_duplicate');
  } finally {
    await exec('ROLLBACK');
  }
});

test('MS-03 PostgreSQL backups recover selected non-default domains, legacy identities and grants', {
  skip: !process.env.EMS_TEST_POSTGRES_URL && 'requires native PostgreSQL and its backup clients',
}, async () => {
  const connectionString = process.env.EMS_TEST_POSTGRES_URL;
  const control = new pg.Client({ connectionString });
  const created = [];
  const clients = [];
  const suffix = randomUUID().replaceAll('-', '');
  async function database(label) {
    const name = 'ms03_' + label + '_' + suffix;
    await control.query('CREATE DATABASE ' + name);
    created.push(name);
    const url = new URL(connectionString);
    url.pathname = '/' + name;
    const client = new pg.Client({ connectionString: url.href });
    await client.connect();
    clients.push(client);
    return { client, url };
  }

  function runUtility(command, url, args, input) {
    const target = new URL(url);
    const password = decodeURIComponent(target.password);
    target.password = '';
    const options = { env: { ...process.env, PGPASSWORD: password }, input, timeout: 30000 };
    const argv = ['--dbname=' + target.href, ...args];
    // CI uses the PG16 service's matching binaries. Local native runs use PATH.
    const container = process.env.EMS_TEST_PG_CONTAINER;
    if (container) return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD', container, command, ...argv], options);
    return execFileSync(command, argv, options);
  }

  async function startCore(target) {
    const pool = new pg.Pool({ connectionString: target.url.href });
    try {
      await migrateDatabase(pool);
    } finally {
      await pool.end();
    }
  }

  await control.connect();
  try {
    const source = await database('source');
    const restored = await database('restored');
    await source.client.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    await source.client.query(seed);
    const original = await legacyRows(source.client);
    const archive = runUtility('pg_dump', source.url, ['--format=custom']);
    assert.equal(archive.subarray(0, 5).toString(), 'PGDMP');
    await source.client.query(domainMigration);

    runUtility('pg_restore', restored.url, ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges'], archive);
    const recovered = restored.client;
    const { rows } = await recovered.query("SELECT to_regclass('public.routing_domains') AS domains, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='address_spaces' AND column_name='routing_domain_id') AS has_column");
    assert.deepEqual(rows, [{ domains: null, has_column: false }]);
    assert.deepEqual(await legacyRows(recovered), original);

    // Rehearse the upgrade against the recovered data, including the recycled Space.
    await startCore(restored);
    await startCore(restored);
    const bindings = await recovered.query(`
      SELECT s.id, d.company_id, d.is_default FROM address_spaces s
      LEFT JOIN routing_domains d ON d.id = s.routing_domain_id ORDER BY s.id
    `);
    assert.deepEqual(bindings.rows.map(r => [r.id, r.company_id, r.is_default]), [
      ['a1', 'a', true], ['b1', 'b', true], ['old', 'a', true],
    ]);
    assert.deepEqual(await legacyRows(recovered), original);

    // Two branches use the same CIDR and domain name but select different stored domains.
    const selected = await recovered.query(`
      WITH voice AS (
        INSERT INTO routing_domains(company_id, name) VALUES ('a', 'Voice'), ('b', 'Voice')
        RETURNING company_id, id
      )
      UPDATE address_spaces s SET routing_domain_id = voice.id
      FROM voice WHERE s.company_id = voice.company_id AND s.id IN ('a1', 'b1')
      RETURNING s.id, s.routing_domain_id
    `);
    assert.deepEqual(selected.rows.map(row => row.id).sort(), ['a1', 'b1']);
    assert.equal(new Set(selected.rows.map(row => row.routing_domain_id)).size, 2);

    // Recovery after a real upgrade must preserve the generated IDs as well as the legacy data.
    const copy = await database('upgraded_copy');
    const upgradedArchive = runUtility('pg_dump', restored.url, ['--format=custom']);
    runUtility('pg_restore', copy.url, ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges'], upgradedArchive);
    await startCore(copy);
    for (const sql of [
      'SELECT * FROM routing_domains ORDER BY id',
      'SELECT id, routing_domain_id FROM address_spaces ORDER BY id',
      'SELECT * FROM schema_migrations ORDER BY module_id, version',
    ]) {
      assert.deepEqual((await copy.client.query(sql)).rows, (await recovered.query(sql)).rows);
    }
    assert.deepEqual(await legacyRows(copy.client), original);
    await copy.client.query("INSERT INTO companies(id,name) VALUES ('new','New branch')");
    await copy.client.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES ('new1','new','LAN','192.0.2.0/24')");
    const newBinding = await copy.client.query(`SELECT d.company_id FROM address_spaces s
      JOIN routing_domains d ON d.id=s.routing_domain_id WHERE s.id='new1' AND d.is_default`);
    assert.deepEqual(newBinding.rows, [{ company_id: 'new' }]);
  } finally {
    try {
      for (const client of clients) await client.end();
      for (const name of created) await control.query('DROP DATABASE ' + name);
    } finally {
      await control.end();
    }
  }
});
