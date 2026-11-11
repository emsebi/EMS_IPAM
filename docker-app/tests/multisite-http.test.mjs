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
  });

  await t.test('portable subnet round-trip remaps radio parents only inside the selected branch', async () => {
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
    const station = pkg.hosts.find(h => h.ip === stationIp);
    assert.deepEqual([station.sourceId, station.sourceRadioParentHostId], [northStation, northAp]);
    const body = { destinationSpaceId: south.spaceId, package: pkg, mode: 'skip' };
    await northReader('POST', '/api/imports/subnet', body, 403);

    async function destinationHosts() {
      const data = await southReader('GET', '/api/spaces/' + south.spaceId + '/data');
      return new Map(data.hosts.map(h => [h.ip, h]));
    }
    const skipped = (await admin('POST', '/api/imports/subnet', body)).result;
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
    assert.deepEqual((await northReader('GET', url)).hosts, pkg.hosts);
  });
});
