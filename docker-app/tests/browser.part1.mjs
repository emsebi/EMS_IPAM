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
  await page.locator('#companySelect').waitFor({state:'hidden'});
  assert.equal(await page.locator('#spaceSelect').isVisible(), false);

  await page.locator('.r-tabs button[data-tab="collections"]').click();
  await page.locator('#rAdd').click();
  assert.equal(await page.locator('#rCollectionForm [name="companyId"]').count(), 0);
  await page.locator('#rCollectionForm [name="name"]').fill('Browser Hotspot');
  assert.equal(await page.locator('#rCollectionForm [name="members"]').count(), 0);
  await page.locator('#rCollectionForm [type=submit]').click();
  await page.locator('.r-list').getByText('Browser Hotspot', { exact: true }).waitFor();

  await page.locator('.r-tabs button[data-tab="clients"]').click();
  await page.locator('#rSecretsOpen').click();
  assert.equal(await page.locator('#rSecretForm [name="companyId"]').count(), 0);
  await page.locator('#rSecretForm [name="name"]').fill('Browser Shared Secret');
  await page.locator('#rSecretForm [name="secret"]').fill('shortsec');
  await page.locator('#rSecretForm [type=submit]').click();
  await page.locator('.r-secret-list').getByText('Browser Shared Secret', { exact: true }).waitFor();
  const secretRow = page.locator('.r-secret-list tbody tr').filter({ hasText: 'Browser Shared Secret' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await secretRow.locator('.rRevealSecret').click();
  await page.waitForFunction(() => document.querySelector('#rCredentialValue')?.value === 'shortsec');
  await page.locator('#rCredentialCopy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'shortsec');
  await page.locator('#rCredentialHide').click();
  assert.equal(await page.locator('#rCredentialValue').inputValue(), '');
  assert.equal(await page.locator('#rCredentialDialog').evaluate(el => el.open), false);
  await page.locator('#rSecretClose').click();

  await page.locator('#rAdd').click();
  assert.equal(await page.locator('#rClientForm [name="companyId"]').count(), 0);
  await page.locator('#rClientForm [name="label"]').fill('Browser NAS');
  await page.locator('#rClientForm [name="nasIp"]').fill('192.0.2.200');
  await page.locator('#rClientForm [name="secretProfileId"]').selectOption({ label: 'Browser Shared Secret' });
  const collectionChoice = page.locator('#rClientCollections .r-rule-check').filter({ hasText: 'Browser Hotspot' });
  await collectionChoice.locator('.rClientCollection').check();
  await page.locator('#rClientForm [type=submit]').click();
  await page.locator('.r-list').getByText('Browser NAS', { exact: true }).waitFor();
  const radiusDevices = await api('/api/radius-ops/devices');
  const browserNas = radiusDevices.items.find((item) => item.label === 'Browser NAS');
  assert.equal(browserNas.companyId, null); assert.ok(browserNas); assert.equal(browserNas.nasIp, '192.0.2.200');
  assert.equal(browserNas.secretProfileName, 'Browser Shared Secret');
  assert.deepEqual(browserNas.collectionNames, ['Browser Hotspot']);
  assert.equal(Object.hasOwn(browserNas, 'secret'), false);

  await page.locator('.r-tabs button[data-tab="groups"]').click();
  await page.locator('#rAdd').click();
  assert.equal(await page.locator('#rGroupForm [name="companyId"]').count(), 0);
  await page.locator('#rGroupForm [name="name"]').fill('Network Admin');
  await page.locator('#rGroupForm [name="ciscoPrivilege"]').fill('15');
  await page.locator('#rGroupForm [name="mikrotikPreset"]').selectOption('full');
  await page.locator('#rGroupForm [type=submit]').click();
  await page.locator('.r-list').getByText('Network Admin', { exact: true }).waitFor();

  await page.locator('.r-tabs button[data-tab="collections"]').click();
  const collectionRow = page.locator('.r-list tbody tr').filter({ hasText: 'Browser Hotspot' });
  await collectionRow.getByText('Browser NAS', { exact: false }).waitFor();
  await page.screenshot({path:path.join(outputDir,'radius-1.1.0-collections.png'),fullPage:true});

  await page.locator('.r-tabs button[data-tab="users"]').click();
  await page.locator('#rAdd').click();
  assert.equal(await page.locator('#rUserForm [name="companyId"]').count(), 0);
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
  assert.equal(browserUser.companyId, null); assert.ok(browserUser); assert.equal(browserUser.accessRules.length, 1);
  assert.equal(browserUser.accessRules[0].collectionName, 'Browser Hotspot');
  assert.equal(browserUser.accessRules[0].profileName, 'Network Admin');
  assert.equal(Object.hasOwn(browserUser, 'password'), false);
  await page.screenshot({path:path.join(outputDir,'radius-1.1.0-users.png'),fullPage:true});
  const userRow = page.locator('.r-list tbody tr').filter({ hasText: 'browseradmin' });
  await userRow.locator('.rRevealPassword').click();
  await page.waitForFunction(() => document.querySelector('#rCredentialValue')?.value === '1234');
  await page.screenshot({ path: path.join(outputDir, 'radius-password-display.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#rCredentialValue')?.value === '');
  // Viewing the saved value must not erase an unsaved replacement in the edit form.
  await userRow.locator('.rEdit').click();
  await page.locator('#rUserForm [name=password]').fill('unsaved-replacement');
  await page.locator('#rUserForm .rRevealPassword').click();
  await page.waitForFunction(() => document.querySelector('#rCredentialValue')?.value === '1234');
  await page.locator('#rCredentialClose').click();
  assert.equal(await page.locator('#rUserForm [name=password]').inputValue(), 'unsaved-replacement');
  await page.locator('#rCancel').click();
  for (const [route, value] of [[`/api/radius-ops/accounts/${browserUser.id}/reveal-password`, '1234'], [`/api/radius-ops/secret-profiles/${browserNas.secretProfileId}/reveal`, 'shortsec']]) {
    const response = await context.request.post(route, { data: {}, headers: { 'X-EMS-CSRF': '1' } });
    assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /no-store/);
    assert.equal((await response.json()).value, value);
    await api(route, 'GET', undefined, 404);
    const anonymous = await browser.newContext({ baseURL });
    await api(route, 'POST', {}, 401, anonymous.request);
    await anonymous.close();
  }
  check('Admin can reveal, copy and hide saved RADIUS credentials without changing unsaved edits; responses are not cached');

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

  // Keep map-only overlapping inventory out of earlier module layout fixtures.
  const inventoryBeforeTrace=(await api('/api/inventory')).items.map(h=>h.id).sort();
  const traceSpace=await api('/api/spaces','POST',{companyId:'test-co',name:'Overlapping fixture',cidr:'192.0.2.0/23'},201);
  await api('/api/hosts','PUT',{spaceId:'test-space',ip:'192.0.2.60',name:'Trace candidate A',mac:'02:00:00:00:00:60'});
  await api('/api/hosts','PUT',{spaceId:traceSpace.id,ip:'192.0.2.60',name:'Trace candidate B',mac:'02:00:00:00:00:61'});
  await page.reload();
  // Static sidebar elements can be visible before asynchronous bootstrap registers click handlers.
  await page.locator('button.module-nav-link[data-module-id="radius"]').waitFor({state:'visible'});
  // Finish restoring the RADIUS route after reload before navigating away.
  // Module navigation is registered before the asynchronous route content renders.
  await page.locator('.r-tabs').waitFor({state:'visible'});
  // Isolated NAC draft UI: no RADIUS live change, network access or switch commands.
  await page.locator('#networkAccessButton').click();
  await page.locator('#nacProfilesTab').click();
  await page.locator('#nacProfileName').waitFor({state:'visible'});
  assert.match(page.url(), /#\/module\/network-access$/);
  await page.locator('#nacProfileName').fill('Browser Guest 77');
  await page.locator('#nacKnownMode').selectOption('accept-vlan');
  await page.locator('#nacKnownVlan').fill('14');
  await page.locator('#nacUnknownMode').selectOption('guest-vlan');
  await page.locator('#nacGuestVlan').fill('77');
  await page.locator('#nacProfileEnabled').check();
  await page.locator('#nacSaveProfile').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#nacProfileChoice option')].some(o => o.textContent === 'Browser Guest 77'));
  const browserNacProfile = (await api('/api/nac/overview')).profiles.find(p=>p.name==='Browser Guest 77');
  assert.ok(browserNacProfile);
  await page.locator('#nacNasChoice').selectOption(browserNas.id);
  await page.locator('#nacBindingProfile').selectOption(browserNacProfile.id);
  await page.locator('#nacBindingEnabled').check();
  await page.locator('#nacSaveBinding').click();
  await page.waitForFunction(async ({nasId,profileId}) => {
    const res=await fetch('/api/nac/overview',{credentials:'same-origin'});
    if(!res.ok)return false;
    const data=await res.json();
    return data.nas?.some(n=>n.id===nasId && n.profileId===profileId && n.bindingEnabled===true);
  },{nasId:browserNas.id,profileId:browserNacProfile.id});
  await page.waitForFunction((nasId) => document.getElementById('nacNasChoice')?.value===nasId
    && document.getElementById('nacBindingEnabled')?.checked, browserNas.id);
  const nacApiPreview = await api('/api/nac/preview?nasId='+browserNas.id+'&mac=02:12:34:56:78:9a');
  assert.equal(nacApiPreview.result.portOutcome,'guest-vlan-if-switch-configured',JSON.stringify(nacApiPreview));
  await page.locator('#nacPreviewMac').fill('02:12:34:56:78:9a');
  await page.locator('#nacRunPreview').click();
  await page.waitForFunction(() => document.getElementById('nacPreviewResult')?.textContent.includes('guest-vlan-if-switch-configured'));
  assert.match(await page.locator('#nacPreviewResult').textContent(), /"vlan": 77/);
  await page.locator('#nacVendorChoice').selectOption('cisco-legacy');
  await page.locator('#nacRadiusIp').fill('192.0.2.20');
  await page.locator('#nacInterface').fill('Gi1/0/4');
  await page.locator('#nacShowConfig').click();
  await page.waitForFunction(() => document.getElementById('nacConfig')?.value.includes('REPLACE_SHARED_SECRET'));
  assert.match(await page.locator('#nacConfig').inputValue(), /dot1x guest-vlan 77/);
  await page.locator('#nacRuleMac').fill('02:12:34:56:78:9a');
  await page.locator('#nacRuleMode').selectOption('reject');
  await page.locator('#nacSaveRule').click();
  await page.locator('#nacRules').getByText('02:12:34:56:78:9a', {exact:false}).waitFor();
  await page.locator('#nacRunPreview').click();
  await page.waitForFunction(() => document.getElementById('nacPreviewResult')?.textContent.includes('"portOutcome": "blocked"'));
  await page.screenshot({path:path.join(outputDir,'nac-profile-draft.png'),fullPage:true});
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:980});
    const info=await page.locator('.nac-grid').evaluate(el=>({content:el.scrollWidth,view:el.clientWidth}));
    assert.ok(info.content <= info.view+1, 'NAC profile overflow at '+width);
  }
  await api('/api/nac/preview?nasId='+browserNas.id+'&mac=02:12:34:56:78:9a');
  check('NAC per-switch guest profile, MAC override, simulator, read-only CLI and responsive UI');
  await page.locator('button.module-nav-link[data-module-id="network-map"]').click();
  await page.locator('#nmSettings').waitFor({state:'visible'});
  await page.locator('#nmUsername').fill('browser-readonly');
  await page.locator('#nmPassword').fill('Browser-Map-Password');
  await page.locator('#nmTargets').fill('192.0.2.10 | cisco | Browser Core\n192.0.2.12 | cisco | Disconnected fixture\n192.0.2.13 | cisco | Uncollected root');
  await page.locator('#nmRoot').fill('192.0.2.10');
  await page.locator('#nmSettings [type="submit"]').click();
  await page.locator('#nmScan').waitFor({state:'visible'});
  const mapSettings=await api('/api/network-map/settings?companyId=test-co');
  assert.equal(mapSettings.hasPassword,true);
  assert.equal(JSON.stringify(mapSettings).includes('Browser-Map-Password'),false);
  assert.equal((await api('/api/network-map/snapshots?companyId=test-co')).items.length,0);
  assert.equal(await page.locator('.nm-canvas').count(),1);
  check('Smart Network Map saves encrypted read-only settings without starting discovery');
  await page.screenshot({path:path.join(outputDir,'network-map-settings.png'),fullPage:true});

  const traceMutations=[];
  const traceRequest=req=>{if(req.url().includes('/api/network-map/')&&req.method()!=='GET')traceMutations.push(req.url());};
  page.on('request',traceRequest);
  await page.locator('#nmTraceKind').selectOption('ip');
  await page.locator('#nmMac').fill('192.0.2.60');
  await page.locator('#nmTraceForm [type=submit]').click();
  await page.locator('.nm-ip-record').first().waitFor();
  assert.equal(await page.locator('.nm-ip-record').count(),2);
  assert.equal(await page.locator('[data-ip-mac]').count(),2);
  const ipText=await page.locator('.nm-ip-result').textContent();
  assert.match(ipText,/Test LAN/);assert.match(ipText,/Overlapping fixture/);assert.match(ipText,/نامطمئن/);assert.match(ipText,/ویرایش رکورد/);assert.match(ipText,/مشاهده IP\/MAC: دریافت نشده/);
  await page.locator('[data-ip-mac="02:00:00:00:00:60"]').click();
  await page.locator('.nm-trace-result').waitFor();
  assert.match(await page.locator('.nm-trace-result').textContent(),/mac-address-table/);
  assert.match(await page.locator('.nm-trace-result').textContent(),/قدیمی/);
  assert.match(await page.locator('#nmPortDetail').textContent(),/Gi1/);
  assert.equal(await page.locator('.nm-path-status').getAttribute('data-path-status'),'at-root');
  await page.locator('#nmMac').fill('192.0.2.99');
  await page.locator('#nmTraceForm [type=submit]').click();
  await page.locator('.nm-ip-result').getByText(/رکورد IP یافت نشد/).waitFor();
  assert.equal(await page.locator('[data-ip-mac]').count(),0);
  await page.locator('#nmTraceKind').selectOption('mac');
  await page.locator('#nmMac').fill('02:00:00:00:00:61');
  await page.locator('#nmTraceForm [type=submit]').click();
  await page.locator('.nm-trace-result').waitFor();
  assert.match(await page.locator('#nmPortDetail').textContent(),/Gi2/);
  assert.equal(await page.locator('.nm-ip-result').count(),0);
  await page.locator('#nmClearTrace').click();
  assert.equal(await page.locator('#nmTraceResult').textContent(),'');
  page.off('request',traceRequest);assert.deepEqual(traceMutations,[]);
  assert.equal((await api('/api/network-map/snapshots?companyId=test-co')).items.length,0);
  check('IP trace shows every candidate and provenance; MAC trace preserved; no collection writes');

  const pathWrites=[];
  const pathRequest=req=>{if(req.url().includes('/api/network-map/')&&req.method()!=='GET')pathWrites.push(req.url());};
  const tracePath=async(mac,status)=>{
    await page.locator('#nmMac').fill(mac);
    const reply=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/network-map/trace'&&u.searchParams.get('mac')===mac;});
    await page.locator('#nmTraceForm [type=submit]').click();
    assert.equal((await reply).status(),200);
    await page.locator(`.nm-path-status[data-path-status="${status}"]`).waitFor();
  };
  const setTraceRoot=async(root)=>{
    page.off('request',pathRequest);
    await page.locator('[data-nm-tab="settings"]').click();
    await page.locator('#nmRoot').fill(root);
    await page.locator('#nmSettings [type=submit]').click();
    await page.locator('#nmScan').waitFor({state:'visible'});
    assert.equal(await page.locator('#nmTraceResult').textContent(),'','changing root invalidates paths calculated for the previous root');
    page.on('request',pathRequest);
  };
  page.on('request',pathRequest);
  await tracePath('02:00:00:00:00:60','at-root');
  assert.match(await page.locator('.nm-path-status').textContent(),/مشاهده روی سوئیچ ریشه/);
  await tracePath('02:00:00:00:00:62','no-path');
  assert.match(await page.locator('.nm-path-status').textContent(),/قطعی زنده تأیید نشده/);
  assert.match(await page.locator('.nm-trace-result').textContent(),/mac-address-table/);
  assert.match(await page.locator('.nm-trace-result').textContent(),/قدیمی/);
  assert.match(await page.locator('#nmPortDetail').textContent(),/Gi9/);
  await page.screenshot({path:path.join(outputDir,'network-map-missing-path.png'),fullPage:true});
  await setTraceRoot('');
  await tracePath('02:00:00:00:00:62','root-unset');
  await setTraceRoot('192.0.2.13');
  await tracePath('02:00:00:00:00:62','root-unavailable');
  await setTraceRoot('192.0.2.12');
  await tracePath('02:00:00:00:00:62','at-root');
  await setTraceRoot('192.0.2.10');
  await page.locator('#nmClearTrace').click();
  page.off('request',pathRequest);
  assert.deepEqual(pathWrites,[]);
  assert.equal((await api('/api/network-map/snapshots?companyId=test-co')).items.length,0);
  check('MAC path distinguishes missing root, absent root, disconnected observation and root-local observation without discovery');

  // Restore the inventory fixture before unrelated module and viewer checks.
  await api('/api/hosts/test-space/192.0.2.60','DELETE');
  await api(`/api/hosts/${traceSpace.id}/192.0.2.60`,'DELETE');
  await api(`/api/spaces/${traceSpace.id}`,'DELETE');
  assert.deepEqual((await api('/api/inventory')).items.map(h=>h.id).sort(),inventoryBeforeTrace);

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
  await page.locator('#companySelect').waitFor({state:'visible'});
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
  await api(`/api/radius-ops/accounts/${browserUser.id}/reveal-password`, 'POST', {}, 403, viewer.request);
  await api(`/api/radius-ops/secret-profiles/${browserNas.secretProfileId}/reveal`, 'POST', {}, 403, viewer.request);
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
