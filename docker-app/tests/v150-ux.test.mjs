import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v1.5 restores language control, editable device taxonomy and personnel transfer', async () => {
  const [html, app, server, schema] = await Promise.all([
    fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../server/main.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'),
  ]);
  for (const token of ['languageButton','deviceTypeForm','deviceTypesList','exportPersonnel','importPersonnel','usersBackSettings','personnelBackSettings']) assert.match(html, new RegExp(token));
  assert.match(app, /ems-language/);
  assert.match(app, /refreshDeviceTypes/);
  assert.match(app, /\/api\/inventory\/export/);
  assert.match(app, /\/api\/personnel\/import/);
  assert.match(server, /\/api\/device-types/);
  assert.match(server, /\/api\/personnel\/export/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS device_types/);
});

test('radio module is simple IPAM-synchronized AP Station management', async () => {
  const [html, app] = await Promise.all([
    fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="radiosButton"/);
  assert.match(app, /جست‌وجوی نام، IP، MAC یا SSID/);
  assert.match(app, /radioParentHostId/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderRadios'), app.indexOf('async function openTopologyPage')), /signal|frequency|channel|monitor/i);
});

test('company contact summary keeps phone mobile and email separate', async () => {
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /<strong>تلفن:<\/strong>/);
  assert.match(app, /<strong>موبایل:<\/strong>/);
  assert.match(app, /<strong>ایمیل:<\/strong>/);
});
