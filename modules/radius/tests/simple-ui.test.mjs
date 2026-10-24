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
test('client form uses direct IP/CIDR and a shared secret without vendor coupling',()=>{
 assert.match(ui,/name=\"nasIp\"/);assert.match(ui,/name=\"secret\"/);assert.match(ui,/\/api\/radius-ops/);
 const clientForm=ui.split('function clientForm()')[1].split('function groupForm()')[0];
 assert.doesNotMatch(clientForm,/name=\"vendor\"/);
 const configPanel=ui.split('function configPanel()')[1].split('function content()')[0];
 assert.match(configPanel,/name=\"vendor\"/);
 assert.match(ui,/vendor:d\.get\('vendor'\),radiusIp/);
 assert.match(en['radius.simple.sourceHint'],/CIDR|network/i);assert.ok(fa['radius.simple.sourceHint']);
});
test('group and user flow is explicit with Cisco help, MikroTik defaults and collection/profile rules',()=>{
 assert.match(ui,/name=\"ciscoPrivilege\"/);assert.match(ui,/class=\"r-help\"/);assert.match(ui,/name=\"mikrotikPreset\"/);assert.match(ui,/value=\"read\"/);assert.match(ui,/value=\"write\"/);assert.match(ui,/value=\"full\"/);assert.match(ui,/value=\"custom\"/);assert.match(ui,/name=\"mikrotikCustom\"/);assert.match(ui,/class=\"rRuleCheck\"/);assert.match(ui,/class=\"rRuleProfile\"/);assert.match(ui,/name=\"password\"/);
 assert.doesNotMatch(ui,/name=\"groupId\"/);
 assert.match(en['radius.simple.ciscoHelp2to14'],/Custom intermediate levels/);assert.match(fa['radius.simple.ciscoHelp2to14'],/2 تا 14/);
});
test('English catalog is complete in Persian catalog',()=>{
 for(const key of Object.keys(en))assert.equal(typeof fa[key],'string',key);
});
