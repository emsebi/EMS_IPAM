import test from "node:test";
import assert from "node:assert/strict";
import { parseCdpNeighbors, parseInterfaces, parseVersion, compactPortLabel } from "../server/parsers.mjs";

test("Cisco CDP neighbor ports and management IP are parsed", () => {
  const text = `-------------------------
Device ID: SW-ACCESS-02.example
Entry address(es):
  IP address: 10.20.0.12
Platform: cisco WS-C2960X-48FPS-L, Capabilities: Switch IGMP
Interface: GigabitEthernet1/0/48, Port ID (outgoing port): GigabitEthernet1/0/48`;
  assert.deepEqual(parseCdpNeighbors(text)[0], {
    remoteName: "SW-ACCESS-02.example",
    ip: "10.20.0.12",
    localPort: "Gi1/0/48",
    remotePort: "Gi1/0/48",
    model: "cisco WS-C2960X-48FPS-L",
    discoveredBy: "CDP",
  });
});

test("access and trunk ports get compact labels", () => {
  const ports = parseInterfaces(`Port Name Status Vlan Duplex Speed Type
Gi1/0/23 User connected 96 a-full a-1000 10/100/1000BaseTX
Gi1/0/48 Uplink connected trunk a-full a-1000 10/100/1000BaseTX`, `Port Mode Encapsulation Status Native vlan
Gi1/0/48 on 802.1q trunking 1`);
  assert.equal(compactPortLabel(ports.find((item) => item.name === "Gi1/0/23")), "Gi1/0/23-AC96");
  assert.equal(compactPortLabel(ports.find((item) => item.name === "Gi1/0/48")), "Gi1/0/48-T");
});

test("IOS and Nexus identity fields are recognized", () => {
  const ios = parseVersion({ "show version": "SW-Core uptime is 4 weeks\nCisco IOS XE Software, Version 17.09.04\nSystem serial number : FOC123", "show inventory": "NAME: chassis\nPID: C9300-48P , VID: V01, SN: FOC123" });
  assert.equal(ios.hostname, "SW-Core");
  assert.equal(ios.platform, "IOS-XE");
  assert.equal(ios.model, "C9300-48P");
  assert.equal(ios.serial, "FOC123");
});
