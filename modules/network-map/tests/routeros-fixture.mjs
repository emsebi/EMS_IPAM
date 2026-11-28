// Saved synthetic evidence only. This helper never opens a connection.
import {parseMikrotik} from '../discovery/device-parsers.mjs';
import {routerosOutputs} from './routeros-fixture-data.mjs';

export function routerosParserFixture() {
 const raw=routerosOutputs();return {
  version:raw['/system resource print'],identity:raw['/system identity print'],
  ports:raw['/interface print detail without-paging'],bridgePorts:raw['/interface bridge port print detail without-paging'],
  macs:raw['/interface bridge host print detail without-paging'],bonding:raw['/interface bonding print detail without-paging'],
  bondMonitors:{'bond-lacp':raw['/interface bonding monitor [find where name="bond-lacp"] once'],'bond backup':raw['/interface bonding monitor [find where name="bond backup"] once']},
 };
}

export function routerosFixtureNode(at=new Date().toISOString()) {
 return {...parseMikrotik(routerosParserFixture()),id:'198.51.100.22',address:'198.51.100.22',name:'Synthetic RouterOS',platform:'mikrotik',status:'online',collectedAt:at,checkedAt:at,
  neighbors:[{address:'198.51.100.21',localPort:'ether2',remotePort:'Gi1/0/23',protocol:'lldp'},
   {address:'198.51.100.21',localPort:'ether4',remotePort:'Gi1/0/25',protocol:'lldp'}]};
}
