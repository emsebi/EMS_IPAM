// Pure, offline parser for Cisco IOS LLDP/CDP detail output.
// No network connections are made by this module.
const trim = (value, limit = 160) => String(value ?? "").trim().slice(0, limit);
const normalizePort = (value) => trim(value).replace(/^(GigabitEthernet)/i, "Gi").replace(/^(TenGigabitEthernet)/i, "Te").replace(/^(FastEthernet)/i, "Fa").replace(/^(Ethernet)/i, "Eth");
const splitBlocks = (text) => String(text ?? "").split(/\r?\n(?=(?:Device ID:|Local Intf:|Local Interface:|Chassis id:))/i);

export function parseCdpNeighborsDetail(text) {
  const neighbors = [];
  for (const block of splitBlocks(text)) {
    const device = block.match(/^Device ID:\s*(.+)$/im)?.[1];
    const ports = block.match(/Interface:\s*([^,\r\n]+),\s*Port ID\s*\(outgoing port\):\s*([^\r\n]+)/i);
    if (!device || !ports) continue;
    const address = block.match(/(?:IP address|IPv4 Address):\s*([^\s\r\n]+)/i)?.[1] ?? "";
    neighbors.push({ protocol: "cdp", deviceId: trim(device), localPort: normalizePort(ports[1]), remotePort: normalizePort(ports[2]), address: trim(address, 64) });
  }
  return neighbors;
}

export function parseLldpNeighborsDetail(text) {
  const neighbors = [];
  for (const block of splitBlocks(text)) {
    const local = block.match(/^Local (?:Intf|Interface):\s*(.+)$/im)?.[1];
    const device = block.match(/^System Name:\s*(.+)$/im)?.[1] ??
      block.match(/^Chassis id:\s*(.+)$/im)?.[1];
    const remote = block.match(/^Port id:\s*(.+)$/im)?.[1];
    if (!local || !device || !remote) continue;
    const address = block.match(/^\s*(?:IP|IPv4):\s*([^\s\r\n]+)/im)?.[1] ?? "";
    neighbors.push({ protocol: "lldp", deviceId: trim(device), localPort: normalizePort(local), remotePort: normalizePort(remote), address: trim(address, 64) });
  }
  return neighbors;
}

export function neighborsToTopology(localDevice, neighbors) {
  const localId = trim(localDevice?.id, 100), localName = trim(localDevice?.name || localId);
  if (!localId || !localName) throw new Error("Local device ID and name are required.");
  const nodes = [{ id: localId, name: localName, address: trim(localDevice.address, 64), platform: trim(localDevice.platform, 100) }];
  const links = [];
  const seen = new Set([localId.toLowerCase()]);
  const edges = new Set();
  for (const neighbor of neighbors) {
    const name = trim(neighbor.deviceId);
    if (!name || !neighbor.localPort || !neighbor.remotePort || name.toLowerCase() === localId.toLowerCase()) continue;
    const id = name.slice(0, 100);
    if (!seen.has(id.toLowerCase())) {
      seen.add(id.toLowerCase());
      nodes.push({ id, name, address: trim(neighbor.address, 64), platform: "" });
    }
    const key = [localId, id, neighbor.localPort, neighbor.remotePort].join("|").toLowerCase();
    if (edges.has(key)) continue;
    edges.add(key);
    links.push({ source: localId, target: id, sourcePort: normalizePort(neighbor.localPort), targetPort: normalizePort(neighbor.remotePort) });
  }
  return { nodes, links };
}
