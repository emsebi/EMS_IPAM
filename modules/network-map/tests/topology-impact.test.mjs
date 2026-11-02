import test from 'node:test';
import assert from 'node:assert/strict';
import {impact,traceMac} from '../backend/model.mjs';

const mac='00:11:22:33:44:55';
const sorted=values=>[...values].sort();
function redundantMap(){
  return {
    nodes:['core','left','right','edge','leaf','island','isolated'].map(id=>({
      id,name:id,status:'online',platform:'cisco',collectedAt:new Date().toISOString(),
      ports:id==='leaf'?[{name:'Gi9',mode:'access'}]:[],
      macs:id==='leaf'?[{mac,port:'Gi9',vlan:'20'}]:[],
    })),
    links:[
      {id:'core-left',source:'core',target:'left',state:'up'},
      {id:'core-right',source:'core',target:'right',state:'up'},
      {id:'left-edge',source:'left',target:'edge',state:'up'},
      {id:'right-edge',source:'right',target:'edge',state:'up'},
      {id:'edge-leaf',source:'edge',target:'leaf',state:'up'},
      {id:'island-link',source:'island',target:'isolated',state:'up'},
    ],
  };
}

test('redundant physical paths survive one uplink or transit-switch loss',()=>{
  const topology=redundantMap(),before=structuredClone(topology);
  assert.deepEqual(impact(topology,'core',{linkId:'core-left'}).affected,[]);
  assert.deepEqual(impact(topology,'core',{nodeId:'left'}).affected,['left']);
  assert.deepEqual(sorted(impact(topology,'core',{nodeId:'edge'}).affected),['edge','leaf']);
  assert.deepEqual(impact(topology,'core',{linkId:'edge-leaf'}).affected,['leaf']);
  assert.deepEqual(topology,before,'simulated outages must not change the saved map');
});

test('a down backup is not redundancy and an already-down link adds no outage',()=>{
  const topology=redundantMap();
  topology.links.find(l=>l.id==='right-edge').state='down';
  assert.deepEqual(sorted(impact(topology,'core',{linkId:'core-left'}).affected),['edge','leaf','left']);
  assert.deepEqual(impact(topology,'core',{linkId:'right-edge'}).affected,[]);
  assert.deepEqual(sorted(impact(topology,'core',{nodeId:'left'}).affected),['edge','leaf','left']);
});

test('existing disconnected components stay unmapped, including root removal',()=>{
  const topology=redundantMap();
  for(const removal of [{linkId:'island-link'},{nodeId:'island'}]){
    const result=impact(topology,'core',removal);
    assert.deepEqual(result.affected,[]);
    assert.deepEqual(sorted(result.unmapped),['island','isolated']);
  }
  const rootLoss=impact(topology,'core',{nodeId:'core'});
  assert.deepEqual(sorted(rootLoss.affected),['core','edge','leaf','left','right']);
  assert.deepEqual(sorted(rootLoss.unmapped),['island','isolated']);
  for(const root of ['', 'missing']){
    const result=impact(topology,root,{linkId:'core-left'});
    assert.deepEqual(result.affected,[]);
    assert.deepEqual(sorted(result.unmapped),sorted(topology.nodes.map(n=>n.id)));
  }
});

test('parallel physical links remain distinct and estimates do not certify forwarding',()=>{
  const topology={nodes:[{id:'core'},{id:'edge'}],links:[
    {id:'port-1',source:'core',target:'edge',state:'up'},
    {id:'port-2',source:'edge',target:'core',state:'unknown'},
  ]};
  const result=impact(topology,'core',{linkId:'port-1'});
  assert.deepEqual(result.affected,[]);
  assert.equal(result.confidence,'topology-only');
  assert.match(result.note,/STP, LAG, VLANs and routing/);
  topology.links[1].state='down';
  assert.deepEqual(impact(topology,'core',{linkId:'port-1'}).affected,['edge']);
});

test('saved MAC paths avoid down links and preserve port/source/time evidence',()=>{
  const topology=redundantMap();
  topology.links.find(l=>l.id==='core-left').state='down';
  const before=structuredClone(topology),trace=traceMac(topology,mac,'core');
  assert.deepEqual(trace.paths,[{nodeId:'leaf',port:'Gi9',links:['core-right','right-edge','edge-leaf']}]);
  assert.equal(trace.observations[0].source,'mac-address-table');
  assert.equal(trace.observations[0].observedAt,topology.nodes.find(n=>n.id==='leaf').collectedAt);
  assert.equal(trace.observations[0].vlan,'20');
  assert.deepEqual(topology,before);
});

test('a saved MAC observation survives disconnection without inventing a root path',()=>{
  const topology=redundantMap();
  topology.links.find(l=>l.id==='edge-leaf').state='down';
  const trace=traceMac(topology,mac,'core');
  assert.equal(trace.observations.length,1);
  assert.equal(trace.paths[0].links,null);
  assert.deepEqual(traceMac(topology,mac,'leaf').paths[0].links,[],'the root itself needs no links');
  assert.equal(traceMac(topology,mac,'missing').paths[0].links,null);
});
