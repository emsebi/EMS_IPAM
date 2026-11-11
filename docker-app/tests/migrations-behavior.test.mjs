import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrateDatabase } from '../server/migrations.mjs';
function adapter(db){const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0}};return {query,connect:async()=>({query,release(){}})}}

test('fresh install, revocation and renamed/deleted types survive repeated startup', async()=>{
 const db=new PGlite();const pool=adapter(db);
 try{
  await migrateDatabase(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM device_types')).rows[0].n,14);
  await db.exec(`INSERT INTO users(id,username,password_hash,role) VALUES('u','user','test','viewer');
   INSERT INTO user_module_access(user_id,module_id) VALUES('u','radio');
   UPDATE device_types SET name='Core switch' WHERE id='builtin-switch';
   DELETE FROM device_types WHERE id='builtin-camera';`);
  await migrateDatabase(pool);await migrateDatabase(pool);
  assert.equal((await pool.query("SELECT name FROM device_types WHERE id='builtin-switch'")).rows[0].name,'Core switch');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM device_types WHERE id='builtin-camera'")).rows[0].n,0);
  assert.deepEqual((await pool.query("SELECT module_id FROM user_module_access WHERE user_id='u'")).rows,[{module_id:'radio'}]);
  assert.deepEqual((await pool.query("SELECT version FROM schema_migrations WHERE module_id='core' ORDER BY version")).rows.map(r => r.version), ['001-baseline-1.7', '002-default-routing-domains']);
 }finally{await db.close();}
});

test('upgrade existing 1.6-style database preserves intentionally empty catalog and permissions',async()=>{
 const db=new PGlite();const pool=adapter(db);
 try{
  await db.exec(await fs.readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
  await db.exec("INSERT INTO users(id,username,password_hash,role) VALUES('u','user','test','viewer')");
  await migrateDatabase(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM device_types')).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_module_access')).rows[0].n,0);
 }finally{await db.close();}
});

test('MS-03 upgrades a recorded baseline once and keeps the same branch bindings across restart', async () => {
  const db = new PGlite();
  const pool = adapter(db);
  try {
    const schema = await fs.readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    await db.exec(`CREATE TABLE schema_migrations(module_id text, version text, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(module_id, version));
      INSERT INTO companies(id,name) VALUES ('n','North'),('s','South');
      INSERT INTO address_spaces(id,company_id,name,cidr) VALUES
        ('n1','n','LAN','192.0.2.0/24'),('s1','s','LAN','192.0.2.0/24');`);
    await db.query("INSERT INTO schema_migrations(module_id,version,checksum) VALUES ('core','001-baseline-1.7',$1)",
      [createHash('sha256').update(schema).digest('hex')]);
    await migrateDatabase(pool);
    const bindings = async () => (await db.query(`SELECT s.id,s.routing_domain_id,d.company_id FROM address_spaces s
      JOIN routing_domains d ON d.id=s.routing_domain_id WHERE d.is_default ORDER BY s.id`)).rows;
    const upgraded = await bindings();
    assert.deepEqual(upgraded.map(r => [r.id,r.company_id]), [['n1','n'],['s1','s']]);
    assert.notEqual(upgraded[0].routing_domain_id, upgraded[1].routing_domain_id);
    await migrateDatabase(pool);
    assert.deepEqual(await bindings(), upgraded);
    await db.exec("UPDATE schema_migrations SET checksum='changed' WHERE module_id='core' AND version='002-default-routing-domains'");
    await assert.rejects(migrateDatabase(pool), /modified.*002-default-routing-domains/);
    assert.deepEqual(await bindings(), upgraded);
  } finally {
    await db.close();
  }
});
