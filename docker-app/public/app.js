const COLORS = ["#3157d5", "#2fa36f", "#d94b5b", "#e48a2d", "#805ad5", "#2b9ca8", "#c2418c", "#64748b"];
const STATUS_LABELS = { active: "فعال", reserved: "رزروشده", planned: "برنامه‌ریزی‌شده", quarantine: "قرنطینه", retired: "غیرفعال", offline: "خاموش", fault: "نیازمند بررسی", free: "آزاد" };
const HOST_COLORS = { active: "#3157d5", reserved: "#805ad5", offline: "#64748b", fault: "#d94b5b", free: "#b8c0cc" };

const state = {
  bootstrap: null,
  data: null,
  currentCompanyId: null,
  currentSpaceId: null,
  view: "companies",
  sheetCidr: null,
  displayMode: "grid",
  paint: false,
  paintPrefix: 24,
  selectedCidr: null,
  scanning: false,
  events: null,
  reloadTimer: null,
};

const $ = (id) => document.getElementById(id);
const page = $("page");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("fa-IR").format(Number(value || 0));
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove("show"), 3200);
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  if (options.method && options.method !== "GET") headers["X-EMS-CSRF"] = "1";
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.error || `خطای ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function ipv4ToInt(value) {
  const parts = String(value).trim().split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    out = (out * 256 + octet) >>> 0;
  }
  return out >>> 0;
}

function intToIpv4(value) {
  const n = Number(value) >>> 0;
  return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

function parseCidr(value) {
  const match = String(value || "").trim().match(/^(.+)\/(\d|[12]\d|3[0-2])$/);
  if (!match) return null;
  const address = ipv4ToInt(match[1]);
  const prefix = Number(match[2]);
  if (address === null) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (address & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { cidr: `${intToIpv4(start)}/${prefix}`, prefix, start, end: start + size - 1, size, canonical: address === start };
}

function contains(container, candidate) {
  const a = typeof container === "string" ? parseCidr(container) : container;
  const b = candidate && typeof candidate === "object" ? candidate : typeof candidate === "string" && candidate.includes("/") ? parseCidr(candidate) : { start: typeof candidate === "number" ? candidate : ipv4ToInt(candidate), end: typeof candidate === "number" ? candidate : ipv4ToInt(candidate) };
  return Boolean(a && b && b.start !== null && b.start >= a.start && b.end <= a.end);
}

function networkAt(address, prefix) {
  return parseCidr(`${intToIpv4(address)}/${prefix}`);
}

function canWrite() {
  return ["admin", "editor"].includes(state.bootstrap?.user.role);
}

function isAdmin() {
  return state.bootstrap?.user.role === "admin";
}

function prefixInfo(item) {
  return parseCidr(item.cidr);
}

function hostMap() {
  return new Map((state.data?.hosts || []).map((item) => [item.ip, item]));
}

function pingMap() {
  return new Map((state.data?.pings || []).map((item) => [item.ip, item]));
}

function prefixesIn(start, end) {
  return (state.data?.prefixes || []).filter((item) => {
    const info = prefixInfo(item);
    return info && info.start <= end && info.end >= start;
  });
}

function mostSpecific(address) {
  return (state.data?.prefixes || [])
    .map((item) => ({ item, info: prefixInfo(item) }))
    .filter(({ info }) => info && contains(info, address))
    .sort((a, b) => b.info.prefix - a.info.prefix)[0]?.item || null;
}

function setLoginVisible(show) {
  $("loginView").classList.toggle("hidden", !show);
  $("appView").classList.toggle("hidden", show);
}

async function boot() {
  try {
    state.bootstrap = await request("/api/bootstrap");
    setLoginVisible(false);
    applyRoleVisibility();
    const savedCompany = localStorage.getItem("ems-company");
    state.currentCompanyId = state.bootstrap.companies.some((item) => item.id === savedCompany)
      ? savedCompany : state.bootstrap.companies[0]?.id || null;
    updateSelectors();
    renderCompanies();
    connectEvents();
  } catch (error) {
    if (error.status === 401) setLoginVisible(true);
    else {
      setLoginVisible(true);
      $("loginError").textContent = error.message;
      $("loginError").classList.remove("hidden");
    }
  }
}

function applyRoleVisibility() {
  document.querySelectorAll(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin()));
}

function updateSelectors() {
  const companies = state.bootstrap?.companies || [];
  $("companySelect").innerHTML = companies.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  $("companySelect").value = state.currentCompanyId || "";
  const spaces = (state.bootstrap?.spaces || []).filter((item) => item.companyId === state.currentCompanyId);
  $("spaceSelect").innerHTML = `<option value="">نمای شرکت</option>${spaces.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.cidr)} — ${escapeHtml(item.name)}</option>`).join("")}`;
  $("spaceSelect").value = state.currentSpaceId || "";
}

function connectEvents() {
  state.events?.close();
  const source = new EventSource("/api/events");
  state.events = source;
  source.addEventListener("open", () => $("liveBadge").classList.remove("offline"));
  source.addEventListener("error", () => $("liveBadge").classList.add("offline"));
  source.addEventListener("change", (event) => {
    const change = JSON.parse(event.data);
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(async () => {
      try {
        state.bootstrap = await request("/api/bootstrap");
        applyRoleVisibility();
        updateSelectors();
        if (state.currentSpaceId && (!change.spaceId || change.spaceId === state.currentSpaceId)) {
          state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`);
          renderCurrent();
        } else if (state.view === "companies") renderCompanies();
      } catch (error) { console.warn(error); }
    }, 250);
  });
}

async function loadSpace(spaceId, { sheetCidr = null } = {}) {
  state.currentSpaceId = spaceId;
  const space = state.bootstrap.spaces.find((item) => item.id === spaceId);
  if (!space) return;
  state.currentCompanyId = space.companyId;
  state.data = await request(`/api/spaces/${encodeURIComponent(spaceId)}/data`);
  state.view = sheetCidr ? "sheet" : "overview";
  state.sheetCidr = sheetCidr;
  state.paint = false;
  state.selectedCidr = null;
  localStorage.setItem("ems-company", state.currentCompanyId);
  updateSelectors();
  renderCurrent();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrent() {
  if (state.view === "sheet") renderSheet();
  else if (state.view === "overview") renderOverview();
  else renderCompanies();
}

function renderCompanies() {
  state.view = "companies";
  state.currentSpaceId = null;
  state.data = null;
  updateSelectors();
  const companies = (state.bootstrap?.companies || []).filter((item) => !state.currentCompanyId || item.id === state.currentCompanyId);
  const cards = companies.map((company) => {
    const spaces = state.bootstrap.spaces.filter((item) => item.companyId === company.id);
    return `<article class="company-card">
      <div class="company-card-head"><div><h3>${escapeHtml(company.name)}</h3><p>${escapeHtml(company.description || `${spaces.length} رنج اصلی`)}</p></div>
      <div class="entity-actions">${isAdmin() ? `<button class="btn sm edit-company" data-company="${escapeHtml(company.id)}">ویرایش</button><button class="btn sm danger delete-company" data-company="${escapeHtml(company.id)}">حذف</button>` : ""}${canWrite() ? `<button class="btn sm add-space" data-company="${escapeHtml(company.id)}">افزودن رنج</button>` : ""}</div></div>
      ${spaces.map((space) => `<div class="space-card-wrap"><button class="space-card open-space" data-space="${escapeHtml(space.id)}" style="--space-color:${escapeHtml(space.color)}"><b>${escapeHtml(space.name)}</b><small>${escapeHtml(space.cidr)}</small></button>${canWrite() ? `<div class="space-actions"><button class="btn sm edit-space" data-space="${escapeHtml(space.id)}">ویرایش</button><button class="btn sm danger delete-space" data-space="${escapeHtml(space.id)}">حذف</button></div>` : ""}</div>`).join("") || `<div class="empty-state">هنوز رنج اصلی تعریف نشده است.</div>`}
    </article>`;
  }).join("");
  page.innerHTML = `<div class="headline"><div><div class="crumb">نمای سازمانی</div><h2>شرکت‌ها و رنج‌های اصلی</h2><div class="subtitle">هر شرکت می‌تواند چند فضای آدرس مستقل و حتی رنج‌های هم‌نام داشته باشد.</div></div><div class="head-actions">${isAdmin() ? `<button id="addCompanyButton" class="btn">افزودن شرکت</button>` : ""}${canWrite() && state.currentCompanyId ? `<button id="addSpaceButton" class="btn primary">افزودن رنج اصلی</button>` : ""}</div></div><section class="company-grid">${cards || `<div class="empty-state panel">شرکتی برای نمایش وجود ندارد.</div>`}</section>`;
  $("addCompanyButton")?.addEventListener("click", () => openCompanyDialog());
  $("addSpaceButton")?.addEventListener("click", () => openSpaceDialog(state.currentCompanyId));
  page.querySelectorAll(".add-space").forEach((node) => node.addEventListener("click", () => openSpaceDialog(node.dataset.company)));
  page.querySelectorAll(".open-space").forEach((node) => node.addEventListener("click", () => loadSpace(node.dataset.space)));
  page.querySelectorAll(".edit-company").forEach((node) => node.addEventListener("click", () => openCompanyDialog(node.dataset.company)));
  page.querySelectorAll(".delete-company").forEach((node) => node.addEventListener("click", () => deleteCompany(node.dataset.company)));
  page.querySelectorAll(".edit-space").forEach((node) => node.addEventListener("click", () => openSpaceDialog(null, node.dataset.space)));
  page.querySelectorAll(".delete-space").forEach((node) => node.addEventListener("click", () => deleteSpace(node.dataset.space)));
}

function tileVisual(start) {
  const prefix = mostSpecific(start);
  const samples = [];
  for (let offset = 0; offset < 256; offset += 16) samples.push(mostSpecific(start + offset)?.color || "#eef1f6");
  const stripe = `linear-gradient(90deg,${samples.map((color, index) => `${color} ${index * 6.25}%,${color} ${(index + 1) * 6.25}%`).join(",")})`;
  return { color: prefix?.color || "#eef1f6", stripe, has: samples.some((color) => color !== "#eef1f6") };
}

function usedIntervals() {
  const intervals = [];
  for (const item of state.data?.prefixes || []) {
    if (item.status === "free") continue;
    const info = prefixInfo(item);
    if (info) intervals.push([info.start, info.end]);
  }
  for (const item of state.data?.hosts || []) {
    if (item.status === "free") continue;
    const address = ipv4ToInt(item.ip);
    if (address !== null) intervals.push([address, address]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const current of intervals) {
    const previous = merged.at(-1);
    if (!previous || current[0] > previous[1] + 1) merged.push([...current]);
    else previous[1] = Math.max(previous[1], current[1]);
  }
  return merged;
}

function attachPrefixEditHandlers() {
  page.querySelectorAll(".edit-prefix").forEach((node) => node.addEventListener("click", (event) => {
    event.stopPropagation();
    openPrefixDialog(null, node.dataset.id);
  }));
}

function attachPrefixDeleteHandlers() {
  page.querySelectorAll(".quick-delete-prefix").forEach((node) => node.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!confirm("این رنج حذف شود؟ اطلاعات جداگانهٔ IPها حذف نمی‌شود.")) return;
    try {
      await request(`/api/prefixes/${encodeURIComponent(node.dataset.id)}`, { method: "DELETE" });
      state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`);
      renderCurrent(); toast("رنج حذف شد.");
    } catch (error) { toast(error.message); }
  }));
}

function prefixButtons(minimum, maximum) {
  const items = [];
  for (let prefix = maximum; prefix >= minimum; prefix -= 1) items.push(`<button class="paint-prefix ${state.paintPrefix === prefix ? "active" : ""}" data-prefix="${prefix}">/${prefix}</button>`);
  return `<div class="segmented">${items.join("")}</div>`;
}

function renderOverview() {
  const space = state.data.space;
  const root = parseCidr(space.cidr);
  const tileCount = 2 ** (24 - root.prefix);
  const tilesPerRow = 16;
  const rows = Math.ceil(tileCount / tilesPerRow);
  const hosts = hostMap();
  const used = usedIntervals().reduce((sum, interval) => sum + interval[1] - interval[0] + 1, 0);
  const percent = Math.round((used / root.size) * 1000) / 10;
  let grid = `<div class="visual-map"><div class="visual-row axis-row"><div></div>${Array.from({ length: 16 }, (_, index) => `<div class="axis">${index}</div>`).join("")}</div>`;
  for (let row = 0; row < rows; row += 1) {
    const rowStartIndex = row * tilesPerRow;
    const rowCount = Math.min(tilesPerRow, tileCount - rowStartIndex);
    grid += `<div class="visual-row"><div class="axis row-axis">${formatNumber(rowStartIndex)}–${formatNumber(rowStartIndex + rowCount - 1)}</div>`;
    for (let col = 0; col < 16; col += 1) {
      const index = rowStartIndex + col;
      if (index >= tileCount) { grid += `<div></div>`; continue; }
      const start = root.start + index * 256;
      const cidr = `${intToIpv4(start)}/24`;
      const third = (start >>> 8) & 255;
      const count = [...hosts.keys()].filter((ip) => {
        const value = ipv4ToInt(ip); return value >= start && value <= start + 255;
      }).length;
      const visual = tileVisual(start);
      const exact = state.data.prefixes.find((item) => item.cidr === cidr);
      grid += `<button class="subnet-tile open-tile" data-cidr="${cidr}" style="--tile-color:${visual.color};--stripe:${visual.stripe}" title="${escapeHtml(exact?.name || cidr)}"><i class="fill"></i><span class="octet">${third}</span>${exact ? `<div class="tile-name">${escapeHtml(exact.name)}</div>` : ""}<div class="cidr">${cidr}</div><div class="count">${count ? `${formatNumber(count)} IP` : "—"}</div>${visual.has ? `<i class="stripe"></i>` : ""}</button>`;
    }
    grid += `</div>`;
  }
  grid += `</div>`;
  const rangeRows = [...state.data.prefixes].sort((a, b) => prefixInfo(a).start - prefixInfo(b).start || prefixInfo(a).prefix - prefixInfo(b).prefix).map((item) => {
    const info = prefixInfo(item);
    return `<div class="range-row"><i class="swatch" style="background:${escapeHtml(item.color)}"></i><div><div class="range-name">${escapeHtml(item.name)}</div><small class="ltr mono">${escapeHtml(item.cidr)}</small></div><small>${formatNumber(info.size)} آدرس</small><span class="status-pill">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span><div class="row-actions">${info.prefix >= 21 && info.prefix <= 24 ? `<button class="btn sm open-prefix-sheet" data-cidr="${escapeHtml(item.cidr)}">نمایش</button>` : ""}${canWrite() ? `<button class="btn sm edit-prefix" data-id="${escapeHtml(item.id)}">ویرایش</button><button class="btn sm danger quick-delete-prefix" data-id="${escapeHtml(item.id)}">حذف</button>` : ""}</div></div>`;
  }).join("");
  const selectionMinimum = Math.max(root.prefix, 23);
  if (state.paintPrefix < selectionMinimum || state.paintPrefix > 24) state.paintPrefix = 24;
  page.innerHTML = `<div class="headline"><div><div class="crumb">${escapeHtml(space.companyName)} ← رنج اصلی</div><h2 class="ltr mono">${escapeHtml(space.cidr)}</h2><div class="subtitle">${escapeHtml(space.name)} — هر خانه یک شبکهٔ /24 است.</div></div><div class="head-actions"><button class="btn" id="companyBack">نمای شرکت</button>${canWrite() ? `<button class="btn" id="editCurrentSpace">ویرایش رنج اصلی</button>` : ""}</div></div>
    <section class="stats"><div class="stat"><div class="label">کل آدرس‌ها</div><div class="value">${formatNumber(root.size)}</div><div class="foot ltr">${intToIpv4(root.start)} – ${intToIpv4(root.end)}</div></div><div class="stat"><div class="label">فضای تخصیص‌یافته</div><div class="value">${formatNumber(used)}</div><div class="progress"><i style="width:${Math.min(100, percent)}%"></i></div></div><div class="stat"><div class="label">فضای ثبت‌نشده</div><div class="value">${formatNumber(Math.max(0, root.size - used))}</div><div class="foot">${formatNumber(Math.max(0, 100 - percent))}٪ از کل شبکه</div></div><div class="stat"><div class="label">IP دارای اطلاعات</div><div class="value">${formatNumber(state.data.hosts.length)}</div><div class="foot">صرف‌نظر از نتیجهٔ پینگ</div></div></section>
    <section class="panel"><div class="toolbar"><div class="toolgroup"><b>اندازهٔ انتخاب</b>${prefixButtons(selectionMinimum, 24)}<span class="mode-note">برای /23 روی یکی از دو خانهٔ /24 کلیک کنید؛ هر دو جدول باز می‌شوند.</span></div><div class="legend"><span><i class="dot used"></i>رنج</span><span><i class="dot record"></i>IP ثبت‌شده</span><span><i class="dot free"></i>ثبت‌نشده</span></div></div><div class="map-wrap">${grid}</div></section>
    <div class="lower-grid"><section class="panel"><div class="section-title"><h3>رنج‌های ثبت‌شده</h3><span class="subtitle">${formatNumber(state.data.prefixes.length)} رنج</span></div><div class="range-list">${rangeRows || `<div class="empty-state">هنوز رنجی ثبت نشده است.</div>`}</div></section><section class="panel"><div class="section-title"><h3>خلاصه</h3></div><div class="summary-list"><div class="summary-item"><span>شرکت</span><b>${escapeHtml(space.companyName)}</b></div><div class="summary-item"><span>رنج اصلی</span><b class="ltr mono">${escapeHtml(space.cidr)}</b></div><div class="summary-item"><span>زیررنج‌ها</span><b>${formatNumber(state.data.prefixes.length)}</b></div><div class="summary-item"><span>درصد استفاده</span><b>${formatNumber(percent)}٪</b></div></div></section></div>`;
  $("companyBack").addEventListener("click", renderCompanies);
  $("editCurrentSpace")?.addEventListener("click", () => openSpaceDialog(null, space.id));
  page.querySelectorAll(".paint-prefix").forEach((node) => node.addEventListener("click", () => { state.paintPrefix = Number(node.dataset.prefix); renderOverview(); }));
  page.querySelectorAll(".open-tile").forEach((node) => node.addEventListener("click", () => {
    const tile = parseCidr(node.dataset.cidr);
    const target = networkAt(tile.start, state.paintPrefix);
    state.view = "sheet"; state.sheetCidr = target.cidr; state.paint = false; renderSheet(); window.scrollTo(0, 0);
  }));
  page.querySelectorAll(".open-prefix-sheet").forEach((node) => node.addEventListener("click", (event) => {
    event.stopPropagation();
    state.view = "sheet"; state.sheetCidr = node.dataset.cidr; state.paint = false; renderSheet();
  }));
  attachPrefixEditHandlers();
  attachPrefixDeleteHandlers();
}

function pingClass(ip, system, pings) {
  if (system) return "system";
  if (state.scanning) return "scanning";
  const item = pings.get(ip);
  if (!item) return "unknown";
  return item.online ? "online" : "offline";
}

function renderIpGrid(sheet) {
  const hosts = hostMap();
  const pings = pingMap();
  let grid = `<div class="visual-map ip-map"><div class="visual-row axis-row"><div></div>${Array.from({ length: 16 }, (_, index) => `<div class="axis">${index}</div>`).join("")}</div>`;
  for (let row = 0; row < 16; row += 1) {
    grid += `<div class="visual-row"><div class="axis row-axis">${row * 16}–${row * 16 + 15}</div>`;
    for (let col = 0; col < 16; col += 1) {
      const last = row * 16 + col;
      const address = sheet.start + last;
      const ip = intToIpv4(address);
      const host = hosts.get(ip);
      const prefix = mostSpecific(address);
      const system = last === 0 || last === 255;
      grid += `<div class="ip-cell ${host ? "recorded" : ""} ${system ? "system" : ""}" data-ip="${ip}" style="--cell-color:${prefix?.color || "#eef1f6"};--host-color:${HOST_COLORS[host?.status] || "#3157d5"}" title="${escapeHtml(host?.name || ip)}"><i class="fill"></i><button class="ping-dot ${pingClass(ip, system, pings)}" data-ip="${ip}" title="ابزارهای اتصال"></button><span class="last">${last}</span>${host ? `<div class="host-name">${escapeHtml(host.name || host.type || STATUS_LABELS[host.status])}</div>` : system ? `<div class="host-name">${last === 0 ? "Network" : "Broadcast"}</div>` : ""}</div>`;
    }
    grid += `</div>`;
  }
  return grid + `</div>`;
}

function renderSubnetMap(sheet) {
  const exactPrefixes = new Map(state.data.prefixes.map((item) => [item.cidr, item]));
  const hosts = hostMap();
  let html = `<div class="subnet-map" dir="ltr">`;
  const ipCells = Array.from({ length: 256 }, (_, last) => {
    const ip = intToIpv4(sheet.start + last);
    const host = hosts.get(ip);
    return `<button class="map-cell map-ip-cell ${host ? "recorded" : ""}" data-ip="${ip}" style="grid-column:${last + 2}" title="${escapeHtml(host?.name || ip)}"><b>${last}</b>${host?.name ? `<small>${escapeHtml(host.name)}</small>` : ""}</button>`;
  }).join("");
  html += `<div class="subnet-map-row"><strong>/32</strong>${ipCells}</div>`;
  for (const prefix of [30, 29, 28, 27, 26, 25, 24]) {
    const size = 2 ** (32 - prefix);
    let cells = "";
    for (let offset = 0; offset < 256; offset += size) {
      const cidr = `${intToIpv4(sheet.start + offset)}/${prefix}`;
      const item = exactPrefixes.get(cidr);
      cells += `<button class="map-cell map-prefix-cell ${item ? "named" : ""}" data-cidr="${cidr}" style="grid-column:${offset + 2}/span ${size};--range-color:${item?.color || "#f2f4f8"}" title="${escapeHtml(item?.name || cidr)}"><b>${offset}${size > 1 ? `–${offset + size - 1}` : ""}</b>${item?.name ? `<small>${escapeHtml(item.name)}</small>` : ""}</button>`;
    }
    html += `<div class="subnet-map-row"><strong>/${prefix}</strong>${cells}</div>`;
  }
  return html + `</div>`;
}

function renderSheet() {
  const selected = parseCidr(state.sheetCidr);
  const space = state.data.space;
  const root = parseCidr(space.cidr);
  if (!selected || selected.prefix > 24 || !contains(root, selected)) { state.view = "overview"; renderOverview(); return; }
  const blockCount = selected.size / 256;
  const hosts = hostMap();
  const pings = pingMap();
  const relevant = prefixesIn(selected.start, selected.end);
  const hostCount = [...hosts.keys()].filter((ip) => contains(selected, ip)).length;
  const onlineCount = [...pings.values()].filter((item) => contains(selected, item.ip) && item.online).length;
  const blocks = Array.from({ length: blockCount }, (_, index) => {
    const sheet = parseCidr(`${intToIpv4(selected.start + index * 256)}/24`);
    const content = state.displayMode === "map" ? renderSubnetMap(sheet) : renderIpGrid(sheet);
    return `<section class="panel detail-block"><div class="section-title"><div><h3 class="ltr mono">${escapeHtml(sheet.cidr)}</h3><span class="subtitle">IP 0–255</span></div>${canWrite() ? `<button class="btn sm edit-exact-prefix" data-cidr="${escapeHtml(sheet.cidr)}">ثبت / ویرایش مشخصات /24</button>` : ""}</div><div class="ip-wrap">${content}</div></section>`;
  }).join("");
  const selectionIndex = Math.floor((selected.start - root.start) / selected.size);
  const selectionCount = Math.floor(root.size / selected.size);
  const options = Array.from({ length: selectionCount }, (_, index) => {
    const cidr = `${intToIpv4(root.start + index * selected.size)}/${selected.prefix}`;
    return `<option value="${cidr}" ${cidr === selected.cidr ? "selected" : ""}>${cidr}</option>`;
  }).join("");
  const rangeRows = relevant.sort((a, b) => prefixInfo(a).start - prefixInfo(b).start || prefixInfo(a).prefix - prefixInfo(b).prefix).map((item) => `<div class="range-row"><i class="swatch" style="background:${escapeHtml(item.color)}"></i><div><div class="range-name">${escapeHtml(item.name)}</div><small class="ltr mono">${escapeHtml(item.cidr)}</small></div><small>${formatNumber(prefixInfo(item).size)} آدرس</small><span class="status-pill">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span><div class="row-actions">${canWrite() ? `<button class="btn sm edit-prefix" data-id="${escapeHtml(item.id)}">ویرایش</button><button class="btn sm danger quick-delete-prefix" data-id="${escapeHtml(item.id)}">حذف</button>` : ""}</div></div>`).join("");
  const sheetColor = relevant[0]?.color || space.color;
  const usable = blockCount * 254;
  page.innerHTML = `<section class="sheet-banner" style="--sheet-color:${escapeHtml(sheetColor)}"><div class="sheet-color"></div><div class="sheet-main"><div class="sheet-title"><button id="overviewBack" class="back">← نمای رنج اصلی</button><div><div class="subtitle">رنج انتخاب‌شده</div><h2 class="ltr mono">${escapeHtml(selected.cidr)}</h2><p>${escapeHtml(space.companyName)} ← ${escapeHtml(space.name)} — ${formatNumber(blockCount)} جدول /24</p></div></div><div class="util"><div><b>${formatNumber(hostCount)}</b><div class="subtitle">IP ثبت‌شده</div></div><div class="ring" style="--p:${Math.round(hostCount / Math.max(1, usable) * 100)}" data-value="${formatNumber(Math.round(hostCount / Math.max(1, usable) * 100))}٪"></div></div><div class="sheet-nav"><button class="btn sm" id="prevSheet" ${selectionIndex <= 0 ? "disabled" : ""}>قبلی</button><select id="sheetSelect">${options}</select><button class="btn sm" id="nextSheet" ${selectionIndex >= selectionCount - 1 ? "disabled" : ""}>بعدی</button></div></div></section>
    <section class="panel view-controls"><div class="toolbar"><div class="toolgroup"><b>حالت نمایش</b><div class="segmented"><button class="display-mode ${state.displayMode === "grid" ? "active" : ""}" data-mode="grid">IP Grid</button><button class="display-mode ${state.displayMode === "map" ? "active" : ""}" data-mode="map">Subnet Map</button></div>${canWrite() && selected.prefix === 24 ? `<button class="btn" id="scanButton" ${state.scanning ? "disabled" : ""}>${state.scanning ? "در حال پینگ…" : "پینگ مجدد"}</button>` : ""}</div><span class="mode-note">در Subnet Map هر خانه مستقیماً قابل انتخاب است؛ /30 شامل ۴ IP است.</span></div></section>
    <div class="detail-stack">${blocks}</div>
    <div class="lower-grid"><section class="panel"><div class="section-title"><h3>رنج‌های مرتبط</h3><span class="subtitle">${formatNumber(relevant.length)} رنج</span></div><div class="range-list">${rangeRows || `<div class="empty-state">برای این محدوده رنجی تعریف نشده است.</div>`}</div></section><section class="panel"><div class="section-title"><h3>خلاصه</h3></div><div class="summary-list"><div class="summary-item"><span>تعداد جدول /24</span><b>${formatNumber(blockCount)}</b></div><div class="summary-item"><span>IP ثبت‌شده</span><b>${formatNumber(hostCount)}</b></div><div class="summary-item"><span>پاسخ پینگ</span><b>${formatNumber(onlineCount)}</b></div><div class="summary-item"><span>رنج مرتبط</span><b>${formatNumber(relevant.length)}</b></div></div></section></div>`;
  $("overviewBack").addEventListener("click", () => { state.view = "overview"; state.paint = false; renderOverview(); });
  $("prevSheet").addEventListener("click", () => { if (selectionIndex > 0) { state.sheetCidr = `${intToIpv4(root.start + (selectionIndex - 1) * selected.size)}/${selected.prefix}`; renderSheet(); } });
  $("nextSheet").addEventListener("click", () => { if (selectionIndex < selectionCount - 1) { state.sheetCidr = `${intToIpv4(root.start + (selectionIndex + 1) * selected.size)}/${selected.prefix}`; renderSheet(); } });
  $("sheetSelect").addEventListener("change", (event) => { state.sheetCidr = event.target.value; renderSheet(); });
  $("scanButton")?.addEventListener("click", runPing);
  page.querySelectorAll(".display-mode").forEach((node) => node.addEventListener("click", () => { state.displayMode = node.dataset.mode; renderSheet(); }));
  page.querySelectorAll(".ip-cell").forEach((node) => node.addEventListener("click", (event) => {
    if (event.target.closest(".ping-dot")) return;
    openHostDialog(node.dataset.ip);
  }));
  page.querySelectorAll(".map-ip-cell").forEach((node) => node.addEventListener("click", () => openHostDialog(node.dataset.ip)));
  page.querySelectorAll(".map-prefix-cell,.edit-exact-prefix").forEach((node) => node.addEventListener("click", () => openPrefixDialog(node.dataset.cidr)));
  page.querySelectorAll(".ping-dot:not(.system)").forEach((node) => node.addEventListener("click", (event) => { event.stopPropagation(); openToolMenu(event, node.dataset.ip); }));
  attachPrefixEditHandlers();
  attachPrefixDeleteHandlers();
}

async function runPing() {
  state.scanning = true; renderSheet();
  try {
    const result = await request("/api/ping", { method: "POST", body: { spaceId: state.currentSpaceId, cidr: state.sheetCidr } });
    state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`);
    toast(`${formatNumber(result.online)} IP پاسخ داد.`);
  } catch (error) { toast(error.message); }
  finally { state.scanning = false; renderSheet(); }
}

function openCompanyDialog(id = null) {
  const item = id ? state.bootstrap.companies.find((entry) => entry.id === id) : null;
  $("companyForm").reset();
  $("companyId").value = item?.id || "";
  $("companyName").value = item?.name || "";
  $("companyDescription").value = item?.description || "";
  $("companyDialogTitle").textContent = item ? "ویرایش شرکت" : "افزودن شرکت";
  $("deleteCompanyButton").classList.toggle("hidden", !item);
  $("companyDialog").showModal();
}

function openSpaceDialog(companyId, id = null) {
  const item = id ? state.bootstrap.spaces.find((entry) => entry.id === id) : null;
  $("spaceForm").reset();
  $("spaceId").value = item?.id || "";
  $("spaceName").value = item?.name || "";
  $("spaceCidr").value = item?.cidr || "";
  $("spaceColor").value = item?.color || COLORS[(state.bootstrap.spaces.length + 1) % COLORS.length];
  $("spaceDescription").value = item?.description || "";
  $("spaceForm").dataset.company = item?.companyId || companyId;
  $("spaceDialogTitle").textContent = item ? "ویرایش رنج اصلی" : "افزودن رنج اصلی";
  $("deleteSpaceButton").classList.toggle("hidden", !item);
  $("spaceDialog").showModal();
}

async function deleteCompany(id) {
  const item = state.bootstrap.companies.find((entry) => entry.id === id);
  if (!item || !confirm(`شرکت «${item.name}» و همه رنج‌ها و اطلاعات وابسته حذف شود؟`)) return;
  try {
    await request(`/api/companies/${encodeURIComponent(id)}`, { method: "DELETE" });
    $("companyDialog").close(); state.bootstrap = await request("/api/bootstrap");
    state.currentCompanyId = state.bootstrap.companies[0]?.id || null; renderCompanies(); toast("شرکت حذف شد.");
  } catch (error) { toast(error.message); }
}

async function deleteSpace(id) {
  const item = state.bootstrap.spaces.find((entry) => entry.id === id);
  if (!item || !confirm(`رنج اصلی ${item.cidr} و همه اطلاعات وابسته حذف شود؟`)) return;
  try {
    await request(`/api/spaces/${encodeURIComponent(id)}`, { method: "DELETE" });
    $("spaceDialog").close(); state.bootstrap = await request("/api/bootstrap"); state.currentSpaceId = null;
    renderCompanies(); toast("رنج اصلی حذف شد.");
  } catch (error) { toast(error.message); }
}

function openPrefixDialog(cidr, id = null) {
  const item = id ? state.data.prefixes.find((entry) => entry.id === id) : state.data.prefixes.find((entry) => entry.cidr === cidr) || null;
  const value = item || { id: "", cidr, name: "", status: "active", role: "", vlan: "", gateway: "", color: COLORS[state.data.prefixes.length % COLORS.length], description: "" };
  if (!value.cidr) return;
  $("prefixDialogTitle").textContent = item ? "ویرایش رنج" : "ثبت و رنگ‌کردن رنج";
  $("prefixCidrTitle").textContent = value.cidr;
  for (const [key, field] of [["id", "prefixId"], ["cidr", "prefixCidr"], ["name", "prefixName"], ["status", "prefixStatus"], ["role", "prefixRole"], ["vlan", "prefixVlan"], ["gateway", "prefixGateway"], ["color", "prefixColor"], ["description", "prefixDescription"]]) $(field).value = value[key] || "";
  $("deletePrefixButton").classList.toggle("hidden", !item || !canWrite());
  setFormWritable($("prefixForm"), canWrite());
  $("prefixDialog").showModal();
}

function setFormWritable(form, writable) {
  form.querySelectorAll("input:not([type=hidden]),select,textarea").forEach((node) => { node.disabled = !writable; });
  form.querySelector("button[type=submit]")?.classList.toggle("hidden", !writable);
}

function renderHostPorts(host = {}) {
  $("hostPorts").innerHTML = state.bootstrap.tools.map((tool) => {
    const override = Object.prototype.hasOwnProperty.call(host.ports || {}, tool.tool) ? host.ports[tool.tool] : "";
    const fallback = tool.defaultPort === 0 ? "بدون پورت اختصاصی" : `پیش‌فرض ${tool.defaultPort}`;
    return `<label class="port-item"><span style="color:${escapeHtml(tool.color)}">${escapeHtml(tool.tool)}</span><input class="host-port" data-tool="${escapeHtml(tool.tool)}" type="number" min="0" max="65535" value="${escapeHtml(override)}" placeholder="${escapeHtml(tool.defaultPort)}"><small>${escapeHtml(fallback)}</small></label>`;
  }).join("");
}

function openHostDialog(ip) {
  const item = state.data.hosts.find((entry) => entry.ip === ip) || null;
  const value = item || { id: "", ip, name: "", status: "active", type: "", os: "", mac: "", vlan: "", username: "", owner: "", location: "", secretRef: "", notes: "", ports: {} };
  $("hostIpTitle").textContent = ip;
  for (const [key, field] of [["id", "hostId"], ["ip", "hostIp"], ["name", "hostName"], ["status", "hostStatus"], ["type", "hostType"], ["os", "hostOs"], ["mac", "hostMac"], ["vlan", "hostVlan"], ["username", "hostUsername"], ["owner", "hostOwner"], ["location", "hostLocation"], ["secretRef", "hostSecretRef"], ["notes", "hostNotes"]]) $(field).value = value[key] || "";
  $("hostPassword").value = "";
  $("hostPassword").type = "password";
  $("clearHostPassword").checked = false;
  $("revealHostPassword").classList.toggle("hidden", !item?.hasPassword || !canWrite());
  $("clearHostPasswordWrap").classList.toggle("hidden", !item?.hasPassword || !canWrite());
  renderHostPorts(value);
  $("deleteHostButton").classList.toggle("hidden", !item || !canWrite());
  setFormWritable($("hostForm"), canWrite());
  $("hostDialog").showModal();
}

function openToolMenu(event, ip) {
  const host = state.data.hosts.find((item) => item.ip === ip) || { ports: {} };
  const menu = $("toolMenu");
  menu.innerHTML = `<div class="tool-menu-title">${escapeHtml(ip)} — انتخاب ابزار</div><div class="tool-buttons">${state.bootstrap.tools.map((tool) => {
    const port = Object.prototype.hasOwnProperty.call(host.ports || {}, tool.tool) ? host.ports[tool.tool] : tool.defaultPort;
    return `<button class="tool-square" data-tool="${escapeHtml(tool.tool)}" data-port="${escapeHtml(port)}" style="background:${escapeHtml(tool.color)}">${escapeHtml(tool.tool)}<small>${port ? `:${port}` : "پیش‌فرض"}</small></button>`;
  }).join("")}</div>`;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 265)}px`;
  menu.style.top = `${Math.min(event.clientY + 10, window.innerHeight - 90)}px`;
  menu.classList.remove("hidden");
  menu.querySelectorAll(".tool-square").forEach((node) => node.addEventListener("click", () => {
    const url = new URL("emsipam://open");
    url.searchParams.set("tool", node.dataset.tool);
    url.searchParams.set("host", ip);
    url.searchParams.set("port", node.dataset.port || "0");
    window.location.href = url.toString();
    menu.classList.add("hidden");
  }));
}

function doSearch(query) {
  const resultsNode = $("searchResults");
  const value = String(query || "").trim().toLowerCase();
  if (!value || !state.data) { resultsNode.classList.add("hidden"); return; }
  const results = [];
  for (const host of state.data.hosts) {
    const text = [host.ip, host.name, host.mac, host.username, host.owner, host.location, host.os, host.type].join(" ").toLowerCase();
    if (text.includes(value)) results.push({ type: "host", id: host.ip, title: host.name || host.ip, detail: host.ip });
  }
  for (const prefix of state.data.prefixes) {
    const text = [prefix.cidr, prefix.name, prefix.role, prefix.vlan, prefix.description].join(" ").toLowerCase();
    if (text.includes(value)) results.push({ type: "prefix", id: prefix.id, title: prefix.name || prefix.cidr, detail: prefix.cidr });
  }
  resultsNode.innerHTML = results.slice(0, 20).map((item) => `<div class="search-item" data-type="${item.type}" data-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail)}</small></div>`).join("") || `<div class="empty-state">نتیجه‌ای پیدا نشد.</div>`;
  resultsNode.classList.remove("hidden");
  resultsNode.querySelectorAll(".search-item").forEach((node) => node.addEventListener("click", () => {
    resultsNode.classList.add("hidden");
    if (node.dataset.type === "host") {
      const address = ipv4ToInt(node.dataset.id); state.view = "sheet"; state.sheetCidr = `${intToIpv4(address & 0xffffff00)}/24`; renderSheet(); openHostDialog(node.dataset.id);
    } else openPrefixDialog(null, node.dataset.id);
  }));
}

async function openUsersDialog() {
  resetUserForm();
  renderCompanyAccess();
  $("usersDialog").showModal();
  await refreshUsers();
}

function renderCompanyAccess(selected = []) {
  $("companyAccessList").innerHTML = state.bootstrap.companies.map((company) => `<label><input type="checkbox" value="${escapeHtml(company.id)}" ${selected.includes(company.id) ? "checked" : ""}>${escapeHtml(company.name)}</label>`).join("");
  $("companyAccessField").classList.toggle("hidden", $("userRole").value === "admin");
}

async function refreshUsers() {
  const result = await request("/api/users");
  $("usersList").innerHTML = result.users.map((user) => `<div class="user-row"><div><b>${escapeHtml(user.displayName || user.username)}</b><small>${escapeHtml(user.username)}</small></div><span class="status-pill">${user.role === "admin" ? "مدیر" : user.role === "editor" ? "ویرایشگر" : "مشاهده‌گر"}</span><div class="row-actions"><button class="btn sm edit-user" data-id="${escapeHtml(user.id)}">ویرایش</button><button class="btn sm danger delete-user" data-id="${escapeHtml(user.id)}">حذف</button></div></div>`).join("");
  $("usersList").querySelectorAll(".edit-user").forEach((node) => node.addEventListener("click", () => editUser(result.users.find((item) => item.id === node.dataset.id))));
  $("usersList").querySelectorAll(".delete-user").forEach((node) => node.addEventListener("click", async () => {
    const account = result.users.find((item) => item.id === node.dataset.id);
    if (!account || !confirm(`کاربر «${account.username}» حذف شود؟`)) return;
    try { await request(`/api/users/${encodeURIComponent(account.id)}`, { method: "DELETE" }); resetUserForm(); await refreshUsers(); toast("کاربر حذف شد."); }
    catch (error) { toast(error.message); }
  }));
}

function resetUserForm() {
  $("userForm").reset(); $("userId").value = ""; $("userUsername").disabled = false; $("userFormTitle").textContent = "کاربر جدید"; $("passwordHint").textContent = "حداقل ۸ کاراکتر"; $("userActiveWrap").classList.add("hidden"); $("cancelUserEdit").classList.add("hidden"); renderCompanyAccess();
}

function editUser(user) {
  $("userId").value = user.id; $("userUsername").value = user.username; $("userUsername").disabled = true; $("userDisplayName").value = user.displayName || ""; $("userPassword").value = ""; $("userRole").value = user.role; $("userActive").checked = user.active; $("userFormTitle").textContent = "ویرایش کاربر"; $("passwordHint").textContent = "برای حفظ رمز فعلی خالی بماند"; $("userActiveWrap").classList.remove("hidden"); $("cancelUserEdit").classList.remove("hidden"); renderCompanyAccess(user.companyIds || []);
}

function openSettingsDialog() {
  $("toolsSettings").innerHTML = state.bootstrap.tools.map((tool) => `<div class="tool-setting" data-tool="${escapeHtml(tool.tool)}"><b style="color:${escapeHtml(tool.color)}">${escapeHtml(tool.tool)}</b><input class="tool-label" value="${escapeHtml(tool.label)}"><input class="tool-port" type="number" min="0" max="65535" value="${escapeHtml(tool.defaultPort)}"><input class="tool-color" type="color" value="${escapeHtml(tool.color)}"></div>`).join("");
  $("settingsDialog").showModal();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#toolMenu") && !event.target.closest(".ping-dot")) $("toolMenu").classList.add("hidden");
  if (!event.target.closest(".searchbox")) $("searchResults").classList.add("hidden");
});

document.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => node.closest("dialog").close()));

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("loginError").classList.add("hidden");
  try {
    await request("/api/auth/login", { method: "POST", body: { username: $("loginUsername").value, password: $("loginPassword").value } });
    $("loginPassword").value = ""; await boot();
  } catch (error) { $("loginError").textContent = error.message; $("loginError").classList.remove("hidden"); }
});

$("logoutButton").addEventListener("click", async () => { await request("/api/auth/logout", { method: "POST" }); state.events?.close(); state.bootstrap = null; state.data = null; setLoginVisible(true); });
$("homeButton").addEventListener("click", renderCompanies);
$("companySelect").addEventListener("change", (event) => { state.currentCompanyId = event.target.value; localStorage.setItem("ems-company", state.currentCompanyId); renderCompanies(); });
$("spaceSelect").addEventListener("change", (event) => event.target.value ? loadSpace(event.target.value) : renderCompanies());
$("searchInput").addEventListener("input", (event) => doSearch(event.target.value));
$("usersButton").addEventListener("click", openUsersDialog);
$("settingsButton").addEventListener("click", openSettingsDialog);
$("exportButton").addEventListener("click", () => state.currentSpaceId ? window.location.assign(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/export`) : toast("ابتدا یک رنج اصلی را باز کنید."));

$("companyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("companyId").value;
  try { const result = await request(id ? `/api/companies/${encodeURIComponent(id)}` : "/api/companies", { method: id ? "PUT" : "POST", body: { name: $("companyName").value, description: $("companyDescription").value } }); $("companyDialog").close(); state.bootstrap = await request("/api/bootstrap"); state.currentCompanyId = id || result.id; updateSelectors(); renderCompanies(); toast(id ? "شرکت ویرایش شد." : "شرکت اضافه شد."); } catch (error) { toast(error.message); }
});

$("deleteCompanyButton").addEventListener("click", () => deleteCompany($("companyId").value));

$("spaceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("spaceId").value;
  try { const result = await request(id ? `/api/spaces/${encodeURIComponent(id)}` : "/api/spaces", { method: id ? "PUT" : "POST", body: { companyId: event.currentTarget.dataset.company, name: $("spaceName").value, cidr: $("spaceCidr").value, color: $("spaceColor").value, description: $("spaceDescription").value } }); $("spaceDialog").close(); state.bootstrap = await request("/api/bootstrap"); await loadSpace(id || result.id); toast(id ? "رنج اصلی ویرایش شد." : "رنج اصلی اضافه شد."); } catch (error) { toast(error.message); }
});

$("deleteSpaceButton").addEventListener("click", () => deleteSpace($("spaceId").value));

$("prefixForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await request("/api/prefixes", { method: "POST", body: { id: $("prefixId").value || undefined, spaceId: state.currentSpaceId, cidr: $("prefixCidr").value, name: $("prefixName").value, status: $("prefixStatus").value, role: $("prefixRole").value, vlan: $("prefixVlan").value, gateway: $("prefixGateway").value, color: $("prefixColor").value, description: $("prefixDescription").value } }); $("prefixDialog").close(); state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`); state.selectedCidr = null; renderCurrent(); toast("رنج ذخیره شد."); } catch (error) { toast(error.message); }
});

$("deletePrefixButton").addEventListener("click", async () => {
  if (!confirm("این رنج حذف شود؟ اطلاعات جداگانهٔ IPها حذف نمی‌شود.")) return;
  try { await request(`/api/prefixes/${encodeURIComponent($("prefixId").value)}`, { method: "DELETE" }); $("prefixDialog").close(); state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`); renderCurrent(); toast("رنج حذف شد."); } catch (error) { toast(error.message); }
});

$("hostForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ports = {};
  $("hostPorts").querySelectorAll(".host-port").forEach((node) => { if (node.value !== "") ports[node.dataset.tool] = Number(node.value); });
  try { await request("/api/hosts", { method: "PUT", body: { id: $("hostId").value || undefined, spaceId: state.currentSpaceId, ip: $("hostIp").value, name: $("hostName").value, status: $("hostStatus").value, type: $("hostType").value, os: $("hostOs").value, mac: $("hostMac").value, vlan: $("hostVlan").value, username: $("hostUsername").value, password: $("hostPassword").value, clearPassword: $("clearHostPassword").checked, owner: $("hostOwner").value, location: $("hostLocation").value, secretRef: $("hostSecretRef").value, notes: $("hostNotes").value, ports } }); $("hostDialog").close(); state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`); renderCurrent(); toast("اطلاعات IP ذخیره شد."); } catch (error) { toast(error.message); }
});

$("revealHostPassword").addEventListener("click", async () => {
  try {
    const result = await request(`/api/hosts/${encodeURIComponent(state.currentSpaceId)}/${encodeURIComponent($("hostIp").value)}/secret`);
    $("hostPassword").value = result.password || ""; $("hostPassword").type = "text";
    setTimeout(() => { $("hostPassword").type = "password"; }, 10000);
  } catch (error) { toast(error.message); }
});

$("deleteHostButton").addEventListener("click", async () => {
  if (!confirm("اطلاعات این IP حذف شود؟")) return;
  try { await request(`/api/hosts/${encodeURIComponent(state.currentSpaceId)}/${encodeURIComponent($("hostIp").value)}`, { method: "DELETE" }); $("hostDialog").close(); state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`); renderCurrent(); toast("اطلاعات IP حذف شد."); } catch (error) { toast(error.message); }
});

$("userRole").addEventListener("change", () => renderCompanyAccess([...$("companyAccessList").querySelectorAll("input:checked")].map((node) => node.value)));
$("cancelUserEdit").addEventListener("click", resetUserForm);
$("userForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("userId").value; const companyIds = [...$("companyAccessList").querySelectorAll("input:checked")].map((node) => node.value);
  const body = { username: $("userUsername").value, displayName: $("userDisplayName").value, password: $("userPassword").value, role: $("userRole").value, active: $("userActive").checked, companyIds };
  try { await request(id ? `/api/users/${encodeURIComponent(id)}` : "/api/users", { method: id ? "PUT" : "POST", body }); resetUserForm(); await refreshUsers(); toast("کاربر ذخیره شد."); } catch (error) { toast(error.message); }
});

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const tools = [...$("toolsSettings").querySelectorAll(".tool-setting")].map((node) => ({ tool: node.dataset.tool, label: node.querySelector(".tool-label").value, defaultPort: Number(node.querySelector(".tool-port").value), color: node.querySelector(".tool-color").value }));
  try { await request("/api/tools", { method: "PUT", body: { tools } }); $("settingsDialog").close(); state.bootstrap = await request("/api/bootstrap"); toast("تنظیمات ابزارها ذخیره شد."); } catch (error) { toast(error.message); }
});

boot();

export { contains, intToIpv4, ipv4ToInt, networkAt, parseCidr };
