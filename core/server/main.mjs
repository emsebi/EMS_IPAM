import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { migrate, query } from './db.mjs';
import { hashPassword, verifyPassword, randomToken, sha256, id } from './security.mjs';
import { json, readJson, parseCookies, clientIp, serveStatic } from './http.mjs';
import { discoverModules, loadModuleBackends } from './modules.mjs';

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_ROOT = path.resolve('core/public');
const STATE_ROOT = '/state';
const BACKUP_ROOT = path.join(STATE_ROOT, 'backups');
const SESSION_COOKIE = 'ems_session';
const SESSION_DAYS = 7;
const moduleRoutes = [];
let modules = [];

const roleRank = { viewer: 10, helpdesk: 20, support: 30, admin: 40 };

function normalizeMac(value = '') {
  const x = String(value).replace(/[^0-9a-f]/gi, '').toUpperCase();
  return x.length === 12 ? x.match(/.{2}/g).join(':') : String(value).trim();
}

async function audit(user, req, action, entityType, entityId = null, beforeData = null, afterData = null) {
  await query(
    `INSERT INTO audit_log(user_id,action,entity_type,entity_id,before_data,after_data,source_ip)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [user?.id || null, action, entityType, entityId, beforeData, afterData, clientIp(req)]
  );
}

async function bootstrapAdmin() {
  const username = process.env.EMS_ADMIN_USERNAME || 'admin';
  const password = process.env.EMS_ADMIN_PASSWORD_B64 ? Buffer.from(process.env.EMS_ADMIN_PASSWORD_B64, 'base64').toString('utf8') : (process.env.EMS_ADMIN_PASSWORD || '');
  const existing = await query('SELECT id FROM users WHERE username=$1', [username]);
  if (existing.rowCount) return;
  if (!password) throw new Error('EMS_ADMIN_PASSWORD is required for first start');
  await query(
    `INSERT INTO users(id,username,display_name,password_hash,role,active)
     VALUES($1,$2,$3,$4,'admin',true)`,
    [id('usr'), username, 'Administrator', hashPassword(password)]
  );
}

async function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await query(
    `SELECT u.id,u.username,u.display_name,u.role,u.active
       FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
    [sha256(token)]
  );
  return result.rows[0] || null;
}

function requireRole(user, minimum = 'viewer') {
  if (!user) throw Object.assign(new Error('authentication required'), { statusCode: 401 });
  if ((roleRank[user.role] || 0) < (roleRank[minimum] || 0)) {
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }
}

function setSessionCookie(res, token) {
  const secure = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
  const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) attrs.push('Secure');
  res.setHeader('set-cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function route(method, pattern, handler, minimumRole = null) {
  moduleRoutes.push({ method, pattern, handler, minimumRole });
}

function matchPattern(pattern, pathname) {
  const a = pattern.split('/').filter(Boolean);
  const b = pathname.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function runBackup(user, req, type = 'manual') {
  requireRole(user, 'admin');
  await fs.mkdir(BACKUP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ems-ipam-${stamp}.sql.gz`;
  const target = path.join(BACKUP_ROOT, filename);
  const url = new URL(process.env.DATABASE_URL);
  const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', decodeURIComponent(url.pathname.slice(1)), '--no-owner', '--no-privileges'];
  const child = spawn('pg_dump', args, { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } });
  const gzip = spawn('gzip', ['-c']);
  child.stdout.pipe(gzip.stdin);
  const handle = await fs.open(target, 'w', 0o600);
  gzip.stdout.pipe(handle.createWriteStream());
  const stderr = [];
  child.stderr.on('data', d => stderr.push(d));
  const [dumpCode, gzipCode] = await Promise.all([
    new Promise(resolve => child.on('close', resolve)),
    new Promise(resolve => gzip.on('close', resolve))
  ]);
  await handle.close().catch(() => {});
  if (dumpCode !== 0 || gzipCode !== 0) {
    await fs.rm(target, { force: true });
    throw new Error(`backup failed: ${Buffer.concat(stderr).toString('utf8').trim()}`);
  }
  const stat = await fs.stat(target);
  const backupId = id('bak');
  await query('INSERT INTO backup_history(id,filename,backup_type,status,size_bytes,created_by) VALUES($1,$2,$3,$4,$5,$6)', [backupId, filename, type, 'created', stat.size, user.id]);
  await audit(user, req, 'backup.create', 'backup', backupId, null, { filename, type, sizeBytes: stat.size });
  return { id: backupId, filename, type, sizeBytes: stat.size };
}

async function coreRoutes(req, res, url, user) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/health') {
    try {
      await query('SELECT 1');
      return json(res, 200, { ok: true, service: 'ems-ipam-core', version: '1.0.0-stage1' });
    } catch (error) {
      return json(res, 503, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readJson(req);
    const result = await query('SELECT * FROM users WHERE username=$1 AND active=true', [String(body.username || '')]);
    const account = result.rows[0];
    if (!account || !verifyPassword(String(body.password || ''), account.password_hash)) {
      return json(res, 401, { error: 'نام کاربری یا رمز عبور نادرست است.' });
    }
    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
    await query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [sha256(token), account.id, expires]);
    setSessionCookie(res, token);
    await audit(account, req, 'auth.login', 'user', account.id);
    return json(res, 200, { user: { id: account.id, username: account.username, displayName: account.display_name, role: account.role } });
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    if (!user) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { user });
  }

  if (pathname.startsWith('/api/')) requireRole(user);

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const [companies, sites, personnel, devices, users, audits] = await Promise.all([
      query('SELECT count(*)::int AS count FROM companies WHERE active=true'),
      query('SELECT count(*)::int AS count FROM sites WHERE active=true'),
      query('SELECT count(*)::int AS count FROM personnel WHERE active=true'),
      query("SELECT count(*)::int AS count FROM devices WHERE status<>'deleted'"),
      query('SELECT count(*)::int AS count FROM users WHERE active=true'),
      query('SELECT id,action,entity_type,created_at FROM audit_log ORDER BY created_at DESC LIMIT 8')
    ]);
    return json(res, 200, {
      counts: { companies: companies.rows[0].count, sites: sites.rows[0].count, personnel: personnel.rows[0].count, devices: devices.rows[0].count, users: users.rows[0].count },
      recentAudit: audits.rows,
      modules: modules.map(m => ({ id: m.id, name: m.name, version: m.version, status: m.status, navigation: m.navigation || null }))
    });
  }

  if (req.method === 'GET' && pathname === '/api/modules') {
    return json(res, 200, { modules: modules.map(({ dir, backend, ...m }) => m) });
  }

  if (req.method === 'GET' && pathname === '/api/search') {
    const q = String(url.searchParams.get('q') || '').trim();
    if (q.length < 1) return json(res, 200, { items: [] });
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const compact = q.replace(/[^0-9a-f]/gi, '').toUpperCase();
    const [p, d, c] = await Promise.all([
      query(`SELECT 'personnel' AS type,id,full_name AS title,employee_code AS subtitle FROM personnel WHERE active=true AND (employee_code ILIKE $1 ESCAPE '\\' OR full_name ILIKE $1 ESCAPE '\\' OR phone ILIKE $1 ESCAPE '\\') ORDER BY full_name LIMIT 6`, [like]),
      query(`SELECT 'device' AS type,id,name AS title,concat_ws(' · ',management_ip,mac,model) AS subtitle FROM devices WHERE status<>'deleted' AND (name ILIKE $1 ESCAPE '\\' OR management_ip ILIKE $1 ESCAPE '\\' OR replace(replace(mac,':',''),'-','') ILIKE $2 OR asset_tag ILIKE $1 ESCAPE '\\') ORDER BY name LIMIT 8`, [like, `%${compact}%`]),
      query(`SELECT 'company' AS type,id,name AS title,code AS subtitle FROM companies WHERE active=true AND (name ILIKE $1 ESCAPE '\\' OR code ILIKE $1 ESCAPE '\\') ORDER BY name LIMIT 4`, [like])
    ]);
    return json(res, 200, { items: [...d.rows, ...p.rows, ...c.rows] });
  }

  if (req.method === 'GET' && pathname === '/api/companies') {
    const r = await query(`SELECT c.*, count(s.id)::int AS site_count FROM companies c LEFT JOIN sites s ON s.company_id=c.id AND s.active=true WHERE c.active=true GROUP BY c.id ORDER BY c.name`);
    return json(res, 200, { items: r.rows });
  }
  if (req.method === 'POST' && pathname === '/api/companies') {
    requireRole(user, 'admin');
    const b = await readJson(req); const companyId = id('cmp');
    const r = await query('INSERT INTO companies(id,name,code,description,color) VALUES($1,$2,$3,$4,$5) RETURNING *', [companyId, String(b.name || '').trim(), String(b.code || '').trim(), String(b.description || '').trim(), String(b.color || '#1677ff')]);
    await audit(user, req, 'company.create', 'company', companyId, null, r.rows[0]);
    return json(res, 201, r.rows[0]);
  }

  if (req.method === 'GET' && pathname === '/api/sites') {
    const r = await query(`SELECT s.*,c.name AS company_name FROM sites s JOIN companies c ON c.id=s.company_id WHERE s.active=true ORDER BY c.name,s.name`);
    return json(res, 200, { items: r.rows });
  }
  if (req.method === 'POST' && pathname === '/api/sites') {
    requireRole(user, 'admin');
    const b = await readJson(req); const siteId = id('site');
    const r = await query('INSERT INTO sites(id,company_id,name,code,address,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [siteId,b.companyId,String(b.name||'').trim(),String(b.code||'').trim(),String(b.address||'').trim(),String(b.description||'').trim()]);
    await audit(user, req, 'site.create', 'site', siteId, null, r.rows[0]);
    return json(res, 201, r.rows[0]);
  }

  if (req.method === 'GET' && pathname === '/api/personnel') {
    const qv = String(url.searchParams.get('q') || '').trim();
    const like = `%${qv.replace(/[%_]/g, '\\$&')}%`;
    const r = await query(`SELECT p.*,c.name AS company_name,s.name AS site_name FROM personnel p LEFT JOIN companies c ON c.id=p.company_id LEFT JOIN sites s ON s.id=p.site_id WHERE p.active=true AND ($1='' OR p.employee_code ILIKE $2 ESCAPE '\\' OR p.full_name ILIKE $2 ESCAPE '\\' OR p.phone ILIKE $2 ESCAPE '\\') ORDER BY p.full_name LIMIT 100`, [qv, like]);
    return json(res, 200, { items: r.rows });
  }
  if (req.method === 'POST' && pathname === '/api/personnel') {
    requireRole(user, 'helpdesk');
    const b = await readJson(req); const personId = id('per');
    const r = await query('INSERT INTO personnel(id,employee_code,full_name,phone,department,company_id,site_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [personId,String(b.employeeCode||'').trim(),String(b.fullName||'').trim(),String(b.phone||'').trim(),String(b.department||'').trim(),b.companyId||null,b.siteId||null,String(b.notes||'').trim()]);
    await audit(user, req, 'personnel.create', 'personnel', personId, null, r.rows[0]);
    return json(res, 201, r.rows[0]);
  }

  if (req.method === 'GET' && pathname === '/api/devices') {
    const qv = String(url.searchParams.get('q') || '').trim(); const like = `%${qv.replace(/[%_]/g, '\\$&')}%`;
    const r = await query(`SELECT d.*,c.name AS company_name,s.name AS site_name,p.full_name AS owner_name FROM devices d LEFT JOIN companies c ON c.id=d.company_id LEFT JOIN sites s ON s.id=d.site_id LEFT JOIN personnel p ON p.id=d.owner_personnel_id WHERE d.status<>'deleted' AND ($1='' OR d.name ILIKE $2 ESCAPE '\\' OR d.management_ip ILIKE $2 ESCAPE '\\' OR d.mac ILIKE $2 ESCAPE '\\' OR d.serial ILIKE $2 ESCAPE '\\' OR d.asset_tag ILIKE $2 ESCAPE '\\') ORDER BY d.updated_at DESC LIMIT 200`, [qv, like]);
    return json(res, 200, { items: r.rows });
  }
  if (req.method === 'POST' && pathname === '/api/devices') {
    requireRole(user, 'admin');
    const b = await readJson(req); const deviceId = id('dev');
    const r = await query(`INSERT INTO devices(id,name,management_ip,mac,vendor,model,serial,os_version,device_type,company_id,site_id,owner_personnel_id,owner_text,department,asset_tag,location,description,notes,status,source,custom_fields)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'manual',$20) RETURNING *`,
      [deviceId,String(b.name||'').trim(),String(b.managementIp||'').trim(),normalizeMac(b.mac),String(b.vendor||'').trim(),String(b.model||'').trim(),String(b.serial||'').trim(),String(b.osVersion||'').trim(),String(b.deviceType||'').trim(),b.companyId||null,b.siteId||null,b.ownerPersonnelId||null,String(b.ownerText||'').trim(),String(b.department||'').trim(),String(b.assetTag||'').trim(),String(b.location||'').trim(),String(b.description||'').trim(),String(b.notes||'').trim(),String(b.status||'active'),b.customFields||{}]);
    await audit(user, req, 'device.create', 'device', deviceId, null, r.rows[0]);
    return json(res, 201, r.rows[0]);
  }

  const deviceMatch = matchPattern('/api/devices/:id', pathname);
  if (deviceMatch && req.method === 'PUT') {
    requireRole(user, 'admin');
    const before = (await query('SELECT * FROM devices WHERE id=$1', [deviceMatch.id])).rows[0];
    if (!before) return json(res, 404, { error: 'not found' });
    const b = await readJson(req);
    const r = await query(`UPDATE devices SET name=$2,management_ip=$3,mac=$4,vendor=$5,model=$6,serial=$7,os_version=$8,device_type=$9,company_id=$10,site_id=$11,owner_personnel_id=$12,owner_text=$13,department=$14,asset_tag=$15,location=$16,description=$17,notes=$18,status=$19,custom_fields=$20,updated_at=now() WHERE id=$1 RETURNING *`,
      [deviceMatch.id,String(b.name??before.name),String(b.managementIp??before.management_ip),normalizeMac(b.mac??before.mac),String(b.vendor??before.vendor),String(b.model??before.model),String(b.serial??before.serial),String(b.osVersion??before.os_version),String(b.deviceType??before.device_type),b.companyId??before.company_id,b.siteId??before.site_id,b.ownerPersonnelId??before.owner_personnel_id,String(b.ownerText??before.owner_text),String(b.department??before.department),String(b.assetTag??before.asset_tag),String(b.location??before.location),String(b.description??before.description),String(b.notes??before.notes),String(b.status??before.status),b.customFields??before.custom_fields]);
    await audit(user, req, 'device.update', 'device', deviceMatch.id, before, r.rows[0]);
    return json(res, 200, r.rows[0]);
  }

  if (req.method === 'GET' && pathname === '/api/users') {
    requireRole(user, 'admin');
    const r = await query('SELECT id,username,display_name,role,active,created_at,updated_at FROM users ORDER BY username');
    return json(res, 200, { items: r.rows });
  }
  if (req.method === 'POST' && pathname === '/api/users') {
    requireRole(user, 'admin');
    const b = await readJson(req); const userId = id('usr');
    const r = await query(`INSERT INTO users(id,username,display_name,password_hash,role,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,display_name,role,active,created_at`, [userId,String(b.username||'').trim(),String(b.displayName||'').trim(),hashPassword(String(b.password||'')),String(b.role||'viewer'),b.active!==false]);
    await audit(user, req, 'user.create', 'user', userId, null, r.rows[0]);
    return json(res, 201, r.rows[0]);
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    requireRole(user, 'admin');
    const r = await query('SELECT key,value,updated_at FROM app_settings ORDER BY key');
    return json(res, 200, { items: r.rows });
  }
  const settingsMatch = matchPattern('/api/settings/:key', pathname);
  if (settingsMatch && req.method === 'PUT') {
    requireRole(user, 'admin');
    const b = await readJson(req);
    const before = (await query('SELECT value FROM app_settings WHERE key=$1', [settingsMatch.key])).rows[0]?.value ?? null;
    const r = await query(`INSERT INTO app_settings(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now() RETURNING key,value,updated_at`, [settingsMatch.key,b.value,user.id]);
    await audit(user, req, 'setting.update', 'setting', settingsMatch.key, before, r.rows[0].value);
    return json(res, 200, r.rows[0]);
  }

  if (req.method === 'GET' && pathname === '/api/audit') {
    requireRole(user, 'support');
    const r = await query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.source_ip,a.created_at,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200`);
    return json(res, 200, { items: r.rows });
  }

  if (req.method === 'GET' && pathname === '/api/backups') {
    requireRole(user, 'admin');
    const r = await query('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 100');
    return json(res, 200, { items: r.rows });
  }
  if (req.method === 'POST' && pathname === '/api/backups') {
    const result = await runBackup(user, req, 'manual');
    return json(res, 201, result);
  }

  for (const r of moduleRoutes) {
    if (r.method !== req.method) continue;
    const params = matchPattern(r.pattern, pathname);
    if (!params) continue;
    if (r.minimumRole) requireRole(user, r.minimumRole);
    return r.handler({ req, res, url, user, params, json, readJson, query, audit, id });
  }

  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  return false;
}

async function start() {
  await fs.mkdir(BACKUP_ROOT, { recursive: true });
  await migrate();
  await bootstrapAdmin();
  await query('DELETE FROM sessions WHERE expires_at<=now()');

  const discovered = await discoverModules();
  modules = await loadModuleBackends(discovered, { route, query, id }, console);
  for (const module of modules) {
    await query(`INSERT INTO module_state(module_id,enabled,installed_version,last_error) VALUES($1,true,$2,$3)
                 ON CONFLICT(module_id) DO UPDATE SET installed_version=excluded.installed_version,last_error=excluded.last_error,updated_at=now()`, [module.id, module.version || '', module.error || '']);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const user = await sessionUser(req);
      const handled = await coreRoutes(req, res, url, user);
      if (handled !== false) return;
      const moduleMatch = url.pathname.match(/^\/m\/([a-z0-9-]+)(?:\/(.*))?$/);
      if (moduleMatch) {
        if (!user) return json(res, 401, { error: 'unauthorized' });
        const module = modules.find(m => m.id === moduleMatch[1] && m.frontend && m.status !== 'error');
        if (!module) return json(res, 404, { error: 'module not found' });
        const moduleRoot = path.resolve(module.dir, path.dirname(module.frontend));
        const requested = moduleMatch[2] || path.basename(module.frontend);
        if (await serveStatic(res, moduleRoot, '/' + requested)) return;
        if (!requested.includes('.') && await serveStatic(res, moduleRoot, '/' + path.basename(module.frontend))) return;
        return json(res, 404, { error: 'module asset not found' });
      }
      if (await serveStatic(res, PUBLIC_ROOT, url.pathname)) return;
      // SPA fallback
      if (!url.pathname.includes('.')) {
        if (await serveStatic(res, PUBLIC_ROOT, '/index.html')) return;
      }
      json(res, 404, { error: 'not found' });
    } catch (error) {
      console.error(error);
      json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'internal server error' });
    }
  });

  server.listen(PORT, '0.0.0.0', () => console.log(`EMS IPAM Core listening on :${PORT}`));
}

start().catch(error => { console.error(error); process.exit(1); });
