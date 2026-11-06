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
  const final=(await admin('GET','/api/inventory')).items.filter(h=>h.ip==='192.0.2.50');
  assert.deepEqual(final.map(h=>[h.id,h.name]).sort(),[[north.id,'North edited'],[south.id,'South fixture']].sort());
});
