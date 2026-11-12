import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { migrateDatabase } from '../server/migrations.mjs';

const domainMigration = await readFile(new URL('../server/migrations/002-default-routing-domains.sql', import.meta.url), 'utf8');

const stageDomainConstraints = `ALTER TABLE address_spaces
  ALTER COLUMN routing_domain_id SET NOT NULL,
  ADD CONSTRAINT space_domain_cidr_key UNIQUE (company_id, routing_domain_id, cidr)`;

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
}, async t => {
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

    runUtility('pg_restore', restored.url, ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges'], archive);
    const recovered = restored.client;
    const { rows } = await recovered.query("SELECT to_regclass('public.routing_domains') AS domains, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='address_spaces' AND column_name='routing_domain_id') AS has_column");
    assert.deepEqual(rows, [{ domains: null, has_column: false }]);
    assert.deepEqual(await legacyRows(recovered), original);

    // Build the historical 002 backup with its original SQL and ledger checksums.
    const baseline = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    await recovered.query(domainMigration);
    await recovered.query(`CREATE TABLE schema_migrations (
      module_id text NOT NULL, version text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (module_id, version))`);
    for (const [version, sql] of [['001-baseline-1.7', baseline], ['002-default-routing-domains', domainMigration]]) {
      await recovered.query('INSERT INTO schema_migrations(module_id,version,checksum) VALUES ($1,$2,$3)',
        ['core', version, createHash('sha256').update(sql).digest('hex')]);
    }
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
    for (const sql of [
      'SELECT * FROM routing_domains ORDER BY id',
      'SELECT id, routing_domain_id FROM address_spaces ORDER BY id',
      'SELECT * FROM schema_migrations ORDER BY module_id, version',
    ]) {
      assert.deepEqual((await copy.client.query(sql)).rows, (await recovered.query(sql)).rows);
    }
    assert.deepEqual(await legacyRows(copy.client), original);
    await t.test('preflight reports unbound active and recycled Spaces and missing branch defaults after restore', async () => {
      const db = copy.client;
      const report = await readFile(new URL('../../scripts/routing-domain-preflight.sql', import.meta.url), 'utf8');
      await db.query('BEGIN');
      try {
        await db.query("UPDATE address_spaces SET routing_domain_id=NULL WHERE id IN ('b1','old')");
        await db.query("UPDATE routing_domains SET is_default=false WHERE is_default AND company_id IN ('b','empty')");
        const { rows: [defaultA] } = await db.query("SELECT id FROM routing_domains WHERE company_id='a' AND is_default");
        const { rows } = await db.query(report);
        assert.deepEqual(rows.map(row => [
          row.company_id, row.unbound_space_id, row.space_state, row.missing_default, row.default_domain_id,
        ]), [
          ['a', 'old', 'recycled', false, defaultA.id],
          ['b', 'b1', 'active', true, null],
          ['empty', null, null, true, null],
        ]);
        assert.ok(rows.every(row => Number.isFinite(row.checked_at.getTime()) &&
          row.checked_at.getTime() === rows[0].checked_at.getTime()));
        assert.deepEqual(await legacyRows(db), original);
        await assert.rejects(db.query('ALTER TABLE address_spaces ALTER COLUMN routing_domain_id SET NOT NULL'), { code: '23502' });
      } finally {
        await db.query('ROLLBACK');
      }
      await db.query('BEGIN READ ONLY');
      try {
        assert.deepEqual((await db.query(report)).rows, []);
        assert.deepEqual(await legacyRows(db), original);
      } finally {
        await db.query('ROLLBACK');
      }
    });

    await t.test('restored backfill aborts atomically, preserves explicit domains and grants, and retries without changes', async t => {
      const target = await database('backfill');
      runUtility('pg_restore', target.url, ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges'], upgradedArchive);
      const db = target.client;
      const script = await readFile(new URL('../../scripts/routing-domain-backfill.sql', import.meta.url), 'utf8');
      const run = (input = script) => runUtility('psql', target.url, [
        '-X', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-qAt', '-F', '\t', '-f', '-',
      ], input).toString().trim();
      const bindings = async () => (await db.query('SELECT id, routing_domain_id FROM address_spaces ORDER BY id')).rows;
      const originalBindings = await bindings();
      const domains = async () => (await db.query('SELECT * FROM routing_domains ORDER BY id')).rows;
      const originalDomains = await domains();
      const defaults = new Map(originalDomains.filter(d => d.is_default).map(d => [d.company_id, d.id]));

      await db.query("UPDATE address_spaces SET routing_domain_id=NULL WHERE id IN ('b1','old')");
      const unbound = await bindings();
      assert.throws(() => runUtility('psql', target.url, ['-X', '-f', '-'], script),
        err => err.status === 3 && err.stderr.toString().includes('LOCK TABLE'));
      assert.deepEqual(await bindings(), unbound);
      for (const company of ['b', 'empty']) {
        await db.query('UPDATE routing_domains SET is_default=false WHERE id=$1', [defaults.get(company)]);
        assert.throws(run, err => err.status === 3 && err.stderr.toString().includes('Missing default routing domain for company ' + company));
        assert.deepEqual(await bindings(), unbound);
        await db.query('UPDATE routing_domains SET is_default=true WHERE id=$1', [defaults.get(company)]);
      }

      // An error after UPDATE but before COMMIT must leave both candidates unbound.
      assert.throws(() => run(script + '\nSELECT 1/0;'), err => err.status === 3 && err.stderr.toString().includes('division by zero'));
      assert.deepEqual(await bindings(), unbound);
      const changed = run().split('\n').map(line => line.split('\t'));
      assert.deepEqual(changed.map(row => row.slice(0, 4)), [
        ['a', 'old', defaults.get('a'), 'recycled'],
        ['b', 'b1', defaults.get('b'), 'active'],
      ]);
      assert.ok(changed.every(row => Number.isFinite(Date.parse(row[4]))));
      const expected = originalBindings.map(row => row.id === 'b1' ? { ...row, routing_domain_id: defaults.get('b') } : row);
      assert.deepEqual(await bindings(), expected);
      assert.equal(run(), '');
      assert.deepEqual(await bindings(), expected);
      assert.deepEqual(await domains(), originalDomains);
      assert.deepEqual(await legacyRows(db), original);

      await t.test('committed staged constraints preserve legacy writes through downgrade on the restored copy', async () => {
        // Each DDL statement commits separately so the downgrade must preserve intervening writes.
        await db.query(stageDomainConstraints);
        const newSpace = `INSERT INTO address_spaces(id, company_id, name, cidr)
          VALUES ($1, 'a', 'Legacy LAN', $2) RETURNING id, routing_domain_id`;
        const oldKey = { code: '23505', constraint: 'address_spaces_company_id_cidr_key' };
        // a1 is in Voice. The legacy key still prevents the same CIDR in the default domain.
        await assert.rejects(db.query(newSpace, ['overlap', '192.0.2.0/24']), oldKey);
        const unbind = "UPDATE address_spaces SET routing_domain_id=NULL WHERE id='old'";
        await assert.rejects(db.query(unbind), { code: '23502', column: 'routing_domain_id' });
        assert.deepEqual(await bindings(), expected);
        assert.deepEqual(await legacyRows(db), original);

        const added = await db.query(newSpace, ['legacy-stage', '203.0.113.0/24']);
        assert.deepEqual(added.rows, [{ id: 'legacy-stage', routing_domain_id: defaults.get('a') }]);
        const committedRows = await legacyRows(db);
        const committedBindings = await bindings();
        await db.query(`ALTER TABLE address_spaces
          DROP CONSTRAINT space_domain_cidr_key,
          ALTER COLUMN routing_domain_id DROP NOT NULL`);

        await assert.rejects(db.query(newSpace, ['overlap', '192.0.2.0/24']), oldKey);
        await db.query('BEGIN');
        try {
          assert.equal((await db.query(unbind)).rowCount, 1);
        } finally {
          await db.query('ROLLBACK');
        }
        assert.deepEqual(await legacyRows(db), committedRows);
        assert.deepEqual(await bindings(), committedBindings);
        assert.deepEqual(await domains(), originalDomains);
      });
    });

    await t.test('restored branch accepts an overlapping CIDR only in a different domain and rolls back cleanly', async () => {
      const db = copy.client;
      const addDefaultLan = `INSERT INTO address_spaces(id, company_id, name, cidr)
        VALUES ($1, 'b', 'Default LAN', '192.0.2.0/24')`;
      await db.query('BEGIN');
      try {
        await db.query(stageDomainConstraints);
        await db.query('ALTER TABLE address_spaces DROP CONSTRAINT address_spaces_company_id_cidr_key');
        assert.deepEqual(await legacyRows(db), original);

        // b1 is bound to Voice. An old writer omitting the domain creates b2 in the branch default.
        await db.query(addDefaultLan, ['b2']);
        await db.query("INSERT INTO hosts(id, space_id, ip) VALUES ('hb2', 'b2', '192.0.2.10')");
        const { rows } = await db.query(`SELECT s.id AS space, h.id AS host, d.is_default,
            EXISTS (SELECT 1 FROM user_space_access a WHERE a.space_id=s.id AND a.user_id='reader') AS granted
          FROM address_spaces s JOIN routing_domains d ON d.id=s.routing_domain_id AND d.company_id=s.company_id
          JOIN hosts h ON h.space_id=s.id
          WHERE s.company_id='b' AND s.cidr='192.0.2.0/24' AND h.ip='192.0.2.10' ORDER BY s.id`);
        assert.deepEqual(rows, [
          { space: 'b1', host: 'hb', is_default: false, granted: true },
          { space: 'b2', host: 'hb2', is_default: true, granted: false },
        ]);

        await db.query('SAVEPOINT duplicate_in_default');
        await assert.rejects(db.query(addDefaultLan, ['b3']), { code: '23505', constraint: 'space_domain_cidr_key' });
        await db.query('ROLLBACK TO SAVEPOINT duplicate_in_default');

        // Restoring the old uniqueness rule with committed overlaps would require data recovery.
        await assert.rejects(db.query(`ALTER TABLE address_spaces
          ADD CONSTRAINT address_spaces_company_id_cidr_key UNIQUE (company_id, cidr)`), { code: '23505' });
      } finally {
        await db.query('ROLLBACK');
      }
      assert.deepEqual(await legacyRows(db), original);
      await assert.rejects(db.query(addDefaultLan, ['b2']), { code: '23505', constraint: 'address_spaces_company_id_cidr_key' });
    });

    await t.test('Core 003 rolls back on a missing default and upgrades a restored 002 database once', async () => {
      const db = copy.client;
      const bindings = async () => (await db.query('SELECT id,routing_domain_id FROM address_spaces ORDER BY id')).rows;
      const ledger = async () => (await db.query(
        "SELECT checksum,applied_at FROM schema_migrations WHERE module_id='core' AND version='003-required-routing-domains'"
      )).rows;
      const { rows: domains } = await db.query('SELECT company_id,id FROM routing_domains WHERE is_default');
      const defaults = new Map(domains.map(d => [d.company_id, d.id]));
      await db.query("UPDATE address_spaces SET routing_domain_id=NULL WHERE id IN ('b1','old')");
      const pending = await bindings();
      await db.query('UPDATE routing_domains SET is_default=false WHERE id=$1', [defaults.get('empty')]);
      await assert.rejects(startCore(copy), { code: '23514', message: 'Missing default routing domain for company empty' });
      assert.deepEqual(await ledger(), []);
      assert.deepEqual(await bindings(), pending);
      await db.query('UPDATE routing_domains SET is_default=true WHERE id=$1', [defaults.get('empty')]);

      await startCore(copy);
      const sql = await readFile(new URL('../server/migrations/003-required-routing-domains.sql', import.meta.url));
      const applied = await ledger();
      assert.deepEqual(applied.map(row => row.checksum), [createHash('sha256').update(sql).digest('hex')]);
      const expected = [
        pending.find(row => row.id === 'a1'),
        { id: 'b1', routing_domain_id: defaults.get('b') },
        { id: 'old', routing_domain_id: defaults.get('a') },
      ];
      assert.deepEqual(await bindings(), expected);
      await assert.rejects(db.query("UPDATE address_spaces SET routing_domain_id=NULL WHERE id='old'"), { code: '23502' });
      await assert.rejects(db.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES ('dup','a','LAN','192.0.2.0/24')"),
        { code: '23505', constraint: 'address_spaces_company_id_cidr_key' });
      await startCore(copy);
      assert.deepEqual(await ledger(), applied);
      assert.deepEqual(await bindings(), expected);
      assert.deepEqual(await legacyRows(db), original);
    });

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
