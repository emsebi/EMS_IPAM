import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {vendorForMac,renderRadioTopology} from '../../modules/radio/public/topology.mjs';
import {createModule} from '../../modules/radio/backend/index.mjs';

const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('offline OUI lookup, unknown and locally administered MAC, manual Inventory vendor override',()=>{
  assert.deepEqual(vendorForMac('4C:5E:0C:00:00:01'),{name:'MikroTik',source:'oui'});
  assert.deepEqual(vendorForMac('24:A4:3C:10:20:30'),{name:'Ubiquiti',source:'oui'});
  assert.deepEqual(vendorForMac('EC-08-6B-10-20-30'),{name:'TP-Link',source:'oui'});
  assert.deepEqual(vendorForMac('02:00:00:00:00:01'),{name:'',source:'locally-administered'});
  assert.equal(vendorForMac('not a mac').name,'');
  assert.equal(vendorForMac('02:00:00:00:00:01','Custom Vendor').name,'Custom Vendor');
});
test('documentation map uses AP, inventory uplink, station and location without fabricated signal/online',()=>{
  const ap={id:'ap',companyId:'acme',name:'Roof Radio',ip:'192.0.2.10',location:'Roof',ssid:'Lab'},
    station={id:'st',name:'Station One',ip:'192.0.2.20',mac:'24:A4:3C:00:00:01',location:'Gate',radioMode:'station'},
    dest={id:'sw',companyId:'acme',name:'Core Switch',ip:'192.0.2.1',type:'Switch'};
  const html=renderRadioTopology({ap,stations:[station],inventory:[ap,station,dest],link:{destinationId:'sw',port:'Gi1/0/24'},canEdit:true,escapeHtml:esc,language:'en'});
  for(const value of ['Roof Radio','192.0.2.10','Core Switch','192.0.2.1','Gi1/0/24','Station One','192.0.2.20','Gate','Ubiquiti','radioDocDestination','radioDocSave']) assert.ok(html.includes(value),value);
  for(const value of ['CCQ','dBm','Signal','Online','Offline']) assert.equal(html.includes(value),false,value);
  assert.equal(html.includes('radioDocDestination'),true);
  assert.equal(renderRadioTopology({ap,stations:[station],inventory:[ap,dest],link:null,canEdit:false,escapeHtml:esc,language:'fa'}).includes('id="radioDocSave"'),false);
  const injected={...station,name:'<img src=x onerror=alert(1)>'};
  assert.equal(renderRadioTopology({ap,stations:[injected],inventory:[],escapeHtml:esc}).includes('<img'),false);
});
test('module-owned uplink JSON persists without polling; enforces admin, AP, company and scope',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'radio-doc-'));
 const hosts={
   ap:{id:'ap',spaceId:'space-a',companyId:'acme',radioMode:'ap'},
   sw:{id:'sw',spaceId:'space-a',companyId:'acme',radioMode:''},
   other:{id:'other',spaceId:'space-b',companyId:'elsewhere',radioMode:''},
   station:{id:'station',spaceId:'space-a',companyId:'acme',radioMode:'station'}
 };
 const calls={queries:0,pings:0,audits:0};
 const ctx={
   backupDir:tmp,
   pool:{query:async(sql,[id])=>{calls.queries++;return {rows:hosts[id]?[hosts[id]]:[]};}},
   json:(_res,_code,body)=>body,readBody:async(req)=>req.body,
   cleanText:(value,max)=>String(value??'').trim().slice(0,max),
   requireAdmin:(user)=>{if(user.role!=='admin')throw Object.assign(new Error('Forbidden'),{status:403});},
   requireModuleAccess:async()=>{},canAccessSpace:async(user,space)=>!user.denied?.includes(space),
   pingMany:async()=>{calls.pings++;return new Map();},storePingResults:async()=>{},
   audit:async()=>{calls.audits++;},broadcast:()=>{}
 };
 const api=createModule(ctx),admin={role:'admin'},viewer={role:'viewer'};
 const run=(method,apId,body,user=admin)=>api.handle({method,body},{},new URL('http://local/api/radio/uplink?apId='+encodeURIComponent(apId)),user);
 try {
   assert.equal((await run('GET','ap')).link,null);
   await assert.rejects(run('PUT','ap',{apId:'ap',destinationId:'sw'},viewer),{status:403});
   await assert.rejects(run('PUT','ap',{apId:'ap',destinationId:'other'}),{status:400});
   await assert.rejects(run('PUT','ap',{apId:'ap',destinationId:'station'}),{status:400});
   await assert.rejects(run('PUT','station',{apId:'station',destinationId:'sw'}),{status:404});
   await assert.rejects(run('PUT','ap',{apId:'ap',destinationId:'sw'}, {...admin,denied:['space-a']}),{status:404});
   const saved=await run('PUT','ap',{apId:'ap',destinationId:'sw',port:'ether1'});
   assert.equal(saved.link.port,'ether1');
   assert.equal((await run('GET','ap',undefined,viewer)).link.destinationId,'sw');
   const data=JSON.parse(await fs.readFile(path.join(tmp,'radio-documentation','uplinks.json'),'utf8'));
   assert.equal(data.items.length,1);assert.equal(data.items[0].apId,'ap');
   assert.equal(data.items[0].destinationId,'sw');
   assert.equal(JSON.stringify(data).includes('password'),false);
   await run('PUT','ap',{apId:'ap',destinationId:''});
   assert.equal((await run('GET','ap')).link,null);
   assert.equal(calls.pings,0);assert.equal(calls.audits,2);
 } finally { await fs.rm(tmp,{recursive:true,force:true}); }
});
