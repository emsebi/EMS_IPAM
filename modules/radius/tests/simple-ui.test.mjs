import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ui=fs.readFileSync(path.join(root,'public/index.mjs'),'utf8');
const en=JSON.parse(fs.readFileSync(path.join(root,'public/i18n/en.json'),'utf8'));
const fa=JSON.parse(fs.readFileSync(path.join(root,'public/i18n/fa.json'),'utf8'));
test('simple RADIUS UI leads with clients, groups, users and logs',()=>{
 for(const marker of ["tab='clients'","radius.simple.clients","radius.simple.groups","radius.simple.users","radius.simple.logs"])assert.match(ui,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.doesNotMatch(ui,/MAB Policy Preview|Policy Regression Matrix|Run Safe Demo/);
});
test('client form uses direct IP/CIDR and a shared secret',()=>{
 assert.match(ui,/name=\"nasIp\"/);assert.match(ui,/name=\"secret\"/);assert.match(ui,/\/api\/radius-ops/);
 assert.match(en['radius.simple.sourceHint'],/CIDR|network/i);assert.ok(fa['radius.simple.sourceHint']);
});
test('group and user flow is explicit',()=>{
 assert.match(ui,/name=\"ciscoPrivilege\"/);assert.match(ui,/name=\"mikrotikGroup\"/);assert.match(ui,/name=\"groupId\"/);assert.match(ui,/name=\"password\"/);
});
test('English catalog is complete in Persian catalog',()=>{
 for(const key of Object.keys(en))assert.equal(typeof fa[key],'string',key);
});
