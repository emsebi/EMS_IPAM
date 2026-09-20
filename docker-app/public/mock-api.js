(() => {
  if (!new URLSearchParams(location.search).has("mock")) return;
  const companyId = "company-demo";
  const spaceId = "space-demo";
  const bootstrap = {
    ok: true,
    version: "1.5.0-stage1-radio",
    user: { id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true },
    companies: [
      { id: companyId, parentCompanyId: null, kind: "company", code: "HQ", name: "Example Company", description: "دفتر مرکزی و مدیریت زیرساخت", address: "Demo City, Example Street", postalCode: "1111111111", phone: "021-88770000", managerName: "Test User 1001", latitude: 35.7219, longitude: 51.3347, notes: "ارتباط اضطراری از طریق لینک پشتیبان برقرار می‌شود.", contactCount: 3, connectionCount: 2 },
      { id: "company-qazvin", parentCompanyId: companyId, kind: "branch", code: "QAZ", name: "Branch-01", description: "واحد تولید و انبار مرکزی", address: "Demo Industrial Site", postalCode: "3411111111", phone: "028-33330000", managerName: "Test Manager 01", latitude: 36.2797, longitude: 50.0049, notes: "", contactCount: 2, connectionCount: 2 },
      { id: "company-customer", parentCompanyId: null, kind: "customer", code: "ISP-24", name: "Demo Customer", description: "سایت مشتری سازمانی", address: "Demo Remote Site", postalCode: "", phone: "026-32220000", managerName: "Test Manager 02", latitude: null, longitude: null, notes: "", contactCount: 1, connectionCount: 1 },
    ],
    spaces: [
      { id: spaceId, companyId, name: "Demo Core Network", cidr: "198.18.0.0/16", color: "#3157d5", description: "" },
      { id: "space-demo-2", companyId, name: "شبکه 10.200", cidr: "198.19.0.0/16", color: "#2fa36f", description: "" },
      { id: "space-qazvin", companyId: "company-qazvin", name: "Branch Network", cidr: "10.99.0.0/16", color: "#e48a2d", description: "" },
      { id: "space-customer", companyId: "company-customer", name: "بلوک مشتری", cidr: "172.20.24.0/24", color: "#805ad5", description: "" },
    ],
    fullCompanyIds: [companyId, "company-qazvin", "company-customer"],
    moduleIds: ["ipam","inventory","radio","radius","network-map","mac-finder","network-access"],
    moduleCatalog: [
      { id:"ipam", name:"مدیریت IP و شعب", description:"Core IPAM", installed:true },
      { id:"inventory", name:"تجهیزات", description:"Device inventory", installed:true },
      { id:"radio", name:"رادیوها", description:"AP / Station", installed:true },
      { id:"radius", name:"RADIUS / AAA", description:"FreeRADIUS", installed:false },
      { id:"network-map", name:"نقشه شبکه", description:"Topology", installed:false },
      { id:"mac-finder", name:"جست‌وجوی MAC", description:"MAC history", installed:false },
      { id:"network-access", name:"اکسس شبکه 802.1X / MAB", description:"Network access", installed:false },
    ],
    modules: [],
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
    space: { id: spaceId, companyId, companyName: "Example Company", name: "Demo Core Network", cidr: "198.18.0.0/16", color: "#3157d5", description: "" },
    prefixes: [
      { id: "p1", cidr: "198.18.0.0/21", name: "Demo HQ", status: "active", role: "دفتر", vlan: "", gateway: "198.18.0.1", color: "#2fa36f", description: "" },
      { id: "p2", cidr: "198.18.3.0/24", name: "Demo Wireless", status: "active", role: "Wireless", vlan: "120", gateway: "198.18.3.1", color: "#d94b5b", description: "" },
      { id: "p3", cidr: "198.18.2.0/29", name: "Demo Management", status: "reserved", role: "Management", vlan: "99", gateway: "", color: "#805ad5", description: "" },
      { id: "p4", cidr: "198.18.2.16/28", name: "Demo Servers", status: "active", role: "Server", vlan: "50", gateway: "", color: "#3157d5", description: "" },
      { id: "p5", cidr: "198.18.2.0/23", name: "Demo Infrastructure", status: "active", role: "Infrastructure", vlan: "", gateway: "198.18.2.1", color: "#805ad5", description: "رنج والد تجهیزات مدیریت، سرورها و ارتباطات بی‌سیم" },
    ],
    hosts: [
      { id: "h1", ip: "198.18.2.10", name: "ESXi-01", status: "active", type: "سرور", os: "VMware ESXi", mac: "00:50:56:AA:10:20", vlan: "50", username: "admin", owner: "زیرساخت", location: "دیتاسنتر", vendor: "HPE", model: "DL380", secretRef: "Vault/ESXi-01", hasPassword: true, notes: "", ports: { SSH: 2222, RDP: 3390 }, connectionMethods: [{ type: "SSH" }, { type: "RDP" }], devicePorts: [{ id: "port-h1", hostId: "h1", name: "vmnic0", description: "Uplink", portType: "ethernet", speed: "10G", vlan: "Trunk" }] },
      { id: "h2", ip: "198.18.2.20", name: "MikroTik-Core", status: "active", type: "روتر", os: "RouterOS", mac: "", vlan: "99", username: "", owner: "شبکه", location: "Demo HQ", vendor: "MikroTik", model: "CCR", secretRef: "Vault/Router-Core", notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [{ id: "port-h2", hostId: "h2", name: "sfp-sfpplus1", description: "To Core Switch", portType: "fiber", speed: "10G", vlan: "Trunk" }] },
      { id: "h3", ip: "198.18.3.11", name: "AP-Home", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:10:20:30", vlan: "120", username: "admin", owner: "شبکه", location: "Demo Building A", vendor: "MikroTik", model: "NetMetal", radioMode: "ap", ssid: "EMS-Backhaul", notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }], devicePorts: [{ id: "port-h3", hostId: "h3", name: "ether1", description: "PoE", portType: "ethernet", speed: "1G", vlan: "120" }] },
      { id: "h4", ip: "198.18.3.12", name: "Station-Warehouse", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:AA:01:01", vlan: "120", username: "admin", owner: "شبکه", location: "Demo Warehouse", vendor: "MikroTik", model: "LHG", radioMode: "station", ssid: "EMS-Backhaul", radioParentHostId: "h3", notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [] },
      { id: "h5", ip: "198.18.3.13", name: "Station-Office-2", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:AA:01:02", vlan: "120", username: "admin", owner: "شبکه", location: "Demo Office", vendor: "MikroTik", model: "SXTsq", radioMode: "station", ssid: "EMS-Backhaul", radioParentHostId: "h3", notes: "", ports: { MIK: 8291, SSH: 22 }, connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }], devicePorts: [] },
      { id: "h6", ip: "198.18.4.11", name: "AP-Branch", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:20:30:40", vlan: "140", username: "admin", owner: "شبکه", location: "Demo Branch", vendor: "MikroTik", model: "NetBox", radioMode: "ap", ssid: "EMS-Branch", notes: "", ports: { MIK: 8291, SSH: 22 }, connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }], devicePorts: [] },
      { id: "h7", ip: "198.18.4.12", name: "Station-Branch-1", status: "active", type: "رادیو", os: "RouterOS", mac: "74:4D:28:AA:02:01", vlan: "140", username: "admin", owner: "شبکه", location: "Demo Customer Site", vendor: "MikroTik", model: "LHG", radioMode: "station", ssid: "EMS-Branch", radioParentHostId: "h6", notes: "", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [] },
      { id: "h8", ip: "198.18.5.20", name: "Station-Unlinked", status: "reserved", type: "رادیو", os: "RouterOS", mac: "", vlan: "", username: "", owner: "شبکه", location: "نامشخص", vendor: "MikroTik", model: "", radioMode: "station", ssid: "", radioParentHostId: null, notes: "نیازمند اتصال به AP", ports: { MIK: 8291 }, connectionMethods: [{ type: "WINBOX" }], devicePorts: [] },
    ],
    pings: [
      { ip: "198.18.2.10", online: true, checkedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },
      { ip: "198.18.2.20", online: false, checkedAt: new Date().toISOString(), lastSeenAt: null },
    ],
  };
  const inventoryItem = (item) => ({ ...item, spaceId, spaceName: "Demo Core Network", spaceCidr: "198.18.0.0/16", companyId, companyName: "Example Company", connectionMethods: item.connectionMethods || [] });
  const inventory = data.hosts.map(inventoryItem);
  const companyDetail = { ok: true, company: bootstrap.companies[0], contacts: [
    { id: "c1", fullName: "Test User 1001", jobTitle: "مدیر شعبه", phone: "021-88770001", mobile: "09121234567", email: "a.rezaei@example.com", isPrimary: true },
    { id: "c2", fullName: "Test User 1002", jobTitle: "کارشناس فناوری اطلاعات", phone: "021-88770002", mobile: "09123334455", email: "it@example.com", isPrimary: false },
  ], connections: [
    { id: "l1", title: "اینترنت اصلی", ip: "192.0.2.24", provider: "ارائه‌دهنده اصلی", linkRole: "primary", deviceName: "MikroTik-Edge", connectionMethods: [{ type: "WINBOX" }, { type: "SSH" }] },
    { id: "l2", title: "اینترنت پشتیبان", ip: "198.51.100.18", provider: "ارائه‌دهنده دوم", linkRole: "backup", deviceName: "Backup-Router", connectionMethods: [{ type: "HTTPS" }] },
  ], personnel: [
    { id:"per-1", employeeCode:"1001", fullName:"Test User 1001", mobile:"+000000001", department:"Demo IT", jobTitle:"Network Engineer", active:true },
    { id:"per-2", employeeCode:"1002", fullName:"Test User 1002", mobile:"+000000002", department:"Demo Support", jobTitle:"Support", active:true }
  ], spaces: bootstrap.spaces.filter((item) => item.companyId === companyId), stats: { hosts: data.hosts.length, prefixes: data.prefixes.length, radios: data.hosts.filter((item) => item.radioMode).length } };
  const map = { id: "map-demo", companyId, companyName: "Example Company", name: "Demo Network Map", description: "ارتباط روتر، سرور و رادیو" };
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
    else if (url.startsWith("/api/personnel") && method === "GET") payload = { ok: true, items: [
      { id: "per-1", employeeCode: "10027", fullName: "Test User 1001", mobile: "09121234567", phone: "02188770001", email: "a.rezaei@example.com", department: "فناوری اطلاعات", jobTitle: "کارشناس شبکه", companyId, companyName: "Example Company", active: true },
      { id: "per-2", employeeCode: "10045", fullName: "Test User 1002", mobile: "09123334455", phone: "", email: "r.karimi@example.com", department: "زیرساخت", jobTitle: "پشتیبانی", companyId, companyName: "Example Company", active: true }
    ] };
    else if (url === "/api/users") payload = { ok: true, users: [{ id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true, companyIds: [], spaceIds: [], moduleIds: ["ipam","inventory","radio","radius","network-map","mac-finder","network-access"] }] };
    else if (url === "/api/device-types") payload = { ok: true, items: ["Server","Virtual Machine","Desktop","Laptop","Thin Client","Router","Switch","Firewall","Modem","Radio","Camera","Access Point","Printer","Other"].map((name,index)=>({id:`type-${index}`,name,color:"#3157d5"})) };
    else if (url === "/api/inventory") payload = { ok: true, items: inventory };
    else if (url === "/api/maps") payload = { ok: true, items: [map] };
    else if (/^\/api\/maps\/[^/]+\/data$/.test(url)) payload = mapData;
    else if (url === "/api/backups") payload = { ok: true, path: "/opt/ems-ipam/backups", items: [], settings: { enabled: true, intervalDays: 1, hour: 2, retentionDays: 30 }, nextRunAt: new Date(Date.now() + 86400000).toISOString() };
    else if (url.startsWith("/api/search")) {
      const query = new URL(url, location.origin).searchParams.get("q")?.trim() || "";
      const matches = inventory.filter((item) => [item.ip, item.name, item.mac, item.owner, item.ssid].some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())));
      const exact = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(query) && query.startsWith("198.18.") && !matches.some((item) => item.ip === query)
        ? [{ kind: "free-ip", ip: query, spaceId, spaceName: "Demo Core Network", spaceCidr: "198.18.0.0/16", companyId, companyName: "Example Company" }]
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
