(() => {
  if (!new URLSearchParams(location.search).has("mock")) return;
  const companyId = "company-demo";
  const spaceId = "space-demo";
  const bootstrap = {
    ok: true,
    version: "0.3.0",
    user: { id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true },
    companies: [{ id: companyId, name: "شرکت ۱", description: "ساختار نمونه برای بررسی رابط" }],
    spaces: [
      { id: spaceId, companyId, name: "شبکه اصلی", cidr: "192.168.0.0/16", color: "#3157d5", description: "" },
      { id: "space-demo-2", companyId, name: "شبکه 10.200", cidr: "10.200.0.0/16", color: "#2fa36f", description: "" },
    ],
    fullCompanyIds: [companyId],
    tools: [
      { tool: "VNC", label: "VNC", defaultPort: 5800, color: "#d94b5b" },
      { tool: "MIK", label: "WinBox", defaultPort: 8291, color: "#3478d4" },
      { tool: "RDP", label: "Remote Desktop", defaultPort: 3389, color: "#2fa36f" },
      { tool: "SSH", label: "SSH Terminal", defaultPort: 22, color: "#e48a2d" },
      { tool: "HTTP", label: "Web HTTP", defaultPort: 80, color: "#64748b" },
      { tool: "HTTPS", label: "Web HTTPS", defaultPort: 443, color: "#2b9ca8" },
    ],
  };
  const data = {
    ok: true,
    space: { id: spaceId, companyId, companyName: "شرکت ۱", name: "شبکه اصلی", cidr: "192.168.0.0/16", color: "#3157d5", description: "" },
    prefixes: [
      { id: "p1", cidr: "192.168.0.0/21", name: "دفتر مرکزی", status: "active", role: "دفتر", vlan: "", gateway: "192.168.0.1", color: "#2fa36f", description: "" },
      { id: "p2", cidr: "192.168.3.0/24", name: "کاربران وایرلس", status: "active", role: "Wireless", vlan: "120", gateway: "192.168.3.1", color: "#d94b5b", description: "" },
      { id: "p3", cidr: "192.168.2.0/29", name: "تجهیزات مدیریت", status: "reserved", role: "Management", vlan: "99", gateway: "", color: "#805ad5", description: "" },
      { id: "p4", cidr: "192.168.2.16/28", name: "سرورها", status: "active", role: "Server", vlan: "50", gateway: "", color: "#3157d5", description: "" },
    ],
    hosts: [
      { id: "h1", ip: "192.168.2.10", name: "ESXi-01", status: "active", type: "سرور", os: "VMware ESXi", mac: "00:50:56:AA:10:20", vlan: "50", username: "admin", owner: "زیرساخت", location: "دیتاسنتر", vendor: "HPE", model: "DL380", secretRef: "Vault/ESXi-01", hasPassword: true, notes: "", ports: { SSH: 2222, RDP: 3390 }, devicePorts: [{ id: "port-h1", hostId: "h1", name: "vmnic0", description: "Uplink", portType: "ethernet", speed: "10G", vlan: "Trunk" }] },
      { id: "h2", ip: "192.168.2.20", name: "MikroTik-Core", status: "active", type: "روتر", os: "RouterOS", mac: "", vlan: "99", username: "", owner: "شبکه", location: "دفتر مرکزی", vendor: "MikroTik", model: "CCR", secretRef: "Vault/Router-Core", notes: "", ports: { MIK: 8291 }, devicePorts: [{ id: "port-h2", hostId: "h2", name: "sfp-sfpplus1", description: "To Core Switch", portType: "fiber", speed: "10G", vlan: "Trunk" }] },
      { id: "h3", ip: "192.168.3.11", name: "AP-Home", status: "active", type: "رادیو", os: "RouterOS", mac: "", vlan: "120", username: "admin", owner: "شبکه", location: "ساختمان مرکزی", vendor: "MikroTik", model: "NetMetal", radioMode: "ap", ssid: "EMS-Backhaul", frequency: "5805 MHz", channel: "40 MHz", signal: "", notes: "", ports: { MIK: 8291 }, devicePorts: [{ id: "port-h3", hostId: "h3", name: "ether1", description: "PoE", portType: "ethernet", speed: "1G", vlan: "120" }] },
      { id: "h4", ip: "192.168.3.12", name: "Station-Warehouse", status: "active", type: "رادیو", os: "RouterOS", mac: "", vlan: "120", username: "admin", owner: "شبکه", location: "انبار", vendor: "MikroTik", model: "LHG", radioMode: "station", ssid: "EMS-Backhaul", radioParentHostId: "h3", frequency: "5805 MHz", signal: "-58 dBm", notes: "", ports: { MIK: 8291 }, devicePorts: [] },
    ],
    pings: [
      { ip: "192.168.2.10", online: true, checkedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },
      { ip: "192.168.2.20", online: false, checkedAt: new Date().toISOString(), lastSeenAt: null },
    ],
  };
  const inventory = data.hosts.map((item) => ({ ...item, spaceId, spaceName: "شبکه اصلی", spaceCidr: "192.168.0.0/16", companyId, companyName: "شرکت ۱", connectionMethods: [] }));
  const map = { id: "map-demo", companyId, companyName: "شرکت ۱", name: "نقشه شبکه مرکزی", description: "ارتباط روتر، سرور و رادیو" };
  const mapData = { ok: true, map, nodes: [
    { ...inventory.find((item) => item.id === "h2"), id: "node-1", hostId: "h2", x: 130, y: 120, width: 170, height: 76 },
    { ...inventory.find((item) => item.id === "h1"), id: "node-2", hostId: "h1", x: 480, y: 290, width: 170, height: 76 },
    { ...inventory.find((item) => item.id === "h3"), id: "node-3", hostId: "h3", x: 820, y: 120, width: 170, height: 76 },
  ], links: [
    { id: "link-1", fromNodeId: "node-1", toNodeId: "node-2", fromPortName: "sfp-sfpplus1", toPortName: "vmnic0", color: "#3157d5", speed: "10G", medium: "fiber" },
    { id: "link-2", fromNodeId: "node-1", toNodeId: "node-3", fromPortName: "ether2", toPortName: "ether1", color: "#2fa36f", speed: "1G", medium: "ethernet" },
  ] };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    let payload;
    if (url === "/api/bootstrap") payload = bootstrap;
    else if (/^\/api\/spaces\/[^/]+\/data$/.test(url)) payload = data;
    else if (url === "/api/users") payload = { ok: true, users: [{ id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true, companyIds: [], spaceIds: [] }] };
    else if (url === "/api/inventory") payload = { ok: true, items: inventory };
    else if (url === "/api/maps") payload = { ok: true, items: [map] };
    else if (/^\/api\/maps\/[^/]+\/data$/.test(url)) payload = mapData;
    else if (url === "/api/backups") payload = { ok: true, path: "/opt/ems-ipam/backups", items: [] };
    else if (url.startsWith("/api/search")) payload = { ok: true, items: inventory.map((item) => ({ kind: "host", ...item })) };
    else if (url.startsWith("/api/")) payload = { ok: true, id: "mock-id", online: 2, total: 254 };
    else return nativeFetch(input, init);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  window.EventSource = class MockEventSource extends EventTarget {
    constructor() { super(); setTimeout(() => this.dispatchEvent(new Event("open")), 20); }
    close() {}
  };
})();
