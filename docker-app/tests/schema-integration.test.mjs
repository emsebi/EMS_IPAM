import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const schemaUrl = new URL("../server/schema.sql", import.meta.url);

test("PostgreSQL schema installs twice and migrates legacy roles", async () => {
  const schema = await fs.readFile(schemaUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(schema);
    await db.exec(schema);

    const tableResult = await db.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
    );
    assert.ok(tableResult.rows[0].count >= 20, "expected the complete BASE/IPAM schema");

    await db.exec(`
      ALTER TABLE users DROP CONSTRAINT users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','editor','viewer'));
      INSERT INTO users(id,username,password_hash,role) VALUES('legacy-editor','legacy-editor','test','editor');
    `);
    await db.exec(schema);

    const migrated = await db.query("SELECT role FROM users WHERE id='legacy-editor'");
    assert.equal(migrated.rows[0].role, "support");
    await db.exec("INSERT INTO users(id,username,password_hash,role) VALUES('branch-user','branch-user','test','branch')");

    await db.exec(`
      INSERT INTO companies(id,name) VALUES('company-test','Test Company');
      INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('space-test','company-test','LAN','10.10.0.0/16');
      INSERT INTO personnel(id,full_name) VALUES('person-name-only','Name Only');
      INSERT INTO hosts(id,space_id,ip,name,type) VALUES('host-test','space-test','10.10.1.10','SW-OLD','Switch');
      UPDATE hosts SET name='SW-NEW',vendor='Cisco',model='C9300' WHERE id='host-test';
    `);
    const person = await db.query("SELECT employee_code,full_name FROM personnel WHERE id='person-name-only'");
    assert.equal(person.rows[0].employee_code, null, "personnel code must be optional");
    assert.equal(person.rows[0].full_name, "Name Only");
    const equipment = await db.query("SELECT name,vendor,model FROM hosts WHERE id='host-test'");
    assert.deepEqual(equipment.rows[0], { name: "SW-NEW", vendor: "Cisco", model: "C9300" });
  } finally {
    await db.close();
  }
});
