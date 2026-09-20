import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');

test('stage01 UI keeps mandatory base workflows', () => {
  const html = read('public/index.html');
  for (const token of ['themeButton','logoutButton','companyDialog','personnelDialog','prefixDialog','prevHostButton','nextHostButton','moduleAccessList']) {
    assert.match(html, new RegExp(token));
  }
});

test('stage01 update never removes the database volume', () => {
  const installer = fs.readFileSync(path.resolve(root,'../install.sh'),'utf8');
  const update = installer.slice(installer.indexOf('update_app(){'), installer.indexOf('uninstall_keep_db(){'));
  assert.doesNotMatch(update, /down\s+-v|volume\s+rm|rm\s+-rf\s+\"?\$STATE_DIR/);
  assert.match(update, /backup_database/);
});

test('stage01 database keeps shared IDs for future modules', () => {
  const schema = read('server/schema.sql');
  for (const table of ['companies','personnel','address_spaces','prefixes','hosts','user_module_access','audit_log']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});
