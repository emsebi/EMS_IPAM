import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTopology, withBundleEvidence, impact, traceMac} from '../backend/model.mjs';
import {parseCiscoBundles} from '../discovery/device-parsers.mjs';
import {bundleFixtureNodes} from './bundle-fixture.mjs';

// Flag semantics: Cisco's IOS command reference and NX-OS 9.3 summary example.
// https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst4500/XE3-11-0E/command/reference/xe-311-cmd/show1.html
// https://developer.cisco.com/docs/cisco-nexus-9000-series-nx-api-cli-reference/latest/port-channel-commands/
const memberLink = (map, port) => map.links.find(l => l.sourcePort === port);

test('suspended bundle member cannot become a green path merely because its interface is connected', () => {
  const nodes = bundleFixtureNodes(), before = structuredClone(nodes), map = buildTopology(nodes);
  assert.equal(memberLink(map, 'Eth1/1').state, 'up');
  assert.equal(memberLink(map, 'Eth1/2').state, 'down');
  assert.equal(memberLink(map, 'Eth1/2').sourceEvidence.reason, 'member-suspended');
  assert.deepEqual(impact(map, nodes[0].id, {linkId: memberLink(map, 'Eth1/1').id}).affected, [nodes[1].id]);
  assert.deepEqual(nodes, before, 'deriving links must not rewrite collected evidence');
});

test('IOS and NX-OS preserve case-sensitive member flags, wrapped rows and unknown states', () => {
  const [bundle] = parseCiscoBundles('3 Po3(SU) Eth LACP Eth1/1(P) Eth1/2(p) Eth1/3(D)\n    Eth1/4(s) Eth1/5(H) Eth1/6(I) Eth1/7(r) Eth1/8(b)\n    Eth1/9(M) Eth1/10(f) Eth1/11(u) Eth1/12(w) Eth1/13(d) Eth1/14(Z)');
  assert.equal(bundle.state, 'up');
  assert.deepEqual(bundle.members.map(m => m.state), ['bundled','delay-lacp','down','suspended','standby','individual','removed','waiting','min-links','failed','unsuitable','waiting','default','unknown']);
  assert.equal(parseCiscoBundles('9 Po9(SM) LACP Gi1/0/1(P)')[0].state, 'down');
  assert.deepEqual(parseCiscoBundles('% Authorization failed'), []);
  assert.deepEqual(parseCiscoBundles(''), []);
});

test('independent endpoint bundle IDs and members never invent remote cable pairs', () => {
  const map = buildTopology(bundleFixtureNodes()), link = memberLink(map, 'Eth1/1');
  assert.equal(map.links.length, 2);
  assert.equal(link.sourceBundle.name, 'Po50');
  assert.equal(link.targetBundle.name, 'Po2');
  assert.deepEqual(link.sourceBundle.members.map(m => m.port), ['Eth1/1','Eth1/2','Eth1/3']);
  assert.deepEqual(link.targetBundle.members.map(m => m.port), ['Gi1/0/1','Gi1/0/2']);
  assert.equal(map.links.some(l => l.sourcePort === 'Eth1/3'), false);
  assert.equal(link.sourceEvidence.physicalState, 'up');
  assert.equal(link.sourceBundle.fresh, true);
});

test('standby, removed and waiting members are not paths; individual and unknown remain uncertain', () => {
  for (const [flag, expected] of [['H','down'],['r','down'],['b','down'],['w','down'],['u','down'],['m','down'],['f','down'],['I','unknown'],['d','unknown'],['Z','unknown'],['p','up']]) {
    const nodes = bundleFixtureNodes();
    nodes[0].bundles[0].members[0].flags = flag;
    assert.equal(memberLink(buildTopology(nodes), 'Eth1/1').state, expected, flag);
  }
});

test('aggregate min-links/down overrides member carrier; aggregate LLDP keeps endpoint IDs', () => {
  const nodes = bundleFixtureNodes();
  nodes[0].bundles[0].flags = 'SM';
  assert.equal(memberLink(buildTopology(nodes), 'Eth1/1').state, 'down');
  nodes[0].neighbors = [{address: nodes[1].address, localPort: 'Port-channel50', remotePort: 'Port-channel2', protocol: 'lldp'}];
  nodes[1].neighbors = [];
  const link = buildTopology(nodes).links[0];
  assert.equal(link.sourcePort, 'Po50');assert.equal(link.targetPort, 'Po2');
  assert.equal(link.state, 'down');assert.equal(link.sourceEvidence.reason, 'bundle-down');
});

test('missing, expired or failed collection never certifies a saved bundle as active', () => {
  for (const change of [n => {delete n.checkedAt;}, n => {delete n.collectedAt;}, n => {n.status='auth-error';}, n => {n.collectedAt=n.checkedAt='2020-01-01T00:00:00Z';}, n => {n.reachability='unreachable';}]) {
    const nodes=bundleFixtureNodes();change(nodes[0]);
    assert.equal(memberLink(buildTopology(nodes), 'Eth1/1').state, 'unknown');
  }
  const original=buildTopology(bundleFixtureNodes());
  const nodes=structuredClone(original.nodes);nodes.forEach(n=>{n.neighbors=[];});
  const retained=buildTopology(nodes,original);
  assert.equal(retained.links.length,2);
  assert.ok(retained.links.every(l=>l.state==='unknown'&&l.confidence==='stale'));
});

test('reading old saved bundles corrects states without mutating map, timestamps or layout', () => {
  const map=buildTopology(bundleFixtureNodes());
  map.links.forEach(l=>{l.state='up';delete l.sourceEvidence;delete l.targetEvidence;});
  const before=structuredClone(map),result=withBundleEvidence(map);
  assert.equal(memberLink(result,'Eth1/2').state,'down');
  assert.equal(result.updatedAt,before.updatedAt);assert.deepEqual(map,before);
});

test('MAC paths avoid inactive bundle members and never nominate a LAG as an access port', () => {
  const nodes=bundleFixtureNodes(), mac='02:00:00:00:00:72';
  nodes[0].macs=[{mac,port:'Po50',vlan:'72'},{mac,port:'Eth1/3',vlan:'72'}];
  nodes[1].ports.push({name:'Gi1/0/24',status:'up',mode:'access'});
  nodes[1].macs=[{mac,port:'Gi1/0/24',vlan:'72'}];
  let map=buildTopology(nodes),trace=traceMac(map,mac,nodes[0].id);
  assert.equal(trace.candidates.length,1);
  assert.deepEqual(trace.paths[0].links,[memberLink(map,'Eth1/1').id]);
  nodes[0].bundles[0].members[0].flags='s';map=buildTopology(nodes);
  trace=traceMac(map,mac,nodes[0].id);assert.equal(trace.paths[0].links,null);
});
