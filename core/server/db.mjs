import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function migrate() {
  const file = path.resolve('core/migrations/001_core.sql');
  const sql = await fs.readFile(file, 'utf8');
  await pool.query(sql);
}

export async function closeDb() {
  await pool.end();
}
