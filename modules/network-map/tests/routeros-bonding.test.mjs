import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMikrotik} from '../discovery/device-parsers.mjs';
import {routerosOutputs} from './routeros-fixture-data.mjs';
import {routerosParserFixture as fixture} from './routeros-fixture.mjs';
import {buildTopology,traceMac,withBundleEvidence} from '../backend/model.mjs';
import {routerosBondMonitorCommand,MAX_BOND_MONITORS} from '../discovery/routeros-bonding.mjs';
import {collectDevice} from '../discovery/ssh.mjs';
import {EventEmitter} from 'node:events';
test('RouterOS keeps each bond and reports active versus inactive without inventing a down/standby cause',()=>{
 const result=parseMikrotik(fixture());
 assert.equal(result.bundles?.length,2);
 assert.equal(result.bundles[0].name,'bond-lacp');
 assert.deepEqual(result.bundles[0].members.map(m=>m.state),['bundled','inactive']);
 assert.equal(result.bundles[1].protocol,'active-backup');
 assert.equal(result.bundles[1].members[1].state,'inactive');
 assert.equal(result.ports.find(p=>p.name==='ether2').bundle,'bond-lacp');
});

test('wrapped member lists, empty active list and disabled bonds preserve their actual evidence',()=>{
 const input=fixture();input.bondMonitors['bond-lacp']='mode: 802.3ad\nactive-ports: ether1\n              ether2\ninactive-ports:';
 let bond=parseMikrotik(input).bundles[0];assert.equal(bond.state,'up');assert.ok(bond.members.every(m=>m.state==='bundled'));
 input.bondMonitors['bond-lacp']='mode: 802.3ad\nactive-ports:\ninactive-ports: ether1,ether2';
 bond=parseMikrotik(input).bundles[0];assert.equal(bond.state,'down');assert.ok(bond.members.every(m=>m.state==='inactive'));
 input.bonding=input.bonding.replace('0 R','0 X');delete input.bondMonitors['bond-lacp'];
 bond=parseMikrotik(input).bundles[0];assert.equal(bond.state,'down');assert.equal(bond.monitorStatus,'disabled');
});

test('missing, failed, mismatched or incomplete monitor results never infer members from carrier',()=>{
 for(const raw of [undefined,'failure: not supported','not enough permissions','mode: balance-xor\nactive-ports: ether1\ninactive-ports: ether2','mode: 802.3ad\nactive-ports: ether1','mode: 802.3ad\nactive-ports: ether1\ninactive-ports: ether1','mode: 802.3ad\nactive-ports: other\ninactive-ports: ether2']){
  const input=fixture();input.bondMonitors['bond-lacp']=raw;const bond=parseMikrotik(input).bundles[0];
  assert.equal(bond.state,'unknown',String(raw));assert.ok(bond.members.every(m=>m.state==='unknown'));
  assert.equal(bond.monitorStatus,'unavailable');
 }
});

test('saved RouterOS topology and MAC lookup retain independent bond modes and inactive paths',()=>{
 const at=new Date().toISOString(),parsed=parseMikrotik(fixture());
 const nodes=[{...parsed,id:'ros',name:'RouterOS',platform:'mikrotik',status:'online',collectedAt:at,checkedAt:at,
  neighbors:[{deviceId:'peer',localPort:'ether2',remotePort:'Gi2',protocol:'lldp'}],macs:[{mac:'02:00:00:00:00:73',port:'bond-lacp'}]},
  {id:'peer',name:'peer',status:'online',collectedAt:at,checkedAt:at,ports:[{name:'Gi2',status:'up'}]}];
 const map=buildTopology(nodes),before=structuredClone(map),link=map.links[0];
 assert.equal(link.state,'down');assert.equal(link.targetBundle.name,'bond-lacp');assert.equal(link.targetBundle.memberState,'inactive');
 assert.equal(withBundleEvidence(JSON.parse(JSON.stringify(map))).links[0].state,'down');assert.deepEqual(map,before);
 assert.equal(traceMac(map,'02:00:00:00:00:73','ros').candidates.length,0);
 const unavailable=fixture();unavailable.bonding='failure: no read access';
 const noConfig=parseMikrotik(unavailable);noConfig.id='ros';noConfig.macs=nodes[0].macs;
 assert.equal(traceMac({nodes:[noConfig],links:[]},'02:00:00:00:00:73','ros').candidates.length,0,'a known bond interface is never an access port even without bonding read permission');
});

test('bond monitor selector rejects command syntax and permits literal spaces without index lookup',()=>{
 assert.equal(routerosBondMonitorCommand('bond backup'),'/interface bonding monitor [find where name="bond backup"] once');
 for(const name of ['', 'x'.repeat(81),'bond; /system reboot','bond"','bond\\','bond$var','bond[0]','bond\nnext','bond\rnext','bond`cmd`'])assert.equal(routerosBondMonitorCommand(name),null,name);
});

test('known RouterOS aggregate carrier cannot certify a path when bonding read access is absent',()=>{
 const input=fixture();input.bonding='failure: no read access';
 const at=new Date().toISOString(),parsed=parseMikrotik(input);
 const map=buildTopology([{...parsed,id:'ros',name:'ros',status:'partial',collectedAt:at,checkedAt:at,
  neighbors:[{deviceId:'peer',localPort:'bond-lacp',remotePort:'Gi2',protocol:'lldp'}]},
  {id:'peer',name:'peer',status:'online',collectedAt:at,checkedAt:at,ports:[{name:'Gi2',status:'up'}]}]);
 assert.equal(map.links[0].state,'unknown');assert.equal(map.links[0].targetBundle.state,'unknown');
 map.links[0].state='up';delete map.links[0].targetBundle;delete map.links[0].sourceBundle;
 assert.equal(withBundleEvidence(map).links[0].state,'unknown');assert.equal(map.links[0].state,'up');
});

async function collectFixture(raw,options={}){
 const commands=[];let ended=false;
 const client=new EventEmitter(),stream=new EventEmitter();
 client.connect=()=>setImmediate(()=>client.emit('ready'));
 client.shell=(_opts,cb)=>{cb(null,stream);setImmediate(()=>stream.emit('data',Buffer.from('[reader@Fixture] > ')));};
 client.end=()=>{ended=true;};stream.close=()=>{};
 stream.write=value=>{const command=value.trim();commands.push(command);setImmediate(()=>{
  if(options.closeOn===command)return stream.emit('close');
  stream.emit('data',Buffer.from(command+'\r\n'+(raw[command]??'failure: unsupported fixture command')+'\r\n[reader@Fixture] > '));
 });};
 const result=await collectDevice({address:'192.0.2.50',platform:'auto'},{username:'reader',port:2222,timeout:1,saveConfig:false},'synthetic-only',{createSshClient:()=>client,verifyHostKey:async()=>true});
 assert.equal(ended,true);return {result,commands};
}

test('RouterOS 6/7 SSH sessions collect bounded per-name monitors and preserve export version behavior',async()=>{
 for(const version of ['6.49.17','7.16.2']){
  const raw=routerosOutputs(version),{result,commands}=await collectFixture(raw);
  assert.equal(result.status,'online');assert.equal(result.osFamily,'routeros');assert.equal(result.bundles.length,2);
  assert.equal(result.bundles[0].members[1].state,'inactive');
  assert.ok(commands.includes(version.startsWith('6.')?'/export hide-sensitive':'/export'));
  assert.equal(commands.filter(c=>c.includes('bonding monitor')).length,2);
  assert.ok(commands.every(c=>Object.hasOwn(raw,c)));
 }
});

test('unsupported monitors, unsafe names and a closed SSH stream fail closed without new sessions',async()=>{
 const raw=routerosOutputs();raw['/interface bonding monitor [find where name="bond-lacp"] once']='failure: not supported';
 let out=await collectFixture(raw);assert.equal(out.result.status,'partial');assert.equal(out.result.bundles[0].state,'unknown');
 raw['/interface bonding print detail without-paging']='0 R name="bond$injection" slaves=ether1,ether2 mode=802.3ad';
 out=await collectFixture(raw);assert.equal(out.result.status,'partial');assert.equal(out.commands.some(c=>c.includes('$injection')),false);
 out=await collectFixture(routerosOutputs(),{closeOn:'/interface bonding monitor [find where name="bond-lacp"] once'});
 assert.equal(out.result.status,'partial');assert.ok(out.result.bundles.every(b=>b.state==='unknown'));
});

test('one-shot monitors have a hard bound and no-bond devices need no monitor command',async()=>{
 const raw=routerosOutputs();raw['/interface bonding print detail without-paging']=Array.from({length:MAX_BOND_MONITORS+1},(_,i)=>`${i} R name=bond-${i} slaves=ether1,ether2 mode=802.3ad`).join('\n');
 let out=await collectFixture(raw);assert.equal(out.commands.filter(c=>c.includes('bonding monitor')).length,MAX_BOND_MONITORS);
 assert.ok(out.result.errors.includes('bonding-monitor-limit'));
 raw['/interface bonding print detail without-paging']='';out=await collectFixture(raw);
 assert.equal(out.result.status,'online');assert.equal(out.commands.filter(c=>c.includes('bonding monitor')).length,0);
});
