// Synthetic documentation-range nodes only; never opens SSH or probes a network.
import {parseCisco} from '../discovery/device-parsers.mjs';

export function bundleFixtureNodes(at = new Date().toISOString()) {
  const nx = parseCisco({
    version: 'Cisco Nexus Operating System (NX-OS) Software\nNXOS: version 9.3(8)',
    ports: 'Eth1/1 peer connected trunk full 10G SFP\nEth1/2 peer connected trunk full 10G SFP\nEth1/3 spare connected trunk full 10G SFP',
    bundles: '50 Po50(SU) Eth LACP Eth1/1(P) Eth1/2(s)\n                       Eth1/3(H)',
  });
  const ios = parseCisco({
    version: 'Cisco IOS XE Software, Version 17.12.1',
    ports: 'Gi1/0/1 peer connected trunk full 10G SFP\nGi1/0/2 peer connected trunk full 10G SFP',
    bundles: '2 Po2(SU) LACP Gi1/0/1(P) Gi1/0/2(P)',
  });
  const peer = (address, localPort, remotePort) => ({address, localPort, remotePort, protocol: 'lldp'});
  return [
    {...nx, id: '198.51.100.20', address: '198.51.100.20', name: 'Synthetic Nexus', platform: 'cisco', status: 'online', collectedAt: at, checkedAt: at,
      neighbors: [peer('198.51.100.21', 'Ethernet1/1', 'GigabitEthernet1/0/1'), peer('198.51.100.21', 'Ethernet1/2', 'GigabitEthernet1/0/2')]},
    {...ios, id: '198.51.100.21', address: '198.51.100.21', name: 'Synthetic IOS', platform: 'cisco', status: 'online', collectedAt: at, checkedAt: at,
      neighbors: [peer('198.51.100.20', 'GigabitEthernet1/0/1', 'Ethernet1/1'), peer('198.51.100.20', 'GigabitEthernet1/0/2', 'Ethernet1/2')]},
  ];
}
