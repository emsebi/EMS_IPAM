import assert from 'node:assert/strict';
import {buildTopology} from '../backend/model.mjs';
import {bundleFixtureNodes} from './bundle-fixture.mjs';
import {routerosFixtureNode} from './routeros-fixture.mjs';

// Used with both isolated PGlite and PostgreSQL 16; no real collection involved.
export async function assertSavedBundleReads({pool,call,companyId}) {
  const nodes=[...bundleFixtureNodes(),routerosFixtureNode()],mac='02:00:00:00:00:72';
  nodes[1].ports.push({name:'Gi1/0/24',status:'up',mode:'access'});
  nodes[1].macs=[{mac,port:'Gi1/0/24',vlan:'72'}];
  await call('PUT','/settings',{username:'synthetic-readonly',devices:nodes.map(n=>({address:n.address})),rootId:nodes[0].id});
  const topology=buildTopology(nodes),layout={positions:{[nodes[0].id]:{x:200,y:100}},background:''};
  topology.links.forEach(l=>{l.state='up';delete l.sourceEvidence;delete l.targetEvidence;});
  await pool.query('UPDATE network_map_state SET topology=$1::jsonb,layout=$2::jsonb WHERE company_id=$3',[JSON.stringify(topology),JSON.stringify(layout),companyId]);
  const stored=async()=>({
    state:(await pool.query('SELECT * FROM network_map_state WHERE company_id=$1',[companyId])).rows,
    settings:(await pool.query('SELECT * FROM network_map_settings WHERE company_id=$1',[companyId])).rows,
    snapshots:(await pool.query('SELECT * FROM network_map_snapshots WHERE company_id=$1 ORDER BY id',[companyId])).rows,
    keys:(await pool.query('SELECT * FROM network_map_host_keys WHERE company_id=$1 ORDER BY address',[companyId])).rows,
  });
  const before=await stored(),state=(await call('GET','/state')).body;
  assert.equal(state.topology.links.find(l=>l.sourcePort==='Eth1/2').state,'down');
  const rosLink=state.topology.links.find(l=>l.targetPort==='ether2');
  assert.equal(rosLink.state,'down');assert.equal(rosLink.targetBundle.kind,'routeros-bond');
  assert.equal(rosLink.targetBundle.name,'bond-lacp');assert.equal(rosLink.targetBundle.memberState,'inactive');
  assert.equal(state.topology.links.find(l=>l.targetPort==='ether4').targetBundle.protocol,'active-backup');
  const rosTrace=(await call('GET','/trace?mac=02%3A00%3A00%3A00%3A00%3A73')).body;
  assert.equal(rosTrace.observations.length,1);assert.equal(rosTrace.candidates.length,0);
  assert.equal(state.topology.updatedAt,topology.updatedAt);assert.deepEqual(state.layout,layout);
  const active=state.topology.links.find(l=>l.sourcePort==='Eth1/1');
  const impact=(await call('GET','/impact?linkId='+encodeURIComponent(active.id))).body;
  assert.deepEqual(impact.affected,[nodes[1].id]);
  const trace=(await call('GET','/trace?mac='+encodeURIComponent(mac))).body;
  assert.deepEqual(trace.paths[0].links,[active.id]);
  assert.deepEqual(await stored(),before,'reading and tracing old evidence must not rewrite state/settings/archives/keys');
  return state;
}
