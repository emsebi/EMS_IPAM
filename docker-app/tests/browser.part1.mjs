// Real HTTP/UI checks with a temporary embedded PostgreSQL engine.
// Run: npm run test:browser (first run: npx playwright install chromium).
// No mock API, live devices or existing database are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const appDir = path.resolve(import.meta.dirname, '..');
const port = process.env.EMS_TEST_PORT || '18191';
const baseURL = `http://127.0.0.1:${port}`;
const outputDir = path.resolve(appDir, '../docs/test-results');
await fs.mkdir(outputDir, { recursive: true });
const server = spawn(process.execPath, ['tests/helpers/embedded-server.mjs'], {
  cwd: appDir, env: { ...process.env, EMS_TEST_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
const checks = [];
const check = (name) => { checks.push(name); console.log(`PASS: ${name}`); };
let browser, page;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${serverLog}`)), 30000);
    const read = (chunk) => {
      serverLog += chunk;
      if (serverLog.includes('TEST_FIXTURES_READY')) { clearTimeout(timeout); resolve(); }
    };
    server.stdout.on('data', read); server.stderr.on('data', read);
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${serverLog}`)); });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'],
  });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 980 } });
  await context.addInitScript(() => localStorage.setItem('ems-language', 'fa'));
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  const api = async (url, method = 'GET', data, expected = 200, request = context.request) => {
    const response = await request.fetch(url, { method, ...(data === undefined ? {} : { data }), headers: { 'X-EMS-CSRF': '1' } });
    const body = await response.json();
    assert.equal(response.status(), expected, `${method} ${url}: ${JSON.stringify(body)}`);
    return body;
  };
  assert.equal((await api('/health')).database, 'ready');
  await api('/api/inventory', 'GET', undefined, 401);
  check('database health and unauthenticated API protection');
  await page.goto(baseURL);
  await page.locator('#loginUsername').fill('test-admin');
  await page.locator('#loginPassword').fill('Test-Password-01');
  await page.locator('#loginForm [type=submit]').click();
  await page.locator('#deviceTypesButton').waitFor({ state: 'visible' });
  check('real login and application bootstrap');

  await page.locator('#deviceTypesButton').click();
  await page.locator('#deviceTypeName').fill('Test Device');
  await page.locator('#deviceTypeForm [type=submit]').click();
  await page.locator('#deviceTypesList').getByText('Test Device', { exact: true }).waitFor();
  check('standalone Device Types creation');
  await page.locator('#inventoryButton').click();
  await page.locator('#newInventoryDevice').click();
  await page.locator('#inventoryCreateSpace').selectOption('test-space');
  await page.locator('#inventoryCreateIp').fill('192.0.2.50');
  await page.locator('#inventoryCreateForm [type=submit]').click();
  await page.locator('#hostName').fill('Workstation Test');
  await page.locator('#hostType').selectOption('Test Device');
  await page.locator('#hostMac').fill('02:00:00:00:00:50');
  await page.locator('#hostVlan').fill('20');
  await page.locator('#hostForm [type=submit]').click();
  await page.locator('#hostDialog').waitFor({ state: 'hidden' });
  await page.locator('.inventory-name').getByText('Workstation Test', { exact: true }).waitFor();
  const savedHost = (await api('/api/inventory')).items.find((h) => h.ip === '192.0.2.50');
  assert.equal(savedHost.type, 'Test Device');
  await page.locator(`.edit-inventory[data-id="${savedHost.id}"]`).click();
  await page.locator('#hostName').fill('Workstation Edited');
  await page.locator('#hostForm [type=submit]').click();
  await page.locator('#hostDialog').waitFor({ state: 'hidden' });
  await page.locator('.inventory-name').getByText('Workstation Edited', { exact: true }).waitFor();
  check('IP/device creation, type selection, MAC/VLAN storage and edit');

  const hostCountBeforeDuplicate = (await api('/api/inventory')).items.length;
  await page.locator('#newInventoryDevice').click();
  await page.locator('#inventoryCreateSpace').selectOption('test-space');
  await page.locator('#inventoryCreateIp').fill('192.0.2.50');
  await page.locator('#inventoryCreateForm [type=submit]').click();
  await page.waitForFunction(() => document.getElementById('inventoryCreateError')?.textContent.trim().length > 0);
  assert.equal(await page.locator('#inventoryCreateDialog').evaluate((dialog) => dialog.open), true);
  assert.equal(await page.locator('#hostDialog').evaluate((dialog) => dialog.open), false);
  const duplicateInventory = await api('/api/inventory');
  assert.equal(duplicateInventory.items.length, hostCountBeforeDuplicate);
  assert.equal(duplicateInventory.items.find((h) => h.ip === '192.0.2.50')?.name, 'Workstation Edited');
  await page.locator('#inventoryCreateDialog [data-close]').first().click();
  check('duplicate IP create is rejected without overwriting the existing device');

  // Browser feedback and URI contents are verified without invoking an OS protocol handler.
  await api('/api/hosts', 'PUT', { ...savedHost, name: 'Workstation Edited', connectionMethods: [{ type: 'WINBOX', port: 8291 }] });
  await page.locator('#inventoryButton').click();
  await page.locator('#refreshInventory').click();
  await page.locator(`.inventory-tools[data-id="${savedHost.id}"]`).click();
  await page.locator('#toolMenu [data-tool=MIK]').waitFor();
  // An external-scheme navigation has no handler in headless Linux; the dialog must remain usable.
  await page.locator('#toolMenu [data-tool=MIK]').click();
  await page.locator('#clientLaunchDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#clientTarget').inputValue(), '192.0.2.50');
  const launchUrl = new URL(await page.locator('#clientLaunchLink').getAttribute('href'));
  assert.equal(launchUrl.protocol, 'emsipam-client:');
  assert.equal(launchUrl.searchParams.get('host'), '192.0.2.50');
  assert.equal(launchUrl.searchParams.get('port'), '8291');
  assert.equal(launchUrl.searchParams.has('password'), false);
  await page.locator('#clientTarget').click();
  assert.equal(await page.locator('#clientTarget').evaluate(el=>el.selectionEnd-el.selectionStart), '192.0.2.50'.length);
  await page.screenshot({ path: path.join(outputDir, 'client-connection.png'), fullPage: true });
  await page.locator('#clientLaunchDialog [data-close]').click();
  const clientGuide = await context.newPage();
  await clientGuide.goto('/client.html');
  const download = clientGuide.locator('a[download]');
  const archive = await context.request.get(await download.getAttribute('href'));
  assert.equal(archive.status(), 200);
  assert.equal((await archive.body()).subarray(0,2).toString(), 'PK');
  await clientGuide.screenshot({ path: path.join(outputDir, 'client-guide.png'), fullPage: true });
  await clientGuide.close();
  const ipamPreview = await context.newPage();
  await ipamPreview.goto('/#/ipam/test-space/192.0.2.0%2F24');
  await ipamPreview.locator('#sheetSelect').waitFor();
  await ipamPreview.screenshot({ path: path.join(outputDir, 'ipam.png'), fullPage: true });
  await ipamPreview.close();
  check('MIK link, IP-only default target, selectable fallback, client guide and ZIP download');

  await page.locator('#deviceTypesButton').click();
  const row = page.locator('#deviceTypesList .user-row').filter({ has: page.getByText('Test Device', { exact: true }) });
  await row.locator('.edit-device-type').click();
  await page.locator('#deviceTypeName').fill('Office Computer');
  await page.locator('#deviceTypeForm [type=submit]').click();
  await page.locator('#deviceTypesList').getByText('Office Computer', { exact: true }).waitFor();
  assert.equal((await api('/api/inventory')).items.find((h) => h.id === savedHost.id).type, 'Office Computer');
  await page.locator('#deviceTypesList .user-row').filter({ has: page.getByText('Office Computer', { exact: true }) }).locator('.delete-device-type').click();
  await page.waitForFunction(() => document.getElementById('deviceTypeError').textContent.length > 0);
  assert.ok((await api('/api/device-types')).items.some((i) => i.name === 'Office Computer'));
  await page.locator('#deviceTypeName').fill('Disposable Type');
  await page.locator('#deviceTypeForm [type=submit]').click();
  const unusedRow = page.locator('#deviceTypesList .user-row').filter({ has: page.getByText('Disposable Type', { exact: true }) });
  await unusedRow.locator('.delete-device-type').click();
  await unusedRow.waitFor({ state: 'hidden' });
  assert.ok(!(await api('/api/device-types')).items.some((i) => i.name === 'Disposable Type'));
  check('type rename propagates; used type deletion blocked; unused type deletion works');
  await page.screenshot({ path: path.join(outputDir, 'device-types.png'), fullPage: true });

  await page.locator('#radiosButton').click();
  await page.locator('.radio-ap-choice[data-id=ap2]').click();
  await page.locator('.radio-station-list').getByText('Station Two', { exact: true }).waitFor();
  assert.equal(await page.locator('.radio-station-list').getByText('Station One', { exact: true }).count(), 0);
  await page.locator('#addSelectedStation').click();
  assert.equal(await page.locator('#radioQuickParent').inputValue(), 'ap2');
  assert.equal(await page.locator('#radioQuickMode').inputValue(), 'station');
  await page.screenshot({ path: path.join(outputDir, 'radios.png'), fullPage: true });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 980 });
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, view: innerWidth }));
    assert.ok(dimensions.content <= dimensions.view + 1, `Radio page overflows at ${width}: ${JSON.stringify(dimensions)}`);
  }
  await page.screenshot({ path: path.join(outputDir, 'radios-mobile.png'), fullPage: true });
  await page.locator('.nav-group summary').click();
  await page.locator('#radiosButton').click();
  await page.locator('.radio-station-list').getByText('Station Two', { exact: true }).waitFor();
  assert.equal(await page.locator('.nav-group').getAttribute('open'), null);
  await page.setViewportSize({ width: 1440, height: 980 });
  check('AP selection shows only its stations; parent retained; responsive widths and mobile submenu');

  await page.locator('#networkAccessButton').click();
  await page.locator('.access-records').getByText('Workstation Edited', { exact: true }).waitFor();
  await page.locator('#personnelTab').click();
  await page.locator('#managePersonnel').click();
  await page.locator('#personnelName').fill('Test Person');
  await page.locator('#personnelForm [type=submit]').click();
  await page.locator('#personnelList').getByText('Test Person', { exact: true }).waitFor();
  await page.locator('#personnelDialog [data-close]').first().click();
  await page.locator('.access-records').getByText('Test Person', { exact: true }).waitFor();
  const persons = await api('/api/personnel?q=Test&offset=0&limit=1');
  assert.equal(persons.total, 1); assert.equal(persons.items[0].fullName, 'Test Person');
  const exported = await context.request.get('/api/personnel/export?q=Test');
  assert.equal(exported.status(), 200); assert.match(await exported.text(), /Test Person/);
  check('MAC and Personnel tabs; name-only personnel create; refresh, search and export');

  await page.locator('#settingsButton').click();
  await page.locator('#settingsDialog').waitFor();
  assert.equal(await page.locator('#settingsDialog [data-settings-tab=personnel], #settingsDialog [data-settings-tab=device-types]').count(), 0);
  assert.equal(await page.locator('#settingsDialog form').count(), 1);
  await page.locator('#settingsManageDevices').waitFor({ state: 'visible' });
  await page.locator('#settingsManageDeviceTypes').waitFor({ state: 'visible' });
  await page.locator('#settingsManageDevices').click();
  await page.locator('#newInventoryDevice').waitFor({ state: 'visible' });
  await page.locator('#settingsButton').click();
  await page.locator('#settingsDialog').waitFor();
  await page.locator('#settingsManageDeviceTypes').click();
  await page.locator('#deviceTypesList').waitFor({ state: 'visible' });
  await page.locator('#settingsButton').click();
  await page.locator('#settingsDialog').waitFor();
  await page.locator('#settingsDialog [data-close]').first().click();
  assert.equal(await page.locator('#personnelButton').count(), 0);
  check('Settings opens; device shortcuts navigate to Inventory and Device Types; Personnel remains standalone');

  await api('/api/users', 'POST', { username: 'viewer-test', password: 'ReadOnly-Test-123', role: 'viewer', companyIds: ['test-co'], moduleIds: ['ipam', 'inventory', 'radio'] }, 201);
  const viewer = await browser.newContext({ baseURL });
  await api('/api/auth/login', 'POST', { username: 'viewer-test', password: 'ReadOnly-Test-123' }, 200, viewer.request);
  assert.equal((await api('/api/inventory', 'GET', undefined, 200, viewer.request)).items.length, 7);
  await api('/api/device-types', 'POST', { name: 'Forbidden' }, 403, viewer.request);
  await api('/api/hosts', 'PUT', { spaceId: 'test-space', ip: '192.0.2.99', name: 'Forbidden' }, 403, viewer.request);
  await api('/api/personnel', 'GET', undefined, 403, viewer.request);
  await viewer.close();
  check('viewer can read assigned inventory; cannot mutate hosts/types or list personnel');
  assert.deepEqual(errors, []);
  check('no uncaught browser errors throughout tested flows');
  await fs.writeFile(path.join(outputDir, 'browser-result.json'), JSON.stringify({ status: 'passed', timestamp: new Date().toISOString(), database: 'PGlite test adapter; production pg driver not exercised', browser: browser.version(), checks }, null, 2) + '\n');
  console.log(`${checks.length} browser/API scenarios passed.`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true });
    console.error(await page.locator('#inventoryCreateError, #hostFormError, #toast').allTextContents());
  }
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
  await fs.writeFile(path.join(outputDir, 'embedded-server.log'), serverLog);
}
