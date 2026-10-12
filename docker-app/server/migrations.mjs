import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// The ledger and every schema mutation commit together. A restart must never
// restore revoked permissions, recreate deleted types or replay data changes.
export async function migrateDatabase(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(17001700)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      module_id text NOT NULL, version text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(module_id,version))`);
    const version = '001-baseline-1.7';
    const found = await client.query('SELECT checksum FROM schema_migrations WHERE module_id=$1 AND version=$2', ['core', version]);
    const schema = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    const checksum = crypto.createHash('sha256').update(schema).digest('hex');
    if (found.rows.length) {
      if (found.rows[0].checksum !== checksum) throw new Error('Applied baseline was modified; ship a new migration instead.');
    } else {
      const existing = (await client.query(`SELECT to_regclass('public.device_types') AS types,
        to_regclass('public.user_module_access') AS access`)).rows[0];
      await client.query(schema);
      // Only a previously nonexistent catalog needs seed data. A deliberately
      // empty existing catalog is preserved when upgrading v1.6.1.
      if (!existing.types) await client.query(await fs.readFile(new URL('./seed-device-types.sql', import.meta.url), 'utf8'));
      if (!existing.access) await client.query(`INSERT INTO user_module_access(user_id,module_id)
        SELECT u.id,m.id FROM users u CROSS JOIN (VALUES ('ipam'),('inventory')) AS m(id)
        WHERE u.role <> 'admin' ON CONFLICT DO NOTHING`);
      await client.query('INSERT INTO schema_migrations(module_id,version,checksum) VALUES($1,$2,$3)', ['core',version,checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}


const moduleMigrationName = /^\d{3,4}-[a-z0-9][a-z0-9-]*\.sql$/;

async function migrateOneModule(pool, module) {
  const root = await fs.realpath(module.dir);
  const migrationsDir = path.join(root, 'migrations');
  let entries;
  try {
    entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const sqlEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));
  const invalid = sqlEntries.find((entry) => !moduleMigrationName.test(entry.name));
  if (invalid) throw new Error(`Invalid migration filename: ${invalid.name}`);
  sqlEntries.sort((a, b) => a.name.localeCompare(b.name));
  const applied = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(17001701)');
    for (const entry of sqlEntries) {
      const file = path.join(migrationsDir, entry.name);
      const resolved = await fs.realpath(file);
      if (!resolved.startsWith(migrationsDir + path.sep)) throw new Error(`Migration path escapes module: ${entry.name}`);
      const sql = await fs.readFile(resolved, 'utf8');
      const version = entry.name.slice(0, -4);
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const found = await client.query(
        'SELECT checksum FROM schema_migrations WHERE module_id=$1 AND version=$2',
        [module.id, version],
      );
      if (found.rows.length) {
        if (found.rows[0].checksum !== checksum) {
          throw new Error(`Applied module migration was modified: ${module.id}/${version}`);
        }
        continue;
      }
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(module_id,version,checksum) VALUES($1,$2,$3)',
        [module.id, version, checksum],
      );
      applied.push({ moduleId: module.id, version });
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run versioned migrations owned by installed modules. A broken optional module
 * is isolated: its transaction rolls back and the caller can disable only that
 * module while Core and other modules continue starting.
 */
export async function migrateModuleSchemas(pool, modules = []) {
  const result = { applied: [], failed: [] };
  for (const module of [...modules].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!module?.id || !module?.dir) continue;
    try {
      result.applied.push(...await migrateOneModule(pool, module));
    } catch (error) {
      result.failed.push({ moduleId: module.id, error: error.message || String(error) });
    }
  }
  return result;
}
