import crypto from "node:crypto";

export function cleanText(value, max = 500) {
  return String(value ?? "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "").trim().slice(0, max);
}

export function validIpv4(value) {
  const parts = String(value || "").trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function normalizeInterface(value) {
  return cleanText(value, 80)
    .replace(/^GigabitEthernet/i, "Gi")
    .replace(/^TenGigabitEthernet/i, "Te")
    .replace(/^TwentyFiveGigE/i, "Twe")
    .replace(/^FortyGigabitEthernet/i, "Fo")
    .replace(/^HundredGigE/i, "Hu")
    .replace(/^FastEthernet/i, "Fa")
    .replace(/^Ethernet/i, "Eth")
    .replace(/^Port-channel/i, "Po")
    .replace(/\s+/g, "");
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const found = String(text || "").match(pattern);
    if (found?.[1]) return cleanText(found[1], 200);
  }
  return "";
}

function commandOutput(outputs, needles) {
  for (const [command, value] of Object.entries(outputs || {})) {
    if (needles.some((needle) => command.toLowerCase().includes(needle))) return String(value || "");
  }
  return "";
}

export function parseVersion(outputs, fallbackIp = "") {
  const version = commandOutput(outputs, ["show version"]);
  const hostnameLine = commandOutput(outputs, ["include ^hostname", "show hostname"]);
  const hostname = firstMatch(hostnameLine, [/^hostname\s+([^\s#]+)/im, /^\s*([^\s#]+)\s*$/m])
    || firstMatch(version, [/^\s*([^\s,]+)\s+uptime is/im, /^Device name:\s*(\S+)/im])
    || fallbackIp;
  const platform = /NX-OS|Nexus/i.test(version) ? "NX-OS" : /IOS XE/i.test(version) ? "IOS-XE" : /Cisco IOS/i.test(version) ? "IOS" : "Cisco";
  const osVersion = firstMatch(version, [
    /NXOS:\s*version\s+([^\s,]+)/i,
    /system:\s+version\s+([^\s,]+)/i,
    /Cisco IOS XE Software,\s*Version\s+([^\s,]+)/i,
    /Cisco IOS Software[^\n]*Version\s+([^\s,]+)/i,
  ]);
  const model = firstMatch(`${version}\n${commandOutput(outputs, ["show inventory"])}`, [
    /Model [Nn]umber\s*:\s*([^\s,]+)/i,
    /PID:\s*([^\s,]+)/i,
    /cisco\s+(Nexus\S*\s+\S+|WS-C\S+|C9\S+|N9K-\S+)/i,
  ]).replace(/^Nexus\S*\s+/i, "");
  const inventory = commandOutput(outputs, ["show inventory"]);
  const serials = [...new Set([
    ...[...inventory.matchAll(/(?:SN|Serial [Nn]umber)\s*[:#]\s*([^\s,]+)/gi)].map((match) => cleanText(match[1], 80)),
    ...[...version.matchAll(/(?:System serial number|Processor Board ID)\s*[:#]\s*([^\s,]+)/gi)].map((match) => cleanText(match[1], 80)),
  ].filter(Boolean))];
  const uptime = firstMatch(version, [/^\s*[^\s,]+\s+uptime is\s+(.+)$/im, /Kernel uptime is\s+(.+)$/im]);
  return { hostname, platform, osVersion, model, serial: serials[0] || "", serials, uptime };
}

function splitNeighborBlocks(text) {
  const normalized = String(text || "").replace(/\r/g, "\n");
  if (/Device ID:/i.test(normalized)) return normalized.split(/-{10,}|(?=Device ID:)/i).filter((part) => /Device ID:/i.test(part));
  if (/Local Intf:/i.test(normalized)) return normalized.split(/-{10,}|(?=Local Intf:)/i).filter((part) => /Local Intf:/i.test(part));
  return [];
}

export function parseCdpNeighbors(text) {
  const results = [];
  for (const block of splitNeighborBlocks(text)) {
    const remoteName = firstMatch(block, [/Device ID:\s*([^\s(]+)/i]);
    const ip = firstMatch(block, [/IP(?:v4)? address:\s*(\d{1,3}(?:\.\d{1,3}){3})/i, /Management Address:\s*(\d{1,3}(?:\.\d{1,3}){3})/i]);
    const localPort = normalizeInterface(firstMatch(block, [/Interface:\s*([^,\n]+)/i]));
    const remotePort = normalizeInterface(firstMatch(block, [/Port ID \(outgoing port\):\s*([^\n]+)/i]));
    const model = firstMatch(block, [/Platform:\s*([^,\n]+)/i]);
    if (remoteName || ip) results.push({ remoteName, ip: validIpv4(ip) ? ip : "", localPort, remotePort, model, discoveredBy: "CDP" });
  }
  return results;
}

export function parseLldpNeighbors(text) {
  const results = [];
  for (const block of splitNeighborBlocks(text)) {
    const remoteName = firstMatch(block, [/System Name:\s*([^\s]+)/i, /Device ID:\s*([^\s(]+)/i]);
    const ip = firstMatch(block, [/Management Address(?:es)?\s*:\s*(?:IP:\s*)?(\d{1,3}(?:\.\d{1,3}){3})/i, /IP(?:v4)? address:\s*(\d{1,3}(?:\.\d{1,3}){3})/i]);
    const localPort = normalizeInterface(firstMatch(block, [/Local Intf:\s*([^\s,]+)/i, /Local Port id:\s*([^\n]+)/i]));
    const remotePort = normalizeInterface(firstMatch(block, [/Port id:\s*([^\n]+)/i, /Port ID \(outgoing port\):\s*([^\n]+)/i]));
    if (remoteName || ip) results.push({ remoteName, ip: validIpv4(ip) ? ip : "", localPort, remotePort, model: "", discoveredBy: "LLDP" });
  }
  return results;
}

function portLike(value) {
  return /^(?:Gi|Te|Twe|Fo|Hu|Fa|Eth|Et|Po|mgmt|Vl|Lo)\S+/i.test(normalizeInterface(value));
}

export function parseTrunkPorts(text) {
  const ports = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = cleanText(raw, 500);
    const tokens = line.split(/\s+/);
    if (!portLike(tokens[0])) continue;
    if (/\btrunk(?:ing)?\b|\bon\b.*802\.1q/i.test(line)) ports.add(normalizeInterface(tokens[0]));
  }
  return ports;
}

export function parseInterfaces(text, trunkText = "") {
  const trunks = parseTrunkPorts(trunkText);
  const ports = [];
  const seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = cleanText(raw, 600);
    const tokens = line.split(/\s+/);
    if (!portLike(tokens[0]) || tokens.length < 3) continue;
    const name = normalizeInterface(tokens[0]);
    if (seen.has(name)) continue;
    let statusIndex = tokens.findIndex((token, index) => index > 0 && /^(connected|notconnect|disabled|err-disabled|inactive|up|down|sfpAbsent|xcvrAbsen|admin-down)$/i.test(token));
    if (statusIndex < 0) continue;
    const rawStatus = tokens[statusIndex].toLowerCase();
    const vlanToken = tokens[statusIndex + 1] || "";
    const isTrunk = trunks.has(name) || /^(trunk|routed)$/i.test(vlanToken) || tokens.some((token) => /^trunk$/i.test(token));
    const vlan = /^\d{1,4}$/.test(vlanToken) ? vlanToken : "";
    const state = /err/i.test(rawStatus) ? "error"
      : /disabled|admin-down|inactive/i.test(rawStatus) ? "admin-down"
        : /connected|^up$/i.test(rawStatus) ? "up" : "free";
    const speed = [...tokens].reverse().find((token) => /^(?:a-)?(?:10|100|1000|2500|5000|10G|25G|40G|100G)(?:\([^)]+\))?$/i.test(token)) || "";
    const description = cleanText(tokens.slice(1, statusIndex).join(" "), 160).replace(/^--$/, "");
    ports.push({ name, description, status: state, rawStatus, mode: isTrunk ? "trunk" : "access", vlan: isTrunk ? "" : vlan, speed });
    seen.add(name);
  }
  for (const name of trunks) {
    if (!seen.has(name)) ports.push({ name, description: "", status: "up", rawStatus: "trunking", mode: "trunk", vlan: "", speed: "" });
  }
  return ports.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function parseVlans(text) {
  const vlans = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const match = raw.trim().match(/^(\d{1,4})\s+(\S.*?)\s{2,}(active|act\/unsup|suspended|shutdown)/i);
    if (match) vlans.push({ id: Number(match[1]), name: cleanText(match[2], 120), status: match[3].toLowerCase() });
  }
  return vlans;
}

export function parsePrivilege(text, prompt = "") {
  const match = String(text || "").match(/privilege (?:level )?is\s*(\d+)/i);
  if (match) return Number(match[1]);
  return String(prompt).trim().endsWith("#") ? 15 : 1;
}

export function buildDevice({ ip, prompt = "", outputs = {}, neighbors = [] }) {
  const identity = parseVersion(outputs, ip);
  const interfaceStatus = commandOutput(outputs, ["interface status", "interfaces status"]);
  const trunkStatus = commandOutput(outputs, ["interface trunk", "interfaces trunk"]);
  const ports = parseInterfaces(interfaceStatus, trunkStatus);
  const vlans = parseVlans(commandOutput(outputs, ["show vlan"]));
  const counts = ports.reduce((result, port) => {
    result.total += 1;
    if (port.status === "up") result.up += 1;
    if (port.status === "free") result.free += 1;
    if (port.status === "admin-down") result.adminDown += 1;
    if (port.status === "error") result.error += 1;
    return result;
  }, { total: 0, up: 0, free: 0, adminDown: 0, error: 0 });
  const stable = identity.serial || `${identity.hostname}|${ip}`;
  return {
    key: crypto.createHash("sha256").update(stable).digest("hex").slice(0, 24),
    ip,
    ...identity,
    privilege: parsePrivilege(commandOutput(outputs, ["show privilege"]), prompt),
    ports,
    vlans,
    portCounts: counts,
    neighbors,
    reachable: true,
    lastScanAt: new Date().toISOString(),
  };
}

export function compactPortLabel(port = {}) {
  const name = normalizeInterface(port.name || port.localPort || "");
  if (!name) return "—";
  if (port.mode === "trunk") return `${name}-T`;
  return port.vlan ? `${name}-AC${port.vlan}` : name;
}
