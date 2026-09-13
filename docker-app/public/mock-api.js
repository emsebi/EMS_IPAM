(() => {
  if (!new URLSearchParams(location.search).has("mock")) return;
  const companyId = "company-demo";
  const spaceId = "space-demo";
  const bootstrap = {
    ok: true,
    version: "0.6.0",
    user: { id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true },
    companies: [
      { id: companyId, parentCompanyId: null, kind: "company", code: "HQ", name: "هلدینگ نمونه", description: "دفتر مرکزی و مدیریت زیرساخت", address: "تهران، خیابان سازمان", postalCode: "1111111111", phone: "021-88770000", managerName: "علی رضایی", latitude: 35.7219, longitude: 51.3347, notes: "ارتباط اضطراری از طریق لینک پشتیبان برقرار می‌شود.", contactCount: 3, connectionCount: 2 },
      { id: "company-qazvin", parentCompanyId: companyId, kind: "branch", code: "QAZ", name: "شعبه قزوین", description: "واحد تولید و انبار مرکزی", address: "قزوین، شهر صنعتی", postalCode: "3411111111", phone: "028-33330000", managerName: "مهدی احمدی", latitude: 36.2797, longitude: 50.0049, notes: "", contactCount: 2, connectionCount: 2 },
      { id: "company-customer", parentCompanyId: null, kind: "customer", code: "ISP-24", name: "مشتری سرویس‌دهنده ۲۴", description: "سایت مشتری سازمانی", address: "کرج، منطقه ویژه", postalCode: "", phone: "026-32220000", managerName: "سارا محمدی", latitude: null, longitude: null, notes: "", contactCount: 1, connectionCount: 1 },
    ],
    spaces: [
      { id: spaceId, companyId, name: "شبکه اصلی", cidr: "192.168.0.0/16", color: "#3157d5", description: "" },
      { id: "space-demo-2", companyId, name: "شبکه 10.200", cidr: "10.200.0.0/16", color: "#2fa36f", description: "" },
      { id: "space-qazvin", companyId: "company-qazvin", name: "شبکه شعبه قزوین", cidr: "10.40.0.0/16", color: "#e48a2d", description: "" },
      { id: "space-customer", companyId: "company-customer", name: "بلوک مشتری", cidr: "172.20.24.0/24", color: "#805ad5", description: "" },
    ],
    fullCompanyIds: [companyId, "company-qazvin", "company-customer"],
    tools: [
      { tool: "VNC", label: "VNC", defaultPort: 5900, color: "#d94b5b" },
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
      { id: "p5", cidr: "192.168.2.0/23", name: "زیرساخت و سرویس‌ها", status: "active", role: "Infrastructure", vlan: "", gateway: "192.168.2.1", color: "#805ad5", description: "رنج والد تجهیزات مدیریت، سرورها و ارتباطات بی‌سیم" },
    ],
    hosts: [
      { id: "h1", ip: "192.168.2.10", name: "ESXi-01", status: "active", type: "سرور", os: "VMware ESXi", mac: "00:50:56:AA:10:20", vlan: "50", username: "admin", owner: "زیرساخت", location: "دیتاسنتر", vendor: "HPE", model: "DL380", secretRef: "Vault/ESXi-01", hasPassword: true, notes: "", ports: { SSH: 2222, RDP: 3390 }, connectionMethods: [{ type: "SSH" }, { type: "RDP" }], devicePorts: [{ id: "port-h1", hostId: "h1", name: "vmnic0", description: "Uplink", portType: "ethernet", speed: "10G", vlan: "Trunk" }] },
      { id: "h2", ip: "192.168.2.20", name: "MikroTik-Core", status: "active", type: "روتر", os: "RouterOS", mac: "", vlan: "99", username: "", owner: "شبکه", location: "دفتر مرکزی", vendor: "MikroTik", model: "CCR", secretRef: "Vault/Router-Core", notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [{ id: "port-h2", hostId: "h2", name: "sfp-sfpplus1", description: "To Core Switch", portType: "fiber", speed: "10G", vlan: "Trunk" }] },
      { id: "h3", ip: "192.168.3.11", name: "AP-Home", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:10:20:30", vlan: "120", username: "admin", owner: "شبکه", location: "ساختمان مرکزی", vendor: "MikroTik", model: "NetMetal", radioMode: "ap", ssid: "EMS-Backhaul", frequency: "5805 MHz", channel: "40 MHz", signal: "", monitorEnabled: true, monitorState: { online: true, stations: [{ mac: "74:4D:28:AA:01:01" }, { mac: "74:4D:28:AA:01:02" }] }, monitorCheckedAt: new Date().toISOString(), monitorFailures: 0, notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }], devicePorts: [{ id: "port-h3", hostId: "h3", name: "ether1", description: "PoE", portType: "ethernet", speed: "1G", vlan: "120" }] },
      { id: "h4", ip: "192.168.3.12", name: "Station-Warehouse", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:AA:01:01", vlan: "120", username: "admin", owner: "شبکه", location: "انبار", vendor: "MikroTik", model: "LHG", radioMode: "station", ssid: "EMS-Backhaul", radioParentHostId: "h3", frequency: "5805 MHz", signal: "-58 dBm", monitorState: { online: true }, monitorCheckedAt: new Date().toISOString(), monitorFailures: 0, notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [] },
      { id: "h5", ip: "192.168.3.13", name: "Station-Office-2", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:AA:01:02", vlan: "120", username: "admin", owner: "شبکه", location: "ساختمان اداری", vendor: "MikroTik", model: "SXTsq", radioMode: "station", ssid: "EMS-Backhaul", radioParentHostId: "h3", frequency: "5805 MHz", channel: "40 MHz", signal: "-66 dBm", monitorState: { online: true }, monitorCheckedAt: new Date().toISOString(), monitorFailures: 0, notes: "", ports: { MIK: 8291, SSH: 22 }, connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }], devicePorts: [] },
      { id: "h6", ip: "192.168.4.11", name: "AP-Branch", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:20:30:40", vlan: "140", username: "admin", owner: "شبکه", location: "شعبه", vendor: "MikroTik", model: "NetBox", radioMode: "ap", ssid: "EMS-Branch", frequency: "5745 MHz", channel: "20 MHz", signal: "", monitorEnabled: true, monitorState: { online: true }, monitorCheckedAt: new Date().toISOString(), monitorFailures: 0, notes: "", ports: { MIK: 8291, SSH: 22 }, connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }], devicePorts: [] },
      { id: "h7", ip: "192.168.4.12", name: "Station-Branch-1", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:AA:02:01", vlan: "140", username: "admin", owner: "شبکه", location: "سایت مشتری", vendor: "MikroTik", model: "LHG", radioMode: "station", ssid: "EMS-Branch", radioParentHostId: "h6", frequency: "5745 MHz", channel: "20 MHz", signal: "-61 dBm", monitorState: { online: true }, monitorCheckedAt: new Date().toISOString(), monitorFailures: 0, notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [] },
      { id: "h8", ip: "192.168.5.20", name: "Station-Unlinked", status: "reserved", type: "رادیو", os: "RouterOS", mac: "", vlan: "", username: "", owner: "شبکه", location: "نامشخص", vendor: "MikroTik", model: "", radioMode: "station", ssid: "", radioParentHostId: null, frequency: "", channel: "", signal: "", notes: "نیازمند اتصال به AP", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [] },
    ],
    pings: [
      { ip: "192.168.2.10", online: true, checkedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },
      { ip: "192.168.2.20", online: false, checkedAt: new Date().toISOString(), lastSeenAt: null },
    ],
  };
  const inventoryItem = (item) => ({ ...item, spaceId, spaceName: "شبکه اصلی", spaceCidr: "192.168.0.0/16", companyId, companyName: "هلدینگ نمونه", connectionMethods: item.connectionMethods || [] });
  const inventory = data.hosts.map(inventoryItem);
  const companyDetail = { ok: true, company: bootstrap.companies[0], contacts: [
    { id: "c1", fullName: "علی رضایی", jobTitle: "مدیر شعبه", phone: "021-88770001", mobile: "09121234567", email: "a.rezaei@example.com", isPrimary: true },
    { id: "c2", fullName: "رضا کریمی", jobTitle: "کارشناس فناوری اطلاعات", phone: "021-88770002", mobile: "09123334455", email: "it@example.com", isPrimary: false },
  ], connections: [
    { id: "l1", title: "اینترنت اصلی", ip: "203.0.113.24", provider: "ارائه‌دهنده اصلی", linkRole: "primary", deviceName: "MikroTik-Edge", connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }] },
    { id: "l2", title: "اینترنت پشتیبان", ip: "198.51.100.18", provider: "ارائه‌دهنده دوم", linkRole: "backup", deviceName: "Backup-Router", connectionMethods: [{ type: "HTTPS" }] },
  ], spaces: bootstrap.spaces.filter((item) => item.companyId === companyId), stats: { hosts: data.hosts.length, prefixes: data.prefixes.length, radios: data.hosts.filter((item) => item.radioMode).length } };
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
    const method = String(init.method || "GET").toUpperCase();
    if (url === "/api/bootstrap") payload = bootstrap;
    else if (/^\/api\/companies\/[^/]+$/.test(url) && method === "GET") payload = companyDetail;
    else if (/^\/api\/spaces\/[^/]+\/data$/.test(url)) payload = data;
    else if (url === "/api/users") payload = { ok: true, users: [{ id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true, companyIds: [], spaceIds: [] }] };
    else if (url === "/api/inventory") payload = { ok: true, items: inventory };
    else if (url === "/api/maps") payload = { ok: true, items: [map] };
    else if (/^\/api\/maps\/[^/]+\/data$/.test(url)) payload = mapData;
    else if (url === "/api/backups") payload = { ok: true, path: "/opt/ems-ipam/backups", items: [], settings: { enabled: true, intervalDays: 1, hour: 2, retentionDays: 30 }, nextRunAt: new Date(Date.now() + 86400000).toISOString() };
    else if (url.startsWith("/api/search")) {
      const query = new URL(url, location.origin).searchParams.get("q")?.trim() || "";
      const matches = inventory.filter((item) => [item.ip, item.name, item.mac, item.owner, item.ssid].some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())));
      const exact = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(query) && query.startsWith("192.168.") && !matches.some((item) => item.ip === query)
        ? [{ kind: "free-ip", ip: query, spaceId, spaceName: "شبکه اصلی", spaceCidr: "192.168.0.0/16", companyId, companyName: "شرکت ۱" }]
        : [];
      payload = { ok: true, items: [...exact, ...matches.map((item) => ({ kind: "host", ...item }))] };
    }
    else if (url === "/api/hosts" && method === "PUT") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body || {};
      const current = data.hosts.find((item) => item.id === body.id || item.ip === body.ip);
      const saved = { ...(current || {}), ...body, id: current?.id || `mock-host-${Date.now()}`, ports: body.ports || current?.ports || {}, devicePorts: body.devicePorts || current?.devicePorts || [] };
      if (current) Object.assign(current, saved); else data.hosts.push(saved);
      const inventoryCurrent = inventory.find((item) => item.id === saved.id || item.ip === saved.ip);
      if (inventoryCurrent) Object.assign(inventoryCurrent, inventoryItem(saved)); else inventory.push(inventoryItem(saved));
      payload = { ok: true, id: saved.id };
    }
    else if (url === "/api/prefixes" && method === "POST") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body || {};
      const current = data.prefixes.find((item) => item.id === body.id || item.cidr === body.cidr);
      const saved = { ...(current || {}), ...body, id: current?.id || `mock-prefix-${Date.now()}` };
      if (current) Object.assign(current, saved); else data.prefixes.push(saved);
      payload = { ok: true, id: saved.id };
    }
    else if (url.startsWith("/api/")) payload = { ok: true, id: "mock-id", online: 2, total: 254 };
    else return nativeFetch(input, init);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  window.EventSource = class MockEventSource extends EventTarget {
    constructor() { super(); setTimeout(() => this.dispatchEvent(new Event("open")), 20); }
    close() {}
  };
})();
