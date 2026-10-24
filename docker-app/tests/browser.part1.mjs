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
  await context.addInitScript(() => {
    if (!localStorage.getItem('ems-language')) localStorage.setItem('ems-language', 'fa');
  });
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

  await page.locator('button.module-nav-link[data-module-id="radius"]').click();
  await page.locator('.r-tabs button[data-tab="clients"]').waitFor({ state: 'visible' });
  assert.match(page.url(), /#\/module\/radius$/);

  await page.locator('.r-tabs button[data-tab="collections"]').click();
  await page.locator('#rAdd').click();
  await page.locator('#rCollectionForm [name="companyId"]').selectOption('test-co');
  await page.locator('#rCollectionForm [name="name"]').fill('Browser Hotspot');
  assert.equal(await page.locator('#rCollectionForm [name="members"]').count(), 0);
  await page.locator('#rCollectionForm [type=submit]').click();
  await page.locator('.r-list').getByText('Browser Hotspot', { exact: true }).waitFor();

  await page.locator('.r-tabs button[data-tab="clients"]').click();
  await page.locator('#rSecretsOpen').click();
  await page.locator('#rSecretForm [name="companyId"]').selectOption('test-co');
  await page.locator('#rSecretForm [name="name"]').fill('Browser Shared Secret');
  await page.locator('#rSecretForm [name="secret"]').fill('shortsec');
  await page.locator('#rSecretForm [type=submit]').click();
  await page.locator('.r-secret-list').getByText('Browser Shared Secret', { exact: true }).waitFor();
  const secretRow = page.locator('.r-secret-list tbody tr').filter({ hasText: 'Browser Shared Secret' });
  assert.equal(await secretRow.locator('.rRevealSecret').count(), 0);
  assert.equal(await page.locator('.r-credential-value').count(), 0);
  await page.locator('#rSecretClose').click();

  await page.locator('#rAdd').click();
  await page.locator('#rClientForm [name="companyId"]').selectOption('test-co');
  await page.locator('#rClientForm [name="label"]').fill('Browser NAS');
  await page.locator('#rClientForm [name="nasIp"]').fill('192.0.2.200');
  await page.locator('#rClientForm [name="secretProfileId"]').selectOption({ label: 'Browser Shared Secret' });
  const collectionChoice = page.locator('#rClientCollections .r-rule-check').filter({ hasText: 'Browser Hotspot' });
  await collectionChoice.locator('.rClientCollection').check();
  await page.locator('#rClientForm [type=submit]').click();
  await page.locator('.r-list').getByText('Browser NAS', { exact: true }).waitFor();
  const radiusDevices = await api('/api/radius-ops/devices');
  const browserNas = radiusDevices.items.find((item) => item.label === 'Browser NAS');
  assert.ok(browserNas); assert.equal(browserNas.nasIp, '192.0.2.200');
  assert.equal(browserNas.secretProfileName, 'Browser Shared Secret');
  assert.deepEqual(browserNas.collectionNames, ['Browser Hotspot']);
  assert.equal(Object.hasOwn(browserNas, 'secret'), false);

  await page.locator('.r-tabs button[data-tab="groups"]').click();
  await page.locator('#rAdd').click();
  await page.locator('#rGroupForm [name="companyId"]').selectOption('test-co');
  await page.locator('#rGroupForm [name="name"]').fill('Network Admin');
  await page.locator('#rGroupForm [name="ciscoPrivilege"]').fill('15');
  await page.locator('#rGroupForm [name="mikrotikPreset"]').selectOption('full');
  await page.locator('#rGroupForm [type=submit]').click();
  await page.locator('.r-list').getByText('Network Admin', { exact: true }).waitFor();

  await page.locator('.r-tabs button[data-tab="collections"]').click();
  const collectionRow = page.locator('.r-list tbody tr').filter({ hasText: 'Browser Hotspot' });
  await collectionRow.getByText('Browser NAS', { exact: false }).waitFor();

  await page.locator('.r-tabs button[data-tab="users"]').click();
  await page.locator('#rAdd').click();
  await page.locator('#rUserForm [name="companyId"]').selectOption('test-co');
  await page.locator('#rUserForm [name="username"]').fill('browseradmin');
  await page.locator('#rUserForm [name="label"]').fill('Browser Admin');
  await page.locator('#rUserForm [name="password"]').fill('1234');
  const accessRow = page.locator('.r-rule-row').filter({ hasText: 'Browser Hotspot' });
  await accessRow.locator('.rRuleCheck').check();
  await accessRow.locator('.rRuleProfile').selectOption({ label: 'Network Admin' });
  await page.locator('#rUserForm [type=submit]').click();
  await page.locator('.r-list').getByText('browseradmin', { exact: true }).waitFor();
  const radiusUsers = await api('/api/radius-ops/accounts');
  const browserUser = radiusUsers.items.find((item) => item.username === 'browseradmin');
  assert.ok(browserUser); assert.equal(browserUser.accessRules.length, 1);
  assert.equal(browserUser.accessRules[0].collectionName, 'Browser Hotspot');
  assert.equal(browserUser.accessRules[0].profileName, 'Network Admin');
  assert.equal(Object.hasOwn(browserUser, 'password'), false);
  const userRow = page.locator('.r-list tbody tr').filter({ hasText: 'browseradmin' });
  assert.equal(await userRow.locator('.rRevealPassword').count(), 0);
  assert.equal(await page.locator('.r-credential-value').count(), 0);
  await api(`/api/radius-ops/accounts/${browserUser.id}/reveal-password`, 'POST', {}, 403);
  await api(`/api/radius-ops/secret-profiles/${browserNas.secretProfileId}/reveal`, 'POST', {}, 403);

  await page.locator('.r-tabs button[data-tab="clients"]').click();
  await page.locator('#rOpenConfig').click();
  await page.locator('#rConfigForm [name="clientId"]').selectOption({ label: 'Browser NAS — 192.0.2.200' });
  await page.locator('#rConfigForm [name="vendor"]').selectOption('cisco-ios');
  await page.locator('#rConfigForm [name="radiusIp"]').fill('192.0.2.5');
  await page.locator('#rConfigForm [type=submit]').click();
  await page.locator('#rConfigText').getByText(/aaa new-model/).waitFor();
  const configText = await page.locator('#rConfigText').textContent();
  assert.match(configText, /radius server EMS-RADIUS/);
  assert.match(configText, /SET_SHARED_SECRET_HERE/);
  assert.equal(configText.includes('shortsec'), false);
  assert.equal(configText.includes('1234'), false);
  check('RADIUS simple client/group/user flow persists and manual config is generated');

  await page.locator('#rConfigClose').click();
  await page.locator('.r-tabs button[data-tab="clients"]').click();
  await page.locator('.r-list').getByText('Browser NAS', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'radius.png'), fullPage: true });

  await page.locator('button.module-nav-link[data-module-id="reports"]').click();
  await page.locator('#reportsMetrics').waitFor({ state: 'visible' });
  assert.match(page.url(), /#\/module\/reports$/);
  assert.equal(await page.locator('#reportsMetrics .report-metric').count(), 8);
  const reportSummary = await api('/api/reports/summary');
  assert.equal(reportSummary.summary.branches, 0);
  assert.equal(reportSummary.summary.radiusNas, 1);
  assert.equal(reportSummary.summary.radiusPolicies, 0);
  assert.equal((await page.locator('#reportsAuditBody').textContent()).includes('do-not-return'), false);
  check('Reports module summarizes optional modules and shows redacted audit activity');
  await page.screenshot({ path: path.join(outputDir, 'reports.png'), fullPage: true });

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

  const donations = [
    { id: 'donationUsdt', address: 'TTtgCYCdWR8PxdacyWgaRPX6cj4raD2BxH', uri: 'tron:TTtgCYCdWR8PxdacyWgaRPX6cj4raD2BxH?req-asset=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
    { id: 'donationBtc', address: 'bc1qy5ktdduz7p23nds67u4tmpa3se4cetxsnurzr0', uri: 'bitcoin:bc1qy5ktdduz7p23nds67u4tmpa3se4cetxsnurzr0' },
  ];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#userMenuButton').click();
  await page.locator('#aboutButton').click();
  await page.locator('#donationTitle').getByText('حمایت از توسعه EMS_IPAM', { exact: true }).waitFor();
  for (const item of donations) {
    assert.equal(await page.locator(`#${item.id}`).inputValue(), item.address);
    assert.equal(await page.locator(`#${item.id}`).getAttribute('dir'), 'ltr');
    assert.equal(await page.locator(`#${item.id}`).evaluate(input => input.readOnly), true);
    const card = page.locator('.donation-card').filter({ has: page.locator(`#${item.id}`) });
    assert.equal(await card.locator('a').getAttribute('href'), item.uri);
    await card.locator('img').evaluate(async img => { await img.decode(); });
    await card.locator('[data-copy-donation]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), item.address);
    await page.locator('#donationCopyStatus').getByText('آدرس کپی شد.', { exact: true }).waitFor();
  }
  await page.locator('.donation-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, 'about-support.png') });
  for (const width of [390, 600, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    const dimensions = await page.locator('#aboutDialog .modal-body').evaluate(el => ({ content: el.scrollWidth, view: el.clientWidth }));
    assert.ok(dimensions.content <= dimensions.view + 1, `Donation content overflows at ${width}`);
  }
  await page.locator('#aboutDialog [data-close]').click();
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('#languageSelect').selectOption('en'),
  ]);
  await page.locator('#userMenuButton').click();
  await page.locator('#aboutButton').click();
  await page.locator('#donationTitle').getByText('Support EMS_IPAM', { exact: true }).waitFor();
  await page.locator('.donation-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, 'about-support-en.png') });
  // Exercise the LAN HTTP path with Clipboard API absent; no wallet is opened.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.locator('[data-copy-donation="donationUsdt"]').click();
  await page.locator('#donationCopyStatus').getByText('Address copied.', { exact: true }).waitFor();
  assert.equal(await page.locator('#donationUsdt').evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), donations[0].address);
  // A denied legacy copy must offer manual selection instead of claiming success.
  await page.evaluate(() => { document.execCommand = () => false; });
  await page.locator('[data-copy-donation="donationBtc"]').click();
  await page.locator('#donationCopyStatus').getByText('Address selected. Copy it manually using your device’s copy command.', { exact: true }).waitFor();
  assert.equal(await page.locator('#donationBtc').evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), donations[1].address);
  await page.locator('#aboutDialog [data-close]').click();
  check('Donation addresses, wallet links, bundled QRs, copy/fallback, English/Persian labels and responsive About dialog');

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
