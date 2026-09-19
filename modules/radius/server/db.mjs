import fs from "node:fs/promises";
import pg from "pg";
const { Pool } = pg;

export function createPool() {
  return new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "ems_ipam",
    user: process.env.PGUSER || "ems_ipam",
    password: process.env.PGPASSWORD,
    max: 8,
  });
}

export async function initialize(pool) {
  const schema = await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
}
