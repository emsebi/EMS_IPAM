import test from "node:test";
import assert from "node:assert/strict";
import { parseCdpNeighborsDetail, parseLldpNeighborsDetail, neighborsToTopology } from "../discovery/parsers.mjs";

test("CDP parses device and both port names", () => {
  const text = `Device ID: access-01
Entry address(es):
  IP address: 192.0.2.11
Platform: cisco WS-C2960, Capabilities: Switch
Interface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet0/1
Holdtime : 122 sec`;
  assert.deepEqual(parseCdpNeighborsDetail(text), [{ protocol:"cdp", deviceId:"access-01", localPort:"Gi1/0/1", remotePort:"Gi0/1", address:"192.0.2.11" }]);
});

test("LLDP parses system and remote port", () => {
  const text = `Local Intf: Gi1/0/2
Chassis id: 00:11:22:33:44:55
Port id: Gi0/24
System Name: access-02
Management Addresses:
    IP: 192.0.2.12`;
  assert.deepEqual(parseLldpNeighborsDetail(text), [{ protocol:"lldp", deviceId:"access-02", localPort:"Gi1/0/2", remotePort:"Gi0/24", address:"192.0.2.12" }]);
});

test("topology deduplicates repeated neighbors without losing parallel links", () => {
  const neighbors = [
    { deviceId:"access-01", localPort:"Gi1", remotePort:"Gi2" },
    { deviceId:"access-01", localPort:"Gi1", remotePort:"Gi2" },
    { deviceId:"access-01", localPort:"Gi3", remotePort:"Gi4" }
  ];
  const topology = neighborsToTopology({ id:"core", name:"Core" }, neighbors);
  assert.equal(topology.nodes.length, 2);
  assert.equal(topology.links.length, 2);
});
