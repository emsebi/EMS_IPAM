import fs from 'node:fs/promises';
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
