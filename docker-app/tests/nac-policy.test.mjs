import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMac,prepareProfile,prepareRule,simulate,configDraft} from '../../modules/network-access/policy.mjs';
const profile = {name:'Office',description:'',enabled:true,knownMode:'accept-vlan',knownVlan:14,unknownMode:'guest-vlan',guestVlan:77};
const nas = {enabled:true,companyId:'tenant-a'};
const binding = {enabled:true};
const registry = {enabled:true,companyId:'tenant-a'};
test('MAC formats normalize; multicast and invalid fail closed', () => {
  for(const raw of ['AA-BB-CC-DD-EE-F0','aabb.ccdd.eef0','aa:bb:cc:dd:ee:f0'])
    assert.equal(normalizeMac(raw),'aa:bb:cc:dd:ee:f0');
  for(const bad of ['ff:ff:ff:ff:ff:ff','00:00:00:00:00:00','a:b:c','zz:aa:aa:aa:aa:aa'])
    assert.throws(()=>normalizeMac(bad));
});
test('different switches may use different guest/reject settings for same MAC',()=>{
  const guest=simulate({nas,binding,profile:prepareProfile(profile),registry:null});
  const blocked=simulate({nas,binding,profile:prepareProfile({...profile,unknownMode:'reject',guestVlan:null}),registry:null});
  assert.deepEqual([guest.decision,guest.radiusOutcome,guest.portOutcome,guest.vlan],['reject','Access-Reject','guest-vlan-if-switch-configured',77]);
  assert.deepEqual([blocked.decision,blocked.portOutcome,blocked.vlan],['reject','blocked',null]);
});
test('registered MACs use policy, but disabled or different-scope MACs fail closed',()=>{
  const allowed=simulate({nas,binding,profile,registry});
  assert.equal(allowed.decision,'accept');assert.equal(allowed.vlan,14);assert.equal(allowed.simulationOnly,true);
  assert.equal(simulate({nas,binding,profile,registry:{...registry,enabled:false}}).decision,'reject');
  assert.equal(simulate({nas,binding,profile,registry:{...registry,companyId:'other'}}).decision,'reject');
  assert.equal(simulate({nas,binding:{enabled:false},profile,registry}).decision,'reject');
  assert.equal(simulate({nas:{...nas,enabled:false},binding,profile,registry}).decision,'reject');
});
test('per-switch MAC rule overrides known policy only and cannot authorize unknown MAC',()=>{
  const rule=prepareRule({mode:'accept-vlan',vlan:26,note:'test',enabled:true});
  assert.equal(simulate({nas,binding,profile,registry,rule}).vlan,26);
  assert.equal(simulate({nas,binding,profile,registry,rule:{...rule,mode:'reject'}}).decision,'reject');
  assert.equal(simulate({nas,binding,profile,registry:null,rule}).decision,'reject');
  assert.equal(simulate({nas,binding,profile,registry:null,rule:{mode:'reject',enabled:true}}).portOutcome,'blocked');
  assert.throws(()=>prepareRule({mode:'reject',vlan:33,enabled:true}));
});
test('profiles reject invalid VLANs and contradictory schemas',()=>{
  for(const bad of [0,4095,'1;delete','01',-1]) assert.throws(()=>prepareProfile({...profile,guestVlan:bad}));
  assert.throws(()=>prepareProfile({...profile,guestVlan:14}));
  assert.throws(()=>prepareProfile({...profile,unknownMode:'reject',guestVlan:77}));
  assert.throws(()=>prepareProfile({...profile,enabled:'true'}));
  assert.throws(()=>prepareProfile({...profile,danger:'yes'}));
});
test('CLI is a draft with no real secret and vendor-specific reject mapping',()=>{
  const c=configDraft({vendor:'cisco-legacy',radiusIp:'192.0.2.10',interfaceName:'GigabitEthernet1/0/4',profile});
  assert.match(c,/dot1x guest-vlan 77/);assert.match(c,/REPLACE_SHARED_SECRET/);
  const m=configDraft({vendor:'mikrotik',radiusIp:'192.0.2.10',interfaceName:'ether4',profile});
  assert.match(m,/reject-vlan-id=77/);assert.doesNotMatch(m,/guest-vlan-id=/);
  assert.match(m,/mac-auth-mode=mac-as-username-and-password/);
  assert.match(m,/radius-mac-format=xxxxxxxxxxxx/);
  assert.throws(()=>configDraft({vendor:'cisco-legacy',radiusIp:'192.0.2.10',interfaceName:'Gi1/0/1;reload',profile}));
  assert.throws(()=>configDraft({vendor:'mikrotik',radiusIp:'192.0.2.10',interfaceName:'bridge1',profile}));
});
