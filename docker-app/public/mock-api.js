(() => {
  if (!new URLSearchParams(location.search).has("mock")) return;
  const companyId = "company-demo";
  const spaceId = "space-demo";
  const bootstrap = {
    ok: true,
    version: "0.1.0",
    user: { id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true },
    companies: [{ id: companyId, name: "شرکت ۱", description: "ساختار نمونه برای بررسی رابط" }],
    spaces: [
      { id: spaceId, companyId, name: "شبکه اصلی", cidr: "192.168.0.0/16", color: "#3157d5", description: "" },
      { id: "space-demo-2", companyId, name: "شبکه 10.200", cidr: "10.200.0.0/16", color: "#2fa36f", description: "" },
    ],
    tools: [
      { tool: "VNC", label: "VNC", defaultPort: 5800, color: "#d94b5b" },
      { tool: "MIK", label: "Winbox", defaultPort: 9191, color: "#3478d4" },
      { tool: "RDP", label: "Remote Desktop", defaultPort: 3388, color: "#2fa36f" },
      { tool: "SSH", label: "PuTTY", defaultPort: 0, color: "#e48a2d" },
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
      { id: "h1", ip: "192.168.2.10", name: "ESXi-01", status: "active", type: "سرور", os: "VMware ESXi", mac: "00:50:56:AA:10:20", vlan: "50", username: "admin", owner: "زیرساخت", location: "دیتاسنتر", secretRef: "Vault/ESXi-01", notes: "", ports: { SSH: 2222, RDP: 3390 } },
      { id: "h2", ip: "192.168.2.20", name: "MikroTik-Core", status: "active", type: "روتر", os: "RouterOS", mac: "", vlan: "99", username: "", owner: "شبکه", location: "دفتر مرکزی", secretRef: "Vault/Router-Core", notes: "", ports: { MIK: 9191 } },
    ],
    pings: [
      { ip: "192.168.2.10", online: true, checkedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },
      { ip: "192.168.2.20", online: false, checkedAt: new Date().toISOString(), lastSeenAt: null },
    ],
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    let payload;
    if (url === "/api/bootstrap") payload = bootstrap;
    else if (/^\/api\/spaces\/[^/]+\/data$/.test(url)) payload = data;
    else if (url === "/api/users") payload = { ok: true, users: [{ id: "admin-demo", username: "admin", displayName: "مدیر سیستم", role: "admin", active: true, companyIds: [] }] };
    else if (url.startsWith("/api/")) payload = { ok: true, id: "mock-id", online: 2, total: 254 };
    else return nativeFetch(input, init);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  window.EventSource = class MockEventSource extends EventTarget {
    constructor() { super(); setTimeout(() => this.dispatchEvent(new Event("open")), 20); }
    close() {}
  };
})();
