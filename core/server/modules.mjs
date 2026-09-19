import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

export async function discoverModules({ root = path.resolve('modules'), logger = console } = {}) {
  const modules = [];
  let entries = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return modules; }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const moduleDir = path.join(root, entry.name);
    try {
      try { await fs.access(path.join(moduleDir, 'module.json')); } catch { continue; }
      const manifest = JSON.parse(await fs.readFile(path.join(moduleDir, 'module.json'), 'utf8'));
      if (!manifest.id || manifest.id !== entry.name) throw new Error('module id does not match folder name');
      modules.push({ ...manifest, dir: moduleDir, status: 'available', error: '' });
    } catch (error) {
      logger.warn(`[module] skipped ${entry.name}: ${error.message}`);
    }
  }
  return modules;
}

async function applyMigrations(module, query, logger) {
  if (!module.migrations || !query) return;
  const dir = path.resolve(module.dir, module.migrations);
  let entries = [];
  try { entries = (await fs.readdir(dir, { withFileTypes: true })).filter(x => x.isFile() && x.name.endsWith('.sql')).map(x => x.name).sort(); }
  catch { return; }
  for (const name of entries) {
    const sql = await fs.readFile(path.join(dir, name), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = await query('SELECT checksum FROM module_migrations WHERE module_id=$1 AND migration_name=$2', [module.id, name]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`migration ${name} was changed after it was applied`);
      continue;
    }
    await query('BEGIN');
    try {
      await query(sql);
      await query('INSERT INTO module_migrations(module_id,migration_name,checksum) VALUES($1,$2,$3)', [module.id, name, checksum]);
      await query('COMMIT');
      logger.log(`[module] ${module.id}: applied migration ${name}`);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  }
}

export async function loadModuleBackends(modules, context, logger = console) {
  const loaded = [];
  for (const module of modules) {
    try {
      await applyMigrations(module, context.query, logger);
      if (module.backend) {
        const file = path.resolve(module.dir, module.backend);
        const imported = await import(pathToFileURL(file).href);
        if (typeof imported.register === 'function') await imported.register({ ...context, manifest: module });
      }
      loaded.push({ ...module, status: 'loaded', error: '' });
    } catch (error) {
      logger.error(`[module] ${module.id} failed: ${error.stack || error.message}`);
      loaded.push({ ...module, status: 'error', error: error.message });
    }
  }
  return loaded;
}
