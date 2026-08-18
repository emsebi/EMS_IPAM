import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";
import { hashPassword } from "./auth.mjs";

const { Pool } = pg;

export function createDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000 });

  async function waitForDatabase() {
    let lastError;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await pool.query("SELECT 1");
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
      }
    }
    throw lastError;
  }

  async function initialize({ adminUsername, adminPassword }) {
    await waitForDatabase();
    const schema = await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(schema);
    await pool.query("DELETE FROM sessions WHERE expires_at < now()");

    const userCount = Number((await pool.query("SELECT count(*) AS count FROM users")).rows[0].count);
    if (userCount === 0) {
      await pool.query(
        "INSERT INTO users(id, username, display_name, password_hash, role) VALUES($1,$2,$3,$4,'admin')",
        [crypto.randomUUID(), adminUsername, "مدیر سیستم", await hashPassword(adminPassword)],
      );
    }

    const companyCount = Number((await pool.query("SELECT count(*) AS count FROM companies")).rows[0].count);
    if (companyCount === 0) {
      const companyId = crypto.randomUUID();
      await pool.query("INSERT INTO companies(id,name,description) VALUES($1,$2,$3)", [companyId, "شرکت ۱", "ساختار اولیه پروژه"]);
      await pool.query(
        "INSERT INTO address_spaces(id,company_id,name,cidr,color) VALUES($1,$2,$3,$4,$5),($6,$2,$7,$8,$9)",
        [crypto.randomUUID(), companyId, "شبکه اصلی", "192.168.0.0/16", "#3157d5", crypto.randomUUID(), "شبکه 10.200", "10.200.0.0/16", "#2fa36f"],
      );
    }

    const tools = [
      ["VNC", "VNC", 5800, "#d94b5b"],
      ["MIK", "Winbox", 9191, "#3478d4"],
      ["RDP", "Remote Desktop", 3388, "#2fa36f"],
      ["SSH", "PuTTY", 0, "#e48a2d"],
    ];
    for (const tool of tools) {
      await pool.query(
        "INSERT INTO tool_defaults(tool,label,default_port,color) VALUES($1,$2,$3,$4) ON CONFLICT(tool) DO NOTHING",
        tool,
      );
    }
  }

  return { pool, initialize, close: () => pool.end() };
}
