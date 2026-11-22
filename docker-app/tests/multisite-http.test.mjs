// MS-01/MS-02/MS-11: production HTTP routes, no API mocks or network discovery.
// npm test uses PGlite; the PostgreSQL CI gate repeats this against an isolated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { assertFixtureRadioIsolation } from './helpers/fixture-radio-isolation.mjs';
import { assertFixtureCompanyIsolation } from './helpers/fixture-company-isolation.mjs';
import { exerciseXlsxImport } from './helpers/xlsx-import-scenario.mjs';
import { openFixtureJournal } from './helpers/fixture-journal.mjs';
import { withXlsxHttpFixture, recoverXlsxHttpFixture } from './helpers/xlsx-http-fixture.mjs';

test('multisite HTTP: identical CIDR/IP retains identity and enforces Company/Space scopes', {timeout:60000}, async t=>{
  const appDir=path.resolve(import.meta.dirname,'..');
  const backups=await fs.mkdtemp(path.join(os.tmpdir(),'ems-multisite-'));
  const dbName='ems_multisite_'+randomUUID().replaceAll('-','');
  let child,control,created=false;
  t.after(async()=>{
    if(child && child.exitCode===null && child.signalCode===null){
      const ended=once(child,'exit');child.kill('SIGTERM');await ended;
    }
    try{if(created)await control.query('DROP DATABASE '+dbName+' WITH (FORCE)');}
    finally{await control?.end();await fs.rm(backups,{recursive:true,force:true});}
  });
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const env={...process.env,PORT:String(port),EMS_TEST_PORT:String(port),
    EMS_ADMIN_USERNAME:'test-admin',EMS_ADMIN_PASSWORD:'Test-Password-01',BACKUP_DIR:backups,
    EMS_MODULES_DIR:path.resolve(appDir,'../modules')};
  const postgres=process.env.EMS_TEST_POSTGRES_URL;
  if(postgres){
    control=new pg.Pool({connectionString:postgres});
    await control.query('CREATE DATABASE '+dbName);created=true;
    const url=new URL(postgres);url.pathname='/'+dbName;env.DATABASE_URL=url.href;
  }else delete env.DATABASE_URL;
  const marker=postgres?' listening on ': 'TEST_FIXTURES_READY';
  child=spawn(process.execPath,[postgres?'server/main.mjs':'tests/helpers/embedded-server.mjs'],{cwd:appDir,env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(new Error('Server startup timed out: '+log)),30000);
    const read=chunk=>{log+=chunk;if(log.includes(marker)){clearTimeout(timer);resolve();}};
    child.stdout.on('data',read);child.stderr.on('data',read);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+log));});
  });
  const base='http://127.0.0.1:'+port;
  async function client(username,password='Test-Password-01'){
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password}),signal:AbortSignal.timeout(5000)});
    assert.equal(login.status,200,'login '+username);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    return async(method,url,body,expected=200)=>{
      const res=await fetch(base+url,{method,headers:{Cookie:cookie,'X-EMS-CSRF':'1','Content-Type':'application/json'},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
      const text=await res.text();assert.ok([].concat(expected).includes(res.status),`${username} ${method} ${url}: ${res.status} ${text}`);
      return res.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text;
    };
  }
  const admin=await client('test-admin');
  const parent=(await admin('POST','/api/companies',{name:'Synthetic multisite parent'},201)).id;
  const sites=[];
  for(const [label,mac] of [['North','02:00:00:00:01:01'],['South','02:00:00:00:02:02']]){
    const companyId=(await admin('POST','/api/companies',{name:'Synthetic '+label,kind:'branch',parentCompanyId:parent},201)).id;
    const spaceId=(await admin('POST','/api/spaces',{companyId,name:'Shared LAN',cidr:'192.0.2.0/24'},201)).id;
    const host={spaceId,ip:'192.0.2.50',name:label+' fixture',mac};
    const id=(await admin('PUT','/api/hosts',host,200)).id;sites.push({companyId,spaceId,id,host});
  }
  const [north,south]=sites;
  await t.test('same-branch CIDR conflict on create and edit preserves both Spaces and their hosts', async () => {
    const duplicate = { companyId: north.companyId, name: 'Separate VRF', cidr: '192.0.2.0/24' };
    const rejected = await admin('POST', '/api/spaces', duplicate, 409);
    assert.equal(rejected.code, 'SPACE_CIDR_CONFLICT');
    assert.match(rejected.error, /VRF/);

    const original = { companyId: north.companyId, name: 'Independent space', cidr: '198.51.100.0/24' };
    const { id } = await admin('POST', '/api/spaces', original, 201);
    const edited = await admin('PUT', '/api/spaces/' + id, duplicate, 409);
    assert.equal(edited.code, rejected.code);
    const spaces = (await admin('GET', '/api/bootstrap')).spaces.filter(s => s.companyId === north.companyId);
    assert.deepEqual(spaces.map(s => [s.id, s.name, s.cidr]).sort(), [
      [north.spaceId, 'Shared LAN', duplicate.cidr], [id, original.name, original.cidr],
    ].sort());
    for (const site of sites) {
      const data = await admin('GET', '/api/spaces/' + site.spaceId + '/data');
      assert.deepEqual(data.hosts.map(h => h.id), [site.id]);
    }
    await admin('DELETE', '/api/spaces/' + id);
  });
  await t.test('unregistered exact IP produces a candidate per Space, including beside a registered branch',async()=>{
    const candidates=(await admin('GET','/api/search?q=192.0.2.51')).items.filter(h=>h.kind==='free-ip' && sites.some(s=>s.spaceId===h.spaceId));
    assert.deepEqual(candidates.map(h=>h.spaceId).sort(),sites.map(s=>s.spaceId).sort());
    for(const site of sites){
      const hit=candidates.find(h=>h.spaceId===site.spaceId);
      assert.equal(hit.companyId,site.companyId);
      assert.equal(hit.companyName,site===north?'Synthetic North':'Synthetic South');
      assert.equal(hit.source,'ipam-inventory');assert.equal(hit.availability,'unverified');
      assert.equal(hit.recordUpdatedAt,null);assert.equal(hit.observedAt,null);
    }
    await admin('PUT','/api/hosts',{spaceId:north.spaceId,ip:'192.0.2.51',name:'North only'});
    const mixed=(await admin('GET','/api/search?q=192.0.2.51')).items.filter(h=>sites.some(s=>s.spaceId===h.spaceId));
    assert.deepEqual(mixed.filter(h=>h.kind==='host').map(h=>h.spaceId),[north.spaceId]);
    assert.deepEqual(mixed.filter(h=>h.kind==='free-ip').map(h=>h.spaceId),[south.spaceId]);
    await admin('DELETE','/api/hosts/'+north.spaceId+'/192.0.2.51');
    assert.equal((await admin('GET','/api/search?q=203.0.113.51')).items.filter(h=>h.kind==='free-ip').length,0);
  });
  for(const site of sites){
    site.prefixId=(await admin('POST','/api/prefixes',{spaceId:site.spaceId,cidr:'192.0.2.0/25',name:'Shared prefix'})).id;
  }
  await t.test('identical prefixes retain branch, Space and non-live evidence metadata',async()=>{
    const hits=(await admin('GET','/api/search?q=Shared%20prefix')).items.filter(h=>h.kind==='prefix');
    assert.deepEqual(hits.map(h=>h.id).sort(),sites.map(s=>s.prefixId).sort());
    for(const site of sites){
      const hit=hits.find(h=>h.id===site.prefixId);
      assert.equal(hit.companyId,site.companyId);
      assert.equal(hit.companyName,site===north?'Synthetic North':'Synthetic South');
      assert.equal(hit.spaceId,site.spaceId);assert.equal(hit.spaceName,'Shared LAN');
      assert.equal(hit.cidr,'192.0.2.0/25');assert.equal(hit.spaceCidr,'192.0.2.0/24');
      assert.equal(hit.source,'ipam-inventory');
      assert.ok(Number.isFinite(Date.parse(hit.recordUpdatedAt)));
      assert.equal(hit.observedAt,null);
    }
  });
  await t.test('same CIDR/IP in separate branches never overwrites the other host',async()=>{
    assert.notEqual(north.id,south.id);assert.notEqual(north.spaceId,south.spaceId);
    for(const site of sites){
      const detail=await admin('GET','/api/companies/'+site.companyId);
      assert.equal(detail.company.parentCompanyId,parent);
    }
    await admin('PUT','/api/hosts',{...north.host,id:north.id,name:'North edited'},200);
    const inventory=(await admin('GET','/api/inventory')).items.filter(h=>h.ip==='192.0.2.50');
    assert.equal(inventory.length,2);
    for(const site of sites){
      const found=inventory.find(h=>h.id===site.id);
      assert.equal(found.companyId,site.companyId);assert.equal(found.spaceId,site.spaceId);
      assert.equal(found.mac,site.host.mac);
    }
    assert.equal(inventory.find(h=>h.id===south.id).name,'South fixture');
    const hits=(await admin('GET','/api/search?q=192.0.2.50')).items.filter(h=>h.kind==='host');
    assert.deepEqual(hits.map(h=>h.id).sort(),sites.map(s=>s.id).sort());
    assert.deepEqual(hits.map(h=>h.spaceId).sort(),sites.map(s=>s.spaceId).sort());
    for(const site of sites){
      const hit=hits.find(h=>h.id===site.id);
      assert.equal(hit.companyId,site.companyId);
      assert.equal(hit.companyName,site===north?'Synthetic North':'Synthetic South');
      assert.equal(hit.spaceName,'Shared LAN');
      assert.equal(hit.source,'ipam-inventory');
      assert.ok(Number.isFinite(Date.parse(hit.recordUpdatedAt)));
      assert.equal(hit.observedAt,null,'inventory edit time is not a live observation');
    }
  });
  for(const [username,site,other,scope,role] of [
    ['north-reader',north,south,{companyIds:[north.companyId]},'viewer'],
    ['south-space-reader',south,north,{spaceIds:[south.spaceId]},'viewer'],
    ['north-editor',north,south,{companyIds:[north.companyId]},'branch']
  ]){
    await admin('POST','/api/users',{username,password:'Test-Password-01',role,...scope,moduleIds:['ipam','inventory']},201);
    const call=await client(username);
    await t.test(username+' sees only its authorized branch/space in reads and exports',async()=>{
      const boot=await call('GET','/api/bootstrap');
      assert.deepEqual(boot.spaces.map(s=>s.id),[site.spaceId]);
      assert.ok(boot.companies.every(company => !Object.hasOwn(company, 'routingDomains')));
      const inventory=(await call('GET','/api/inventory')).items;
      assert.deepEqual(inventory.map(h=>h.id),[site.id]);
      const hits=(await call('GET','/api/search?q=192.0.2.50')).items.filter(h=>h.kind==='host');
      assert.deepEqual(hits.map(h=>h.id),[site.id]);assert.equal(hits[0].spaceId,site.spaceId);
      assert.equal(hits[0].companyId,site.companyId);
      assert.ok(!JSON.stringify(hits).includes(other.companyId));
      const unregistered=(await call('GET','/api/search?q=192.0.2.51')).items.filter(h=>h.kind==='free-ip');
      assert.deepEqual(unregistered.map(h=>h.spaceId),[site.spaceId]);
      assert.equal(unregistered[0].companyId,site.companyId);
      assert.ok(!JSON.stringify(unregistered).includes(other.companyId));
      const prefixes=(await call('GET','/api/search?q=Shared%20prefix')).items.filter(h=>h.kind==='prefix');
      assert.deepEqual(prefixes.map(p=>p.id),[site.prefixId]);
      assert.equal(prefixes[0].companyId,site.companyId);
      assert.equal(prefixes[0].spaceId,site.spaceId);
      assert.ok(!JSON.stringify(prefixes).includes(other.companyId));
      assert.ok(!JSON.stringify(prefixes).includes(other.prefixId));
      const data=await call('GET','/api/spaces/'+site.spaceId+'/data');
      assert.equal(data.hosts[0].id,site.id);
      const csv=await call('GET','/api/inventory/export');
      assert.ok(csv.includes(site.host.mac));assert.ok(!csv.includes(other.host.mac));
      for(const url of ['/api/companies/'+other.companyId,'/api/spaces/'+other.spaceId+'/data','/api/spaces/'+other.spaceId+'/export']){
        const denied=await call('GET',url,undefined,[403,404]);
        assert.ok(!JSON.stringify(denied).includes(other.host.mac));
        assert.ok(!JSON.stringify(denied).includes(other.host.name));
      }
      await call('GET','/api/personnel',undefined,403);
      await call('PUT','/api/hosts',{...site.host,id:other.id,name:'Forbidden move'},[403,404]);
      await call('PUT','/api/hosts',{...other.host,id:other.id,name:'Forbidden edit'},[403,404]);
      await call('DELETE','/api/hosts/'+other.spaceId+'/'+other.host.ip,undefined,[403,404]);
    });
  }
  await t.test('ordinary Space edits reject a different branch without changing either branch or its grants', async () => {
    const northReader = await client('north-reader');
    const southReader = await client('south-space-reader');
    const northUrl = '/api/spaces/' + north.spaceId;
    const southUrl = '/api/spaces/' + south.spaceId;
    const beforeNorth = await northReader('GET', northUrl + '/data');
    const beforeSouth = await southReader('GET', southUrl + '/data');
    const edit = { name: 'Wrong-branch edit', cidr: beforeNorth.space.cidr, description: 'Must not be saved' };

    const conflict = await admin('PUT', northUrl, { ...edit, companyId: south.companyId }, 409);
    assert.equal(conflict.code, 'SPACE_OWNER_MISMATCH');
    assert.deepEqual(await northReader('GET', northUrl + '/data'), beforeNorth);
    assert.deepEqual(await southReader('GET', southUrl + '/data'), beforeSouth);
    await southReader('GET', northUrl + '/data', undefined, 404);
    await northReader('GET', southUrl + '/data', undefined, 404);
    await southReader('PUT', northUrl, { ...edit, companyId: south.companyId }, 403);

    // Current and legacy clients may respectively send or omit the existing owner.
    const { name, cidr, color, description } = beforeNorth.space;
    const metadata = { name, cidr, color, description };
    await admin('PUT', northUrl, { ...metadata, companyId: north.companyId, name: 'Same-owner edit' });
    assert.equal((await northReader('GET', northUrl + '/data')).space.name, 'Same-owner edit');
    await admin('PUT', northUrl, metadata);
    assert.equal((await northReader('GET', northUrl + '/data')).space.name, name);
  });
  const final=(await admin('GET','/api/inventory')).items.filter(h=>h.ip==='192.0.2.50');
  assert.deepEqual(final.map(h=>[h.id,h.name]).sort(),[[north.id,'North edited'],[south.id,'South fixture']].sort());
  await t.test('prefix pages exceed old caps with stable branch identity and fresh authorization',async()=>{
    const expected=[];
    for(const site of sites) for(let n=128;n<256;n+=4){
      const cidr='192.0.2.'+n+'/30';
      const id=(await admin('POST','/api/prefixes',{spaceId:site.spaceId,cidr,name:'Prefix window fixture'})).id;
      expected.push({id,spaceId:site.spaceId,companyId:site.companyId,cidr});
    }
    for(const [call,allowed] of [[admin,expected],[await client('north-reader'),expected.filter(p=>p.spaceId===north.spaceId)],[await client('south-space-reader'),expected.filter(p=>p.spaceId===south.spaceId)]]){
      let offset=0,found=[];
      for(let page=0;page<10;page++){
        const result=await call('GET','/api/search?kind=prefix&q=Prefix%20window%20fixture&limit=13&offset='+offset);
        assert.ok(result.items.length<=13);
        assert.deepEqual(result.pagination,{kind:'prefix',limit:13,offset,hasMore:offset+13<allowed.length,nextOffset:offset+13<allowed.length?offset+13:null});
        for(const item of result.items){
          const match=allowed.find(p=>p.id===item.id);
          assert.ok(match,'result must belong to the current authorized scope');
          assert.equal(item.kind,'prefix');assert.equal(item.spaceId,match.spaceId);
          assert.equal(item.companyId,match.companyId);assert.equal(item.cidr,match.cidr);
          assert.equal(item.companyName,item.spaceId===north.spaceId?'Synthetic North':'Synthetic South');
          assert.equal(item.spaceName,'Shared LAN');assert.equal(item.spaceCidr,'192.0.2.0/24');
          assert.equal(item.source,'ipam-inventory');assert.equal(item.observedAt,null);
          assert.ok(Number.isFinite(Date.parse(item.recordUpdatedAt)));
        }
        found.push(...result.items);
        if(!result.pagination.hasMore)break;
        offset=result.pagination.nextOffset;
      }
      assert.equal(new Set(found.map(p=>p.id)).size,found.length);
      assert.deepEqual(found.map(p=>p.id).sort(),allowed.map(p=>p.id).sort());
      const ordered=[...allowed].sort((a,b)=>a.cidr<b.cidr?-1:a.cidr>b.cidr?1:a.id<b.id?-1:a.id>b.id?1:0);
      assert.deepEqual(found.map(p=>p.id),ordered.map(p=>p.id),'CIDR/ID ordering must hold across every page');
      const first=await call('GET','/api/search?kind=prefix&q=Prefix%20window%20fixture&limit=13');
      assert.deepEqual(first.items.map(p=>p.id),found.slice(0,13).map(p=>p.id));
      const end=await call('GET','/api/search?kind=prefix&q=Prefix%20window%20fixture&offset=999');
      assert.deepEqual(end.items,[]);assert.equal(end.pagination.hasMore,false);assert.equal(end.pagination.nextOffset,null);
    }
    for(const invalid of ['limit=0','limit=101','limit=-1','limit=1.5','limit=','offset=-1','offset=abc','offset=2147483648'])
      await admin('GET','/api/search?kind=prefix&q=Prefix&'+invalid,undefined,400);
    const empty=await admin('GET','/api/search?kind=prefix&q=');
    assert.deepEqual(empty.items,[]);assert.equal(empty.pagination.nextOffset,null);
    const defaults=await admin('GET','/api/search?kind=prefix&q=Prefix%20window%20fixture');
    assert.equal(defaults.items.length,40);assert.equal(defaults.pagination.nextOffset,40);
    const legacy=await admin('GET','/api/search?q=Prefix%20window%20fixture');
    assert.equal(legacy.items.length,20);assert.equal(legacy.pagination,undefined);
    // A saved next offset does not retain access after the grant is removed.
    const userId=(await admin('POST','/api/users',{username:'paged-reader',password:'Test-Password-01',role:'viewer',companyIds:[north.companyId],moduleIds:['ipam']},201)).id;
    const reader=await client('paged-reader');
    const before=await reader('GET','/api/search?kind=prefix&q=Prefix%20window%20fixture&limit=13');
    assert.equal(before.pagination.nextOffset,13);
    await admin('PUT','/api/users/'+userId,{role:'viewer',companyIds:[],spaceIds:[],moduleIds:['ipam']});
    const denied=await reader('GET','/api/search?kind=prefix&q=Prefix%20window%20fixture&limit=13&offset='+before.pagination.nextOffset);
    assert.deepEqual(denied.items,[]);assert.equal(denied.pagination.hasMore,false);assert.equal(denied.pagination.nextOffset,null);
  });
  await t.test('host pages exceed old caps without duplicates or cross-branch leakage',async()=>{
    const expected=[];
    for(const site of sites) for(let n=100;n<145;n++){
      const id=(await admin('PUT','/api/hosts',{spaceId:site.spaceId,ip:'192.0.2.'+n,name:'Paging fixture'})).id;
      expected.push({id,spaceId:site.spaceId});
    }
    for(const [call,allowed] of [[admin,expected],[await client('north-reader'),expected.filter(h=>h.spaceId===north.spaceId)],[await client('south-space-reader'),expected.filter(h=>h.spaceId===south.spaceId)]]){
      let offset=0,found=[];
      for(let page=0;page<10;page++){
        const result=await call('GET','/api/search?kind=host&q=Paging%20fixture&limit=17&offset='+offset);
        assert.ok(result.items.length<=17);assert.equal(result.pagination.offset,offset);
        for(const item of result.items){
          assert.equal(item.kind,'host');assert.equal(item.source,'ipam-inventory');
          assert.ok(item.companyId && item.companyName && item.spaceId);
          assert.ok(Number.isFinite(Date.parse(item.recordUpdatedAt)));assert.equal(item.observedAt,null);
        }
        found.push(...result.items);
        if(!result.pagination.hasMore){assert.equal(result.pagination.nextOffset,null);break;}
        assert.equal(result.pagination.nextOffset,offset+17);offset=result.pagination.nextOffset;
      }
      assert.equal(new Set(found.map(h=>h.id)).size,found.length);
      assert.deepEqual(found.map(h=>h.id).sort(),allowed.map(h=>h.id).sort());
      const first=await call('GET','/api/search?kind=host&q=Paging%20fixture&limit=17');
      assert.deepEqual(first.items.map(h=>h.id),found.slice(0,17).map(h=>h.id),'stable order for unchanged data');
      const end=await call('GET','/api/search?kind=host&q=Paging%20fixture&offset=999');
      assert.deepEqual(end.items,[]);assert.equal(end.pagination.hasMore,false);
    }
    for(const invalid of ['limit=0','limit=101','limit=-1','limit=1.5','offset=-1','offset=abc','offset=2147483648']){
      await admin('GET','/api/search?kind=host&q=Paging&'+invalid,undefined,400);
    }
    const empty=await admin('GET','/api/search?kind=host&q=');
    assert.deepEqual(empty.items,[]);assert.equal(empty.pagination.nextOffset,null);
    // Existing callers retain the legacy response; UI pagination is a separate step.
    const legacy=await admin('GET','/api/search?q=Paging%20fixture');
    assert.equal(legacy.items.length,30);assert.equal(legacy.pagination,undefined);
  });
  await t.test('unregistered IP pages retain ordered authorized Spaces and recheck grants', async () => {
    const ip = '203.0.113.77';
    const url = '/api/search?kind=free-ip&q=' + ip;
    const spaces = [];
    for (let i = 0; i < 43; i++) {
      const companyName = 'Synthetic paging branch ' + i;
      const { id: companyId } = await admin('POST', '/api/companies', { name: companyName, kind: 'branch', parentCompanyId: parent }, 201);
      const cidr = i % 2 ? '203.0.112.0/23' : '203.0.113.0/24';
      const { id: spaceId } = await admin('POST', '/api/spaces', { companyId, name: 'Shared LAN', cidr }, 201);
      spaces.push({ companyId, companyName, spaceId, cidr });
    }
    const ordered = spaces.sort((a, b) => Number(b.cidr.split('/')[1]) - Number(a.cidr.split('/')[1]) || a.spaceId.localeCompare(b.spaceId));
    const [registered, ...candidates] = ordered;
    await admin('PUT', '/api/hosts', { spaceId: registered.spaceId, ip, name: 'Registered only here' });
    // A soft-deleted host is no longer registered.
    await admin('PUT', '/api/hosts', { spaceId: candidates[0].spaceId, ip, name: 'Retired fixture' });
    await admin('DELETE', '/api/hosts/' + candidates[0].spaceId + '/' + ip);

    const listed = (await admin('GET', '/api/bootstrap')).spaces;
    const domainBySpace = new Map(listed.map(space => [space.id, space.routingDomainId]));
    const first = await admin('GET', url);
    assert.deepEqual(first.pagination, { kind: 'free-ip', limit: 40, offset: 0, hasMore: true, nextOffset: 40 });
    const last = await admin('GET', url + '&offset=' + first.pagination.nextOffset);
    assert.deepEqual(last.pagination, { kind: 'free-ip', limit: 40, offset: 40, hasMore: false, nextOffset: null });
    const all = [...first.items, ...last.items];
    assert.deepEqual(all.map(h => h.spaceId), candidates.map(s => s.spaceId));
    for (const [index, hit] of all.entries()) {
      const space = candidates[index];
      assert.deepEqual(hit, { kind: 'free-ip', ip, companyId: space.companyId, companyName: space.companyName,
        spaceId: space.spaceId, spaceCidr: space.cidr, spaceName: 'Shared LAN', source: 'ipam-inventory',
        routingDomainId: domainBySpace.get(space.spaceId), routingDomainName: 'Default',
        availability: 'unverified', observedAt: null, recordUpdatedAt: null });
    }
    const mixed = await admin('GET', '/api/search?q=203.000.113.077');
    assert.equal(mixed.pagination, undefined);
    assert.equal(mixed.items.length, 40);
    assert.deepEqual(mixed.items.filter(h => h.kind === 'host').map(h => h.spaceId), [registered.spaceId]);
    assert.deepEqual(mixed.items.filter(h => h.kind === 'free-ip'), all.slice(0,39));
    assert.equal(mixed.nextFreeIpOffset, 39);
    const rest = await admin('GET', url + '&offset=' + mixed.nextFreeIpOffset);
    assert.deepEqual(rest.items, all.slice(39));
    // Other kinds may fill the entire mixed page. The first candidate still has offset zero.
    for (let i = 0; i < 25; i++) {
      await admin('PUT', '/api/hosts', { spaceId: registered.spaceId, ip: '203.0.113.' + (100 + i), name: 'Reference to ' + ip });
      await admin('POST', '/api/prefixes', { spaceId: registered.spaceId, cidr: '203.0.113.' + i + '/32', name: 'Reference to ' + ip });
    }
    const full = await admin('GET', '/api/search?q=' + ip);
    assert.equal(full.items.length, 40);
    assert.equal(full.items.some(item => item.kind === 'free-ip'), false);
    assert.equal(full.nextFreeIpOffset, 0);
    for (const query of ['', '203.0.113', '203.0.113.999']) {
      const empty = await admin('GET', '/api/search?kind=free-ip&q=' + query);
      assert.deepEqual(empty.items, []);
      assert.equal(empty.pagination.nextOffset, null);
    }
    await admin('GET', url + '&limit=0', undefined, 400);
    const grants = { companyIds: [candidates[0].companyId], spaceIds: [candidates[1].spaceId] };
    const { id: readerId } = await admin('POST', '/api/users', { username: 'candidate-reader', password: 'Test-Password-01',
      role: 'viewer', moduleIds: ['ipam'], ...grants }, 201);
    const reader = await client('candidate-reader');
    const page = await reader('GET', url + '&limit=1');
    assert.deepEqual(page.items, [all[0]]);
    assert.equal(page.pagination.nextOffset, 1);
    const continuation = url + '&limit=1&offset=' + page.pagination.nextOffset;
    const allowed = await reader('GET', continuation);
    assert.deepEqual(allowed.items, [all[1]]);
    assert.equal(allowed.pagination.hasMore, false);
    await admin('PUT', '/api/users/' + readerId, { role: 'viewer', companyIds: [], spaceIds: [], moduleIds: ['ipam'] });
    const revoked = await reader('GET', continuation);
    assert.deepEqual(revoked.items, []);
    assert.equal(revoked.pagination.nextOffset, null);
  });

  await t.test('MS-03 Space reads distinguish routing domains and count only granted Spaces', async () => {
    const readers = [await client('north-reader'), await client('south-space-reader')];
    const boot = await admin('GET', '/api/bootstrap');
    const domains = sites.map(site => boot.spaces.find(s => s.id === site.spaceId).routingDomainId);
    for (const [index, site] of sites.entries()) {
      const company = boot.companies.find(c => c.id === site.companyId);
      assert.deepEqual(company.routingDomains, [{ id: domains[index], name: 'Default', isDefault: true }]);
    }
    for (const id of domains) assert.match(id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
    assert.notEqual(domains[0], domains[1]);

    const sibling = await admin('POST', '/api/spaces', {
      companyId: south.companyId, name: 'Other South LAN', cidr: '203.0.113.0/24',
    }, 201);
    try {
      await admin('PUT', '/api/hosts', { spaceId: sibling.id, ip: '203.0.113.1', name: 'Sibling radio', radioMode: 'ap' });
      await admin('POST', '/api/prefixes', { spaceId: sibling.id, name: 'Sibling prefix', cidr: '203.0.113.0/25' });
      for (const [index, site] of sites.entries()) {
        const reader = readers[index];
        const listed = (await reader('GET', '/api/bootstrap')).spaces;
        const company = await reader('GET', '/api/companies/' + site.companyId);
        const { space } = await reader('GET', '/api/spaces/' + site.spaceId + '/data');
        assert.deepEqual(listed.map(s => s.id), [site.spaceId]);
        assert.deepEqual(company.spaces.map(s => s.id), [site.spaceId]);
        for (const row of [listed[0], company.spaces[0], space]) {
          assert.deepEqual([row.companyId, row.cidr, row.routingDomainId, row.routingDomainName],
            [site.companyId, '192.0.2.0/24', domains[index], 'Default']);
        }
        const denied = await reader('GET', '/api/spaces/' + sites[1 - index].spaceId + '/data', undefined, 404);
        assert.ok(!JSON.stringify(denied).includes(domains[1 - index]));
      }
      const full = await admin('GET', '/api/companies/' + south.companyId);
      const limited = await readers[1]('GET', '/api/companies/' + south.companyId);
      assert.ok(full.spaces.some(s => s.id === sibling.id));
      for (const key of ['hosts', 'prefixes', 'radios']) assert.equal(full.stats[key], limited.stats[key] + 1, key);
      await readers[1]('GET', '/api/spaces/' + sibling.id + '/data', undefined, 404);
    } finally {
      await admin('DELETE', '/api/spaces/' + sibling.id);
    }
  });

  await t.test('MS-03 search preserves each authorized routing domain for hosts, prefixes and unregistered IPs', async () => {
    const readers = [await client('north-reader'), await client('south-space-reader')];
    const spaces = (await admin('GET', '/api/bootstrap')).spaces;
    const recorded = sites.map(site => spaces.find(space => space.id === site.spaceId));
    assert.ok(recorded.every(space => space.routingDomainId && space.routingDomainName));
    assert.notEqual(recorded[0].routingDomainId, recorded[1].routingDomainId);

    for (const [kind, query] of [['host', '192.0.2.50'], ['prefix', 'Shared prefix'], ['free-ip', '192.0.2.51']]) {
      const url = '/api/search?q=' + encodeURIComponent(query);
      const mixed = (await admin('GET', url)).items.filter(hit => hit.kind === kind);
      for (const [index, space] of recorded.entries()) {
        const page = await readers[index]('GET', url + '&kind=' + kind + '&limit=1');
        assert.equal(page.pagination.hasMore, false);
        const matches = mixed.filter(hit => hit.spaceId === space.id);
        assert.equal(matches.length, 1);
        assert.deepEqual(page.items, matches);
        const hit = matches[0];
        assert.deepEqual([hit.companyId, hit.spaceCidr, hit.routingDomainId, hit.routingDomainName],
          [space.companyId, space.cidr, space.routingDomainId, space.routingDomainName]);
      }
    }
  });

  await t.test('MS-03 startup migration assigns branch defaults to legacy HTTP writes and preserves read scopes', {
    skip: !postgres && 'requires a separate SQL connection to the running fixture database',
  }, async t => {
    const db = new pg.Client({ connectionString: env.DATABASE_URL });
    await db.connect();
    t.after(() => db.end());
    const northReader = await client('north-reader');
    const southReader = await client('south-space-reader');

    const binding = async id => {
      const result = await db.query('SELECT routing_domain_id FROM address_spaces WHERE id=$1', [id]);
      assert.equal(result.rowCount, 1);
      return result.rows[0].routing_domain_id;
    };
    const defaults = await db.query('SELECT id FROM routing_domains WHERE company_id=$1 AND is_default', [north.companyId]);
    assert.equal(defaults.rowCount, 1);
    const northDomain = defaults.rows[0].id;
    assert.equal(await binding(north.spaceId), northDomain);
    await db.query('UPDATE routing_domains SET name=$1 WHERE id=$2', ['North recorded VRF', northDomain]);
    const edited = { name: 'Renamed North LAN', cidr: '192.0.2.0/24' };
    await admin('PUT', '/api/spaces/' + north.spaceId, edited);
    const data = await northReader('GET', '/api/spaces/' + north.spaceId + '/data');
    assert.equal(data.space.name, edited.name);
    assert.deepEqual([data.space.routingDomainId, data.space.routingDomainName], [northDomain, 'North recorded VRF']);
    assert.ok(data.hosts.some(h => h.id === north.id));
    assert.ok(data.prefixes.some(p => p.id === north.prefixId));
    assert.equal(await binding(north.spaceId), northDomain);

    const fresh = { companyId: north.companyId, name: 'Compatibility LAN', cidr: '198.18.0.0/24' };
    const { id } = await admin('POST', '/api/spaces', fresh, 201);
    assert.equal(await binding(id), northDomain);
    const conflict = await admin('POST', '/api/spaces', fresh, 409);
    assert.equal(conflict.code, 'SPACE_CIDR_CONFLICT');

    const created = await northReader('GET', '/api/spaces/' + id + '/data');
    assert.deepEqual([created.space.id, created.space.companyId, created.space.cidr], [id, north.companyId, fresh.cidr]);
    const southData = await southReader('GET', '/api/spaces/' + south.spaceId + '/data');
    assert.ok(southData.hosts.some(h => h.id === south.id));
    await southReader('GET', '/api/spaces/' + id + '/data', undefined, 404);
    const visible = await southReader('GET', '/api/bootstrap');
    assert.deepEqual(visible.spaces.map(s => s.id), [south.spaceId]);

    for (const [kind, query] of [['host', '192.0.2.50'], ['prefix', 'Shared prefix'], ['free-ip', '192.0.2.51']]) {
      const { items } = await northReader('GET', '/api/search?kind=' + kind + '&q=' + encodeURIComponent(query));
      assert.deepEqual(items.map(hit => [hit.routingDomainId, hit.routingDomainName]), [[northDomain, 'North recorded VRF']]);
    }
    const unbind = 'UPDATE address_spaces SET routing_domain_id=NULL WHERE id=$1';
    await assert.rejects(db.query(unbind, [id]), { code: '23502', column: 'routing_domain_id' });
    // Recreate the nullable 002 schema briefly to retain coverage of reads during downgrade.
    await db.query('ALTER TABLE address_spaces ALTER COLUMN routing_domain_id DROP NOT NULL');
    try {
      await db.query(unbind, [id]);
      const unbound = await northReader('GET', '/api/search?q=198.18.0.1');
      assert.deepEqual(unbound.items.map(hit => [hit.spaceId, hit.routingDomainId, hit.routingDomainName]), [[id, null, null]]);
    } finally {
      await db.query('UPDATE address_spaces SET routing_domain_id=$1 WHERE id=$2', [northDomain, id]);
      await db.query('ALTER TABLE address_spaces ALTER COLUMN routing_domain_id SET NOT NULL');
    }
  });

  await t.test('MS-03 explicit Space writes enforce domain ownership and preserve legacy edits', {
    skip: !postgres && 'seeds a non-default domain in the isolated PostgreSQL database',
  }, async t => {
    const db = new pg.Client({ connectionString: env.DATABASE_URL });
    await db.connect();
    t.after(() => db.end());
    const { rows: [alternate] } = await db.query(
      'INSERT INTO routing_domains(company_id,name) VALUES($1,$2) RETURNING id', [north.companyId, 'North voice'],
    );
    const branchUser = await client('north-editor');
    const northDefault = (await branchUser('GET', '/api/spaces/' + north.spaceId + '/data')).space.routingDomainId;
    const southDefault = (await admin('GET', '/api/spaces/' + south.spaceId + '/data')).space.routingDomainId;
    const draft = { companyId: north.companyId, name: 'Voice LAN', cidr: '198.19.0.0/24' };
    const invalidDomains = [southDefault, randomUUID()];
    for (const id of invalidDomains) {
      const rejected = await admin('POST', '/api/spaces', { ...draft, routingDomainId: id }, 409);
      assert.equal(rejected.code, 'SPACE_DOMAIN_MISMATCH');
    }
    await admin('POST', '/api/spaces', { ...draft, routingDomainId: 'invalid' }, 400);
    const { id } = await admin('POST', '/api/spaces', { ...draft, routingDomainId: alternate.id }, 201);
    const url = '/api/spaces/' + id;
    const read = async () => (await branchUser('GET', url + '/data')).space;
    assert.equal((await read()).routingDomainId, alternate.id);
    await admin('PUT', url, { ...draft, name: 'Ordinary edit' });
    const before = await read();
    assert.deepEqual([before.name, before.routingDomainId], ['Ordinary edit', alternate.id]);
    for (const foreign of invalidDomains) {
      const rejected = await admin('PUT', url, { ...draft, routingDomainId: foreign }, 409);
      assert.equal(rejected.code, 'SPACE_DOMAIN_MISMATCH');
      assert.deepEqual(await read(), before);
    }
    const duplicate = await admin('POST', '/api/spaces', { ...draft, routingDomainId: northDefault }, 409);
    assert.equal(duplicate.code, 'SPACE_CIDR_CONFLICT');
    const editConflict = await admin('PUT', url, { ...draft, cidr: '192.0.2.0/24', routingDomainId: northDefault }, 409);
    assert.equal(editConflict.code, 'SPACE_CIDR_CONFLICT');
    await branchUser('PUT', url, { ...draft, routingDomainId: northDefault }, 403);
    assert.deepEqual(await read(), before);
    await admin('PUT', url, { ...draft, routingDomainId: null });
    assert.equal((await read()).routingDomainId, alternate.id);
    await admin('PUT', url, { ...draft, routingDomainId: northDefault });
    assert.equal((await read()).routingDomainId, northDefault);
    const southReader = await client('south-space-reader');
    await southReader('GET', url + '/data', undefined, 404);
    const recorded = await db.query(
      'SELECT action,detail FROM audit_log WHERE entity_type=$1 AND entity_id=$2 ORDER BY id', ['space', id],
    );
    assert.deepEqual(recorded.rows.map(row => [row.action, row.detail.routingDomainId]), [
      ['create', alternate.id], ['update', alternate.id], ['update', alternate.id], ['update', northDefault],
    ]);
  });

  await t.test('portable v1 subnet files identify their source and keep the selected destination domain and radio parents', async t => {
    if (postgres) {
      const db = new pg.Client({ connectionString: env.DATABASE_URL });
      await db.connect();
      t.after(() => db.end());
      for (const site of sites) {
        await db.query(
          `WITH domain AS (
             INSERT INTO routing_domains(company_id,name) VALUES($1,'Portable voice') RETURNING id
           )
           UPDATE address_spaces SET routing_domain_id=(SELECT id FROM domain) WHERE id=$2 AND company_id=$1`,
          [site.companyId, site.spaceId],
        );
      }
    }
    const prefix = await admin('POST', '/api/prefixes', {
      spaceId: north.spaceId, name: 'Portable radios', cidr: '192.0.2.224/29',
    });
    async function radio(spaceId, ip, radioMode, name, radioParentHostId = null) {
      const result = await admin('PUT', '/api/hosts', { spaceId, ip, name, type: 'Radio', radioMode, radioParentHostId });
      return result.id;
    }
    const apIp = '192.0.2.229', stationIp = '192.0.2.225', newIp = '192.0.2.226';
    const northAp = await radio(north.spaceId, apIp, 'ap', 'North AP');
    const northStation = await radio(north.spaceId, stationIp, 'station', 'North station', northAp);
    await radio(north.spaceId, newIp, 'station', 'New station', northAp);
    const secondApIp = '192.0.2.227', secondStationIp = '192.0.2.228';
    const secondAp = await radio(north.spaceId, secondApIp, 'ap', 'Second North AP');
    await radio(north.spaceId, secondStationIp, 'station', 'Second AP station', secondAp);
    const ordinaryHost = await radio(south.spaceId, secondApIp, '', 'South non-AP');
    const southAp = await radio(south.spaceId, apIp, 'ap', 'South AP');
    const otherAp = await radio(south.spaceId, '192.0.2.230', 'ap', 'Other AP');
    const southStation = await radio(south.spaceId, stationIp, 'station', 'South station', otherAp);

    const northReader = await client('north-reader');
    const southReader = await client('south-space-reader');
    const url = '/api/prefixes/' + prefix.id + '/export';
    await southReader('GET', url, undefined, 404);
    const pkg = await northReader('GET', url);
    const readSpace = async (reader, id) => (await reader('GET', '/api/spaces/' + id + '/data')).space;
    const source = await readSpace(northReader, north.spaceId);
    const destination = await readSpace(southReader, south.spaceId);
    assert.notEqual(source.routingDomainId, destination.routingDomainId);
    if (postgres) assert.deepEqual([source.routingDomainName, destination.routingDomainName], ['Portable voice', 'Portable voice']);
    assert.equal(pkg.formatVersion, 1);
    assert.ok(Number.isFinite(Date.parse(pkg.exportedAt)));
    assert.deepEqual(
      [pkg.source.companyId, pkg.source.spaceId, pkg.source.routingDomainId, pkg.source.routingDomainName],
      [north.companyId, north.spaceId, source.routingDomainId, source.routingDomainName],
    );
    const station = pkg.hosts.find(h => h.ip === stationIp);
    assert.deepEqual([station.sourceId, station.sourceRadioParentHostId], [northStation, northAp]);
    const body = { destinationSpaceId: south.spaceId, package: pkg, mode: 'skip' };
    await northReader('POST', '/api/imports/subnet', body, 403);

    async function destinationHosts() {
      const data = await southReader('GET', '/api/spaces/' + south.spaceId + '/data');
      return new Map(data.hosts.map(h => [h.ip, h]));
    }
    const { cidr, companyName, spaceName, spaceCidr } = pkg.source;
    const legacy = { ...pkg, source: { cidr, companyName, spaceName, spaceCidr } };
    const skipped = (await admin('POST', '/api/imports/subnet', { ...body, package: legacy })).result;
    assert.deepEqual([skipped.hostsSkipped, skipped.hostsCreated], [3, 2]);
    const afterSkip = await destinationHosts();
    assert.equal(afterSkip.get(stationIp).radioParentHostId, otherAp);
    assert.equal(afterSkip.get(stationIp).name, 'South station');
    assert.equal(afterSkip.get(newIp).radioParentHostId, southAp);
    assert.equal(afterSkip.get(secondStationIp).radioParentHostId, null);

    const replaced = (await admin('POST', '/api/imports/subnet', { ...body, mode: 'replace' })).result;
    assert.equal(replaced.hostsUpdated, 5);
    const afterReplace = await destinationHosts();
    assert.equal(afterReplace.get(apIp).id, southAp);
    assert.equal(afterReplace.get(secondApIp).radioMode, 'ap');
    assert.equal(afterReplace.get(secondStationIp).radioParentHostId, ordinaryHost);
    assert.equal(afterReplace.get(stationIp).id, southStation);
    assert.equal(afterReplace.get(newIp).id, afterSkip.get(newIp).id);
    assert.equal(afterReplace.get(stationIp).radioParentHostId, southAp);
    assert.equal(afterReplace.get(newIp).radioParentHostId, southAp);
    assert.equal((await readSpace(southReader, south.spaceId)).routingDomainId, destination.routingDomainId);
    const reexported = await northReader('GET', url);
    assert.deepEqual(reexported.hosts, pkg.hosts);
    assert.deepEqual(reexported.source, pkg.source);
  });

  await t.test('portable preview is scoped, read-only and matches skip/replace including trash and late conflicts', async () => {
    const source = (await admin('POST', '/api/spaces', { companyId: north.companyId, name: 'Portable source', cidr: '198.18.88.0/24' }, 201)).id;
    const target = (await admin('POST', '/api/spaces', { companyId: south.companyId, name: 'Portable target', cidr: '198.18.88.0/24' }, 201)).id;
    const cidrs = ['198.18.88.0/25', '198.18.88.128/26', '198.18.88.192/27'];
    for (const cidr of cidrs) await admin('POST', '/api/prefixes', { spaceId: source, cidr, name: 'Source range' });
    const prefixIds = [];
    for (const cidr of cidrs.slice(0, 2)) prefixIds.push((await admin('POST', '/api/prefixes', { spaceId: target, cidr, name: 'Target range' })).id);
    await admin('DELETE', '/api/prefixes/' + prefixIds[1]);
    for (const last of [10, 11, 12, 13]) await admin('PUT', '/api/hosts', { spaceId: source, ip: '198.18.88.' + last, name: 'Source ' + last });
    const hostIds = [];
    for (const last of [10, 11]) hostIds.push((await admin('PUT', '/api/hosts', { spaceId: target, ip: '198.18.88.' + last, name: 'Target ' + last })).id);
    await admin('DELETE', '/api/hosts/' + target + '/198.18.88.11');
    const reader = await client('north-reader'), editor = await client('north-editor');
    const pkg = await admin('GET', '/api/spaces/' + source + '/export');
    const body = { destinationSpaceId: target, package: pkg };
    const snapshot = async () => ({
      source: await admin('GET', '/api/spaces/' + source + '/data'),
      target: await admin('GET', '/api/spaces/' + target + '/data'),
      trash: await admin('GET', '/api/trash'),
    });
    const before = await snapshot();
    const unauthenticated = await fetch(base + '/api/imports/subnet/preview', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EMS-CSRF': '1' }, body: JSON.stringify(body) });
    assert.equal(unauthenticated.status, 401);
    await reader('POST', '/api/imports/subnet/preview', body, 403);
    await editor('POST', '/api/imports/subnet/preview', body, 403);
    await editor('POST', '/api/imports/subnet/preview', { ...body, destinationSpaceId: source }, 403);
    await admin('POST', '/api/imports/subnet/preview', { ...body, destinationSpaceId: 'missing' }, 404);
    const ownPreview = await admin('POST', '/api/imports/subnet/preview', { ...body, destinationSpaceId: source });
    assert.equal(ownPreview.summary.hosts.existing, 4);
    const preview = await admin('POST', '/api/imports/subnet/preview', body);
    assert.deepEqual(preview.summary, {
      prefixes: { total: 3, newRecords: 1, existing: 2, archived: 1 },
      hosts: { total: 4, newRecords: 2, existing: 2, archived: 1 },
    });
    assert.equal(preview.destinationSpaceId, target);
    assert.equal(preview.sample.hosts.find(h => h.ip === '198.18.88.11').archived, true);
    for (const malformed of [
      { ...pkg, hosts: [{ ip: '203.0.113.10' }] },
      { ...pkg, hosts: [pkg.hosts[0], pkg.hosts[0]] },
      { ...pkg, prefixes: [pkg.prefixes[0], pkg.prefixes[0]] },
      { ...pkg, hosts: [null] },
    ]) {
      for (const endpoint of ['/api/imports/subnet/preview', '/api/imports/subnet']) {
        await admin('POST', endpoint, { ...body, package: malformed }, 400);
      }
    }
    assert.deepEqual(await snapshot(), before, 'preview and invalid requests must preserve source, target and trash');
    // A record created after preview is rechecked by commit, never overwritten in skip mode.
    const late = (await admin('PUT', '/api/hosts', { spaceId: target, ip: '198.18.88.12', name: 'Late record' })).id;
    const skipped = (await admin('POST', '/api/imports/subnet', { ...body, mode: 'skip' })).result;
    assert.deepEqual([skipped.prefixesCreated, skipped.prefixesSkipped, skipped.hostsCreated, skipped.hostsSkipped], [1, 2, 1, 3]);
    const afterSkip = await admin('GET', '/api/spaces/' + target + '/data');
    assert.equal(afterSkip.hosts.find(h => h.id === late).name, 'Late record');
    assert.equal(afterSkip.hosts.some(h => h.id === hostIds[1]), false, 'skip does not restore trash');
    const replaced = (await admin('POST', '/api/imports/subnet', { ...body, mode: 'replace' })).result;
    assert.deepEqual([replaced.prefixesUpdated, replaced.hostsUpdated], [3, 4]);
    const afterReplace = await admin('GET', '/api/spaces/' + target + '/data');
    assert.equal(afterReplace.hosts.find(h => h.ip === '198.18.88.10').id, hostIds[0]);
    assert.equal(afterReplace.hosts.find(h => h.ip === '198.18.88.11').id, hostIds[1]);
    assert.equal(afterReplace.hosts.find(h => h.id === late).name, 'Source 12');
    assert.equal(afterReplace.prefixes.find(p => p.cidr === cidrs[1]).id, prefixIds[1]);
    assert.deepEqual(afterReplace.space, before.target.space);
    assert.deepEqual(await admin('GET', '/api/spaces/' + source + '/data'), before.source);
    const roundTrip = await admin('GET', '/api/spaces/' + target + '/export');
    assert.deepEqual(roundTrip.hosts.map(({ sourceId, ...rest }) => rest), pkg.hosts.map(({ sourceId, ...rest }) => rest));
    assert.deepEqual(roundTrip.prefixes, pkg.prefixes);
  });

  await t.test('misnamed XLSX/CSV content drives preview and commit while invalid files leave data unchanged', async () => {
    const companyId = (await admin('POST', '/api/companies', { name: 'Format detection fixture' }, 201)).id;
    const spaceId = (await admin('POST', '/api/spaces', { companyId, name: 'Format LAN', cidr: '192.0.2.0/24' }, 201)).id;
    const original = await admin('PUT', '/api/hosts', { spaceId, ip: '192.0.2.50', name: 'Existing format host', mac: '02:00:00:00:55:50' });
    const before = await admin('GET', '/api/spaces/' + spaceId + '/data');
    const siblingBefore = await admin('GET', '/api/spaces/' + south.spaceId + '/data');
    const workbook = await fs.readFile(path.join(appDir, 'tests/fixtures/ipam-two-sheets.xlsx'));
    const upload = { destinationSpaceId: spaceId, filename: 'workbook-renamed.csv', base64: workbook.toString('base64') };
    const preview = await admin('POST', '/api/imports/ipam/preview', upload);
    assert.deepEqual(preview.summary, { total: 3, valid: 2, invalid: 1, existing: 1, newRecords: 1 });
    const reader = await client('north-reader');
    await reader('POST', '/api/imports/ipam/preview', upload, 403);
    await reader('POST', '/api/imports/ipam/commit', { ...upload, mode: 'update' }, 403);
    for (const buffer of [Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from([0xff, 0xfe, 0x49, 0]),
      Buffer.from('IP,Name\n192.0.2.90,\x00binary'), Buffer.from('{"format":"EMS-IPAM-SUBNET"}')]) {
      for (const endpoint of ['preview', 'commit']) await admin('POST', '/api/imports/ipam/' + endpoint,
        { ...upload, base64: buffer.toString('base64'), mode: 'update' }, 400);
    }
    assert.deepEqual(await admin('GET', '/api/spaces/' + spaceId + '/data'), before);
    const committed = await admin('POST', '/api/imports/ipam/commit', { ...upload, mode: 'update' });
    assert.deepEqual(committed.result, { total: 3, invalid: 1, created: 1, updated: 1, skipped: 0 });
    const after = await admin('GET', '/api/spaces/' + spaceId + '/data');
    const changed = after.hosts.find(h => h.ip === '192.0.2.50');
    assert.equal(changed.id, original.id);
    assert.equal(changed.mac, '02:00:00:00:55:50');
    assert.equal(changed.name, 'سوئیچ آزمایشی');
    const csv = { destinationSpaceId: spaceId, filename: 'text-renamed.xlsx',
      base64: Buffer.from('\ufeffIP;Name;Description\r\n192.0.2.94;CSV تغییرنام;توضیح فارسی').toString('base64') };
    assert.deepEqual((await admin('POST', '/api/imports/ipam/preview', csv)).summary,
      { total: 1, valid: 1, invalid: 0, existing: 1, newRecords: 0 });
    assert.deepEqual(await admin('GET', '/api/spaces/' + spaceId + '/data'), after);
    assert.equal((await admin('POST', '/api/imports/ipam/commit', { ...csv, mode: 'update' })).result.updated, 1);
    assert.equal((await admin('GET', '/api/spaces/' + spaceId + '/data')).hosts.find(h => h.ip === '192.0.2.94').name, 'CSV تغییرنام');
    assert.deepEqual(await admin('GET', '/api/spaces/' + south.spaceId + '/data'), siblingBefore);
  });

  await t.test('MS-03 HTTP search and direct reads isolate overlapping Spaces in the same branch', {
    skip: !postgres && 'requires the disposable PostgreSQL database with domain-scoped uniqueness',
  }, async t => {
    const db = new pg.Client({ connectionString: env.DATABASE_URL });
    await db.connect();
    t.after(() => db.end());
    // This suite drops its own database on exit. Only this final fixture uses the proposed CIDR key.
    await db.query(`ALTER TABLE address_spaces
      DROP CONSTRAINT address_spaces_company_id_cidr_key`);
    const reader = await client('south-space-reader');
    const readSpace = (call, id) => call('GET', '/api/spaces/' + id + '/data');
    const { space: first } = await readSpace(reader, south.spaceId);
    const { rows: [domain] } = await db.query(
      'INSERT INTO routing_domains(company_id, name) VALUES ($1, $2) RETURNING id, name',
      [south.companyId, 'Sibling voice'],
    );
    const { id: siblingId } = await admin('POST', '/api/spaces', {
      companyId: south.companyId, cidr: first.cidr, name: first.name, routingDomainId: domain.id,
    }, 201);
    assert.notEqual(first.routingDomainId, domain.id);
    const ip = '192.0.2.79';
    const visible = { spaceId: first.id, routingDomainId: first.routingDomainId, routingDomainName: first.routingDomainName };
    const sibling = { spaceId: siblingId, routingDomainId: domain.id, routingDomainName: domain.name };
    for (const entry of [visible, sibling]) {
      const { id } = await admin('PUT', '/api/hosts', { spaceId: entry.spaceId, ip, name: 'Overlap host' });
      entry.id = id;
    }
    assert.notEqual(visible.id, sibling.id);

    for (const [call, expected] of [[admin, [visible, sibling]], [reader, [visible]]]) {
      const { items, pagination } = await call('GET', '/api/search?kind=host&q=' + ip);
      assert.equal(pagination.hasMore, false);
      assert.deepEqual(items.map(hit => hit.id).sort(), expected.map(entry => entry.id).sort());
      for (const entry of expected) {
        const hit = items.find(item => item.id === entry.id);
        assert.deepEqual([hit.companyId, hit.spaceId, hit.spaceCidr, hit.routingDomainId, hit.routingDomainName, hit.ip],
          [south.companyId, entry.spaceId, first.cidr, entry.routingDomainId, entry.routingDomainName, ip]);
        assert.equal(hit.source, 'ipam-inventory');
        assert.ok(Number.isFinite(Date.parse(hit.recordUpdatedAt)));
        assert.equal(hit.observedAt, null);
        const { space, hosts } = await readSpace(call, entry.spaceId);
        assert.deepEqual([space.id, space.companyId, space.routingDomainId], [entry.spaceId, south.companyId, entry.routingDomainId]);
        assert.deepEqual(hosts.filter(host => host.ip === ip).map(host => host.id), [entry.id]);
      }
    }
    await reader('GET', '/api/spaces/' + siblingId + '/data', undefined, 404);
  });

  await t.test('MS-02 CSV preview and commit preserve branch isolation and duplicate identities', async () => {
    const editor = await client('north-editor');
    const viewer = await client('north-reader');
    const read = site => admin('GET', '/api/spaces/' + site.spaceId + '/data');
    await admin('PUT', '/api/hosts', { spaceId: south.spaceId, ip: '192.0.2.93', name: 'South import sentinel' });
    const northBefore = await read(north);
    const southBefore = await read(south);
    const existing = northBefore.hosts.find(host => host.ip === '192.0.2.50');
    const csv = 'IP,Name,Description\n192.0.2.50,Imported existing,Updated notes\n192.0.2.93,Imported new,New notes\n203.0.113.1,Outside,Invalid row\n';
    const body = { destinationSpaceId: north.spaceId, filename: 'synthetic-branches.csv',
      base64: Buffer.from(csv).toString('base64'), mode: 'skip' };
    const root = '/api/imports/ipam/';
    for (const action of ['preview', 'commit']) {
      await editor('POST', root + action, { ...body, destinationSpaceId: south.spaceId }, 403);
      await editor('POST', root + action, body, 403);
      await viewer('POST', root + action, body, 403);
    }
    const preview = await admin('POST', root + 'preview', body);
    assert.deepEqual(preview.summary, { total: 3, valid: 2, invalid: 1, existing: 1, newRecords: 1 });
    assert.equal(preview.errors.length, 1);
    assert.deepEqual(await read(north), northBefore, 'preview must leave the destination untouched');
    assert.deepEqual(await read(south), southBefore, 'denied requests must not modify the other branch');

    const skip = await admin('POST', root + 'commit', body);
    assert.deepEqual(skip.result, { total: 3, invalid: 1, created: 1, updated: 0, skipped: 1 });
    const afterSkip = await read(north);
    assert.deepEqual(afterSkip.hosts.find(host => host.id === existing.id), existing);
    const created = afterSkip.hosts.find(host => host.ip === '192.0.2.93');
    assert.ok(created?.id);
    const again = await admin('POST', root + 'commit', body);
    assert.deepEqual(again.result, { total: 3, invalid: 1, created: 0, updated: 0, skipped: 2 });
    assert.deepEqual(await read(north), afterSkip);

    const update = await admin('POST', root + 'commit', { ...body, mode: 'update' });
    assert.deepEqual(update.result, { total: 3, invalid: 1, created: 0, updated: 2, skipped: 0 });
    const afterUpdate = await read(north);
    const updated = afterUpdate.hosts.find(host => host.ip === '192.0.2.50');
    assert.deepEqual([updated.id, updated.name, updated.notes, updated.mac],
      [existing.id, 'Imported existing', 'Updated notes', existing.mac]);
    assert.equal(afterUpdate.hosts.find(host => host.ip === '192.0.2.93').id, created.id);
    assert.ok(!afterUpdate.hosts.some(host => host.ip === '203.0.113.1'));
    assert.deepEqual(afterUpdate.space, northBefore.space);
    assert.deepEqual(await read(south), southBefore, 'same IP values in South retain their original records');
  });

  await t.test('owned XLSX fixtures clean up after success, partial provisioning and committed import failure', async () => {
    const snapshot = async () => {
      const boot = await admin('GET', '/api/bootstrap');
      return { companies: boot.companies, spaces: boot.spaces,
        north: await admin('GET', '/api/spaces/' + north.spaceId + '/data'),
        south: await admin('GET', '/api/spaces/' + south.spaceId + '/data'),
        trash: await admin('GET', '/api/trash') };
    };
    const before = await snapshot();
    for (const phase of ['success', 'provision', 'import']) {
      const call = async (method, url, ...args) => {
        if (phase === 'provision' && method === 'POST' && url === '/api/spaces') {
          throw new Error('injected provisioning failure');
        }
        return admin(method, url, ...args);
      };
      const run = withXlsxHttpFixture(call, async (destination, sibling) => {
        const evidence = await exerciseXlsxImport(call, destination, sibling);
        if (phase === 'import') throw new Error('injected after committed import');
        return evidence;
      });
      if (phase === 'success') {
        assert.ok((await run).createdHostId);
      } else {
        await assert.rejects(run, error => error instanceof AggregateError &&
          error.errors.length === 1 && /injected/.test(error.errors[0].message));
      }
      assert.deepEqual(await snapshot(), before, phase + ': existing branches/Spaces/hosts and trash unchanged');
    }
  });

  await t.test('XLSX fixture cleanup refuses changed ownership and reports failure', async () => {
    let changed;
    try {
      await assert.rejects(withXlsxHttpFixture(admin, async destination => {
        changed = destination;
        await admin('PUT', '/api/companies/' + destination.companyId,
          { name: 'Changed fixture ownership ' + destination.companyId, kind: 'branch' });
      }), error => error instanceof AggregateError && error.errors.length === 1 &&
        /ownership changed/.test(error.errors[0].message));
      const record = await admin('GET', '/api/companies/' + changed.companyId);
      assert.match(record.company.name, /^Changed fixture ownership /);
      const data = await admin('GET', '/api/spaces/' + changed.spaceId + '/data');
      assert.equal(data.space.companyId, changed.companyId);
    } finally {
      // Explicit repair of this test's deliberately changed record in the disposable DB.
      if (changed) {
        await admin('DELETE', '/api/companies/' + changed.companyId);
        await admin('DELETE', '/api/trash/company/' + changed.companyId);
      }
    }
  });

  await t.test('XLSX journal survives process exit after commit and supports exact-ID recovery', async () => {
    const journalPath = path.join(backups, 'interrupted-xlsx.jsonl');
    const boot = await admin('GET', '/api/bootstrap');
    const helper = new URL('./helpers/xlsx-http-fixture.mjs', import.meta.url).href;
    const scenario = new URL('./helpers/xlsx-import-scenario.mjs', import.meta.url).href;
    const source = `
      import { withXlsxHttpFixture } from ${JSON.stringify(helper)};
      import { exerciseXlsxImport } from ${JSON.stringify(scenario)};
      const base = process.env.FIXTURE_BASE;
      const login = await fetch(base+'/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:'test-admin',password:'Test-Password-01'})});
      if (login.status !== 200) throw Error('fixture login failed');
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const call = async (method,url,body,expected=200) => {
        const response = await fetch(base+url, {method, headers:{Cookie:cookie,'X-EMS-CSRF':'1','Content-Type':'application/json'},
          ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(5000)});
        if (response.status !== expected) throw Error('fixture HTTP failed');
        return response.json();
      };
      await withXlsxHttpFixture(call, async (a,b) => {
        await exerciseXlsxImport(call,a,b);
        process.exit(77); // Deliberately bypass finally after committed HTTP writes.
      }, {journalPath:process.env.FIXTURE_JOURNAL});
    `;
    const probe = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env:{...process.env,FIXTURE_BASE:base,FIXTURE_JOURNAL:journalPath}, stdio:'ignore',
    });
    const [code] = await once(probe, 'exit');
    assert.equal(code, 77);
    assert.equal((await fs.stat(journalPath)).mode & 0o777, 0o600);
    const journal = openFixtureJournal(journalPath);
    try { assert.equal(journal.owned.length, 2); assert.equal(journal.unresolved.length, 0); }
    finally { journal.close(); }
    await recoverXlsxHttpFixture(admin, journalPath);
    await recoverXlsxHttpFixture(admin, journalPath); // Completed recovery is repeatable.
    const after = await admin('GET', '/api/bootstrap');
    assert.deepEqual([after.companies,after.spaces], [boot.companies,boot.spaces]);
  });

  await t.test('XLSX journal refuses ambiguous create replies without deleting guessed records', async () => {
    const journalPath = path.join(backups, 'ambiguous-xlsx.jsonl');
    let created;
    const call = async (method,url,...args) => {
      const response = await admin(method,url,...args);
      if (method === 'POST' && url === '/api/companies') {
        created = response.id;
        throw Error('lost create response');
      }
      return response;
    };
    try {
      await assert.rejects(withXlsxHttpFixture(call, () => {}, {journalPath}), AggregateError);
      let requests = 0;
      await assert.rejects(recoverXlsxHttpFixture(async () => { requests++; }, journalPath), /unresolved create/);
      assert.equal(requests, 0);
      assert.equal((await admin('GET','/api/companies/'+created)).company.id, created);
    } finally {
      if (created) {
        await admin('DELETE','/api/companies/'+created);
        await admin('DELETE','/api/trash/company/'+created);
      }
    }
  });

  await t.test('XLSX recovery handles lost archive/purge replies and interruption before purge', async () => {
    const snapshot = async () => {
      const boot = await admin('GET', '/api/bootstrap');
      return {companies:boot.companies,spaces:boot.spaces,trash:await admin('GET','/api/trash')};
    };
    const before = await snapshot();
    for (const phase of ['archive', 'purge', 'before-purge']) {
      const journalPath = path.join(backups, 'cleanup-' + phase + '.jsonl');
      let injected = false;
      const call = async (method,url,...args) => {
        const purge = method === 'DELETE' && url.startsWith('/api/trash/company/');
        const archive = method === 'DELETE' && url.startsWith('/api/companies/');
        if (!injected && purge && phase === 'before-purge') {
          injected = true; throw Error('injected before purge');
        }
        const response = await admin(method,url,...args);
        if (!injected && ((purge && phase === 'purge') || (archive && phase === 'archive'))) {
          injected = true; throw Error('injected lost cleanup reply');
        }
        return response;
      };
      await assert.rejects(withXlsxHttpFixture(call,
        (a,b) => exerciseXlsxImport(call,a,b), {journalPath}), error =>
        error instanceof AggregateError && error.errors.length === 1 && /injected/.test(error.errors[0].message));
      assert.equal(injected, true);
      const journal = openFixtureJournal(journalPath);
      try {
        assert.equal(journal.owned.length, 1);
        assert.equal(Boolean(journal.owned[0].purging), phase !== 'archive');
      } finally { journal.close(); }
      if (phase === 'archive') {
        const reader = await client('north-reader');
        const evidence = await fs.readFile(journalPath,'utf8');
        let deletes = 0;
        await assert.rejects(recoverXlsxHttpFixture(async (method,...args) => {
          if (method === 'DELETE') deletes++;
          return reader(method,...args);
        }, journalPath), error => error instanceof AggregateError &&
          error.errors.some(item => /global admin view required/.test(item.message)));
        assert.equal(deletes, 0);
        assert.equal(await fs.readFile(journalPath,'utf8'), evidence);
      }
      await recoverXlsxHttpFixture(admin,journalPath);
      await recoverXlsxHttpFixture(admin,journalPath);
      assert.deepEqual(await snapshot(), before, phase + ': no existing branches/Spaces or trash changed');
    }
  });

  await t.test('XLSX recovery does not treat a missing record without purge intent as success', async () => {
    const journalPath = path.join(backups, 'unexplained-missing.jsonl');
    await assert.rejects(withXlsxHttpFixture(admin, async destination => {
      // Deliberate out-of-band removal inside this disposable test database.
      await admin('DELETE','/api/companies/'+destination.companyId);
      await admin('DELETE','/api/trash/company/'+destination.companyId);
    }, {journalPath}), error => error instanceof AggregateError &&
      error.errors.some(item => /without confirmed purge intent/.test(item.message)));
    let deletes = 0;
    await assert.rejects(recoverXlsxHttpFixture(async (method,...args) => {
      if (method === 'DELETE') deletes++;
      return admin(method,...args);
    }, journalPath), AggregateError);
    assert.equal(deletes, 0);
    const journal = openFixtureJournal(journalPath);
    try { assert.equal(journal.owned.length, 1); assert.equal(journal.owned[0].purging, undefined); }
    finally { journal.close(); }
  });

  await t.test('XLSX cleanup and recovery preserve an external Radio child and its fixture parent', {
    skip: !postgres && 'requires a separate SQL connection to the running fixture database',
  }, async () => {
    const db = new pg.Client({ connectionString: env.DATABASE_URL });
    await db.connect();
    const journalPath = path.join(backups, 'radio-reference-xlsx.jsonl');
    const beforeCleanup = id => assertFixtureRadioIsolation(db, id);
    let destination, parentId, linkedRows;
    const originalParent = (await db.query('SELECT radio_parent_host_id FROM hosts WHERE id=$1', [south.id])).rows[0].radio_parent_host_id;
    const deletes = [];
    const call = async (method, url, ...args) => {
      if (method === 'DELETE') deletes.push(url);
      return admin(method, url, ...args);
    };
    const snapshot = async () => (await db.query('SELECT * FROM hosts WHERE id=ANY($1::text[]) ORDER BY id', [[south.id, parentId]])).rows;
    const blocked = error => error instanceof AggregateError && error.errors.some(e => /external Radio children/.test(e.message));
    try {
      await assert.rejects(withXlsxHttpFixture(call, async site => {
        destination = site;
        parentId = (await admin('GET', '/api/spaces/' + site.spaceId + '/data')).hosts.find(h => h.ip === '192.0.2.50').id;
        await db.query('UPDATE hosts SET radio_parent_host_id=$1 WHERE id=$2', [parentId, south.id]);
        linkedRows = await snapshot();
      }, { journalPath, beforeCleanup }), blocked);
      assert.deepEqual(await snapshot(), linkedRows);
      assert.ok(!deletes.some(url => url.endsWith('/' + destination.companyId)));
      deletes.length = 0;
      const journalBefore = await fs.readFile(journalPath);
      await assert.rejects(recoverXlsxHttpFixture(call, journalPath, { beforeCleanup }), blocked);
      assert.deepEqual(await fs.readFile(journalPath), journalBefore);
      assert.deepEqual(await snapshot(), linkedRows);
      assert.deepEqual(deletes, []);
      const record = await admin('GET', '/api/companies/' + destination.companyId);
      assert.equal(record.company.id, destination.companyId);

      // Rehearse recovery of an already archived fixture with the same external link.
      await admin('DELETE', '/api/companies/' + destination.companyId);
      linkedRows = await snapshot();
      await assert.rejects(recoverXlsxHttpFixture(call, journalPath, { beforeCleanup }), blocked);
      assert.deepEqual(await fs.readFile(journalPath), journalBefore);
      assert.deepEqual(await snapshot(), linkedRows);
      assert.deepEqual(deletes, []);
      assert.ok((await admin('GET', '/api/trash')).items.some(item =>
        item.kind === 'company' && item.id === destination.companyId));
    } finally {
      // Remove only this test's injected relationship in its disposable database.
      try {
        await db.query('UPDATE hosts SET radio_parent_host_id=$1 WHERE id=$2', [originalParent, south.id]);
        await recoverXlsxHttpFixture(admin, journalPath, { beforeCleanup });
      } finally { await db.end(); }
    }
    assert.equal((await admin('GET', '/api/spaces/' + south.spaceId + '/data')).hosts.find(h => h.id === south.id).id, south.id);
  });

  for (const relation of ['child companies', 'Company grants', 'Space grants', 'Personnel']) {
    await t.test('XLSX cleanup and recovery preserve ' + relation + ' for active and archived fixtures', {
      skip: !postgres && 'requires a separate SQL connection to the running fixture database',
    }, async () => {
      const db = new pg.Client({ connectionString: env.DATABASE_URL });
      await db.connect();
      try {
        const userId = (await db.query("SELECT id FROM users WHERE username='north-reader'")).rows[0].id;
        const originalParent = (await db.query('SELECT parent_company_id FROM companies WHERE id=$1', [south.companyId])).rows[0].parent_company_id;
        const personnelId = relation === 'Personnel' ? randomUUID() : null;
        if (personnelId) await db.query('INSERT INTO personnel(id,full_name,company_id,active) VALUES ($1,$2,$3,false)',
          [personnelId, 'Synthetic existing Personnel', south.companyId]);
        const originalPersonnel = personnelId ? (await db.query('SELECT * FROM personnel WHERE id=$1', [personnelId])).rows[0] : null;
        const beforeCleanup = async id => {
          await assertFixtureRadioIsolation(db, id);
          await assertFixtureCompanyIsolation(db, id);
        };
        for (const archived of [false, true]) {
          const journalPath = path.join(backups, 'company-reference-' + relation.replaceAll(' ', '-') + '-' + archived + '.jsonl');
          let destination, linkedRows;
          const deletes = [];
          const call = async (method, url, ...args) => {
            if (method === 'DELETE') deletes.push(url);
            return admin(method, url, ...args);
          };
          const snapshot = async () => ({
            companies: (await db.query('SELECT * FROM companies WHERE id=ANY($1::text[]) ORDER BY id', [[south.companyId, destination.companyId]])).rows,
            spaces: (await db.query('SELECT * FROM address_spaces WHERE company_id=ANY($1::text[]) ORDER BY id', [[south.companyId, destination.companyId]])).rows,
            companyGrants: (await db.query('SELECT * FROM user_company_access ORDER BY user_id,company_id')).rows,
            spaceGrants: (await db.query('SELECT * FROM user_space_access ORDER BY user_id,space_id')).rows,
            personnel: (await db.query('SELECT * FROM personnel ORDER BY id')).rows,
          });
          const blocked = error => error instanceof AggregateError && error.errors.some(e => e.message.includes(relation));
          try {
            await assert.rejects(withXlsxHttpFixture(call, async site => {
              destination = site;
              // Rehearse a relationship introduced after archive as well as before it.
              if (archived) await admin('DELETE', '/api/companies/' + site.companyId);
              if (relation === 'child companies') {
                await db.query('UPDATE companies SET parent_company_id=$1 WHERE id=$2', [site.companyId, south.companyId]);
              } else if (relation === 'Company grants') {
                await db.query('INSERT INTO user_company_access(user_id,company_id) VALUES ($1,$2)', [userId, site.companyId]);
              } else if (relation === 'Space grants') {
                await db.query('INSERT INTO user_space_access(user_id,space_id) VALUES ($1,$2)', [userId, site.spaceId]);
              } else {
                await db.query('UPDATE personnel SET company_id=$1 WHERE id=$2', [site.companyId, personnelId]);
              }
              linkedRows = await snapshot();
            }, { journalPath, beforeCleanup }), blocked);
            assert.deepEqual(await snapshot(), linkedRows);
            assert.ok(!deletes.some(url => url.endsWith('/' + destination.companyId)));
            deletes.length = 0;
            const journalBefore = await fs.readFile(journalPath);
            await assert.rejects(recoverXlsxHttpFixture(call, journalPath, { beforeCleanup }), blocked);
            assert.deepEqual(await fs.readFile(journalPath), journalBefore);
            assert.deepEqual(await snapshot(), linkedRows);
            assert.deepEqual(deletes, []);
            if (archived) {
              assert.ok((await admin('GET', '/api/trash')).items.some(item => item.kind === 'company' && item.id === destination.companyId));
            } else {
              assert.equal((await admin('GET', '/api/companies/' + destination.companyId)).company.id, destination.companyId);
            }
          } finally {
            if (destination) {
              // Undo only this case's injected relationship in the disposable database.
              if (relation === 'child companies') await db.query('UPDATE companies SET parent_company_id=$1 WHERE id=$2', [originalParent, south.companyId]);
              else if (relation === 'Company grants') await db.query('DELETE FROM user_company_access WHERE user_id=$1 AND company_id=$2', [userId, destination.companyId]);
              else if (relation === 'Space grants') await db.query('DELETE FROM user_space_access WHERE user_id=$1 AND space_id=$2', [userId, destination.spaceId]);
              else await db.query('UPDATE personnel SET company_id=$1 WHERE id=$2', [originalPersonnel.company_id, personnelId]);
              await recoverXlsxHttpFixture(admin, journalPath, { beforeCleanup });
              await recoverXlsxHttpFixture(admin, journalPath, { beforeCleanup });
              if (personnelId) assert.deepEqual((await db.query('SELECT * FROM personnel WHERE id=$1', [personnelId])).rows[0], originalPersonnel);
            }
          }
        }
      } finally { await db.end(); }
    });
  }

  await t.test('XLSX fixture identity guards reject mismatched destinations without import requests', async () => {
    const read = site => admin('GET', '/api/spaces/' + site.spaceId + '/data');
    const before = await Promise.all([read(north), read(south)]);
    let posts = 0;
    const tracked = async (method, ...args) => {
      if (method === 'POST') posts++;
      return admin(method, ...args);
    };
    await assert.rejects(exerciseXlsxImport(tracked, north, north), /distinct fixture branches/);
    await assert.rejects(exerciseXlsxImport(tracked, { ...north, companyId: south.companyId },
      { ...south, companyId: north.companyId }), /identity mismatch/);
    await assert.rejects(exerciseXlsxImport(tracked, { spaceId: north.spaceId }, south), /companyId required/);
    assert.equal(posts, 0, 'invalid fixture identity must be rejected before preview or commit');
    assert.deepEqual(await Promise.all([read(north), read(south)]), before);
  });

  await t.test('MS-02 XLSX imports only the first worksheet and preserves Unicode and branch identities', async () => {
    await admin('PUT', '/api/hosts', { spaceId: south.spaceId, ip: '192.0.2.94', name: 'Sibling XLSX sentinel' });
    const evidence = await exerciseXlsxImport(admin, north, south);
    assert.equal(evidence.existingHostId, north.id);
    assert.notEqual(evidence.createdHostId, north.id);
    const before = await admin('GET', '/api/spaces/' + north.spaceId + '/data');
    // Reusing an already-populated destination is a provisioning error, not a fresh fixture pass.
    await assert.rejects(exerciseXlsxImport(admin, north, south), /addresses must be unused/);
    assert.deepEqual(await admin('GET', '/api/spaces/' + north.spaceId + '/data'), before);
  });
});
