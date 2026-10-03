import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,1);
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
