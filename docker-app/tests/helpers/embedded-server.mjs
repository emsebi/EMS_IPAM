// Test harness only. Production always uses PostgreSQL through pg.
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const db=new PGlite();
const query=async(sql,params)=>{
  const result=params?.length ? await db.query(sql,params) : (await db.exec(sql)).at(-1);
  return { ...result, rows: result?.rows||[], rowCount: result?.rowCount ?? result?.affectedRows ?? result?.rows?.length ?? 0 };
};
pg.Pool=class {
  query=query;
  async connect(){return {query,release(){}};}
  async end(){await db.close();}
};
process.env.PGHOST='embedded-test-only';
process.env.EMS_ADMIN_USERNAME='test-admin';
process.env.EMS_ADMIN_PASSWORD='Test-Password-01';
process.env.BACKUP_DIR=await fs.mkdtemp(path.join(os.tmpdir(),'ems-test-backups-'));
process.env.EMS_MODULES_DIR=path.resolve(import.meta.dirname,'../../../modules');
process.env.PORT=process.env.EMS_TEST_PORT||'18190';
await import('../../server/main.mjs');
await db.exec(`UPDATE app_settings SET value='{"enabled":false}'::jsonb WHERE key='backup';
INSERT INTO companies(id,name) VALUES('test-co','Test Company');
INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('test-space','test-co','Test LAN','192.0.2.0/24');
INSERT INTO hosts(id,space_id,ip,name,type,radio_mode,ssid) VALUES
 ('ap1','test-space','192.0.2.10','AP One','Radio','ap','Office'),
 ('ap2','test-space','192.0.2.20','AP Two','Radio','ap','Warehouse'),
 ('ap3','test-space','192.0.2.30','AP Three','Radio','ap','Remote');
INSERT INTO hosts(id,space_id,ip,name,type,radio_mode,radio_parent_host_id,ssid) VALUES
 ('st1','test-space','192.0.2.11','Station One','Radio','station','ap1','Office'),
 ('st2','test-space','192.0.2.21','Station Two','Radio','station','ap2','Warehouse'),
 ('st3','test-space','192.0.2.31','Station Three','Radio','station','ap3','Remote');`);
console.log('TEST_FIXTURES_READY');
