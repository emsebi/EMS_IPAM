import { DETAIL_PREFIXES, detailGroupSize, rootVerticalLevels, tableBlockCount, treeDepth, visibleTableCount } from "./subnet-model.mjs?v=1.4.0-stage1";

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
  displayMode: localStorage.getItem("ems-display-mode") || "table",
  overviewMode: localStorage.getItem("ems-overview-mode") || "table",
  radioViewMode: localStorage.getItem("ems-radio-view-mode") || "tree",
  drillPrefix: 24,
  paint: false,
  paintPrefix: 24,
  selectedCidr: null,
  scanning: false,
  events: null,
  reloadTimer: null,
  searchTimer: null,
  searchItems: [],
  searchIndex: -1,
  inventory: [],
  maps: [],
  currentMapId: null,
  mapData: null,
  linkSelection: [],
  treeFocusCidr: null,
  tableScopeCidr: null,
  tableVisibleBlocks: 8,
  companyData: null,
  importPackage: null,
  inventoryQuery: "",
  inventoryType: "",
  routeBusy: false,
};

const $ = (id) => document.getElementById(id);
const page = $("page");

const savedTheme = localStorage.getItem("ems-theme") || "light";
document.documentElement.dataset.theme = savedTheme;
const nativeShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function showCleanDialog() {
  this.querySelectorAll("form").forEach((form) => markFormClean(form));
  return nativeShowModal.call(this);
};

function markFormClean(form) {
  if (form) form.dataset.dirty = "";
}

function navActive(name) {
  document.querySelectorAll(".navbtn").forEach((node) => node.classList.toggle("active", node.id === `${name}Button`));
}

function setRoute(path, replace = false) {
  const hash = `#${path}`;
  if (location.hash === hash) return;
  history[replace ? "replaceState" : "pushState"]({}, "", hash);
}

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

function defaultGatewayForCidr(cidr) {
  const parsed = parseCidr(cidr);
  if (!parsed || parsed.prefix >= 32) return "";
  return intToIpv4(parsed.prefix === 31 ? parsed.start : parsed.start + 1);
}

function normalizedConnectionMethods(host = {}, configured = null) {
  const hasConfiguredList = Array.isArray(configured) || Array.isArray(host.connectionMethods);
  const methods = Array.isArray(configured) ? configured : Array.isArray(host.connectionMethods) ? host.connectionMethods : [];
  if (hasConfiguredList) return methods.map((item) => ({ ...item, type: String(item.type || "").toUpperCase().replace("WINBOX", "MIK") })).filter((item) => item.type);
  return Object.entries(host.ports || {}).filter(([, port]) => port !== "" && port !== null && port !== undefined).map(([type, port]) => ({ type: String(type).toUpperCase().replace("WINBOX", "MIK"), port }));
}

function hostConnectionLabel(host = {}) {
  return normalizedConnectionMethods(host).map((item) => item.type).join(" · ");
}

function canWrite() {
  return state.bootstrap?.user.role === "admin";
}

function isAdmin() {
  return state.bootstrap?.user.role === "admin";
}

function hasClientModule(id) {
  return isAdmin() || (state.bootstrap?.moduleIds || state.bootstrap?.user?.moduleIds || []).includes(id);
}

function canManageCompany(companyId) {
  return isAdmin() || (canWrite() && (state.bootstrap?.fullCompanyIds || []).includes(companyId));
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

function existingPrefixAt(address) {
  return mostSpecific(address);
}

function roleLabel(role) {
  return role === "admin" ? "Administrator" : role === "support" ? "Support" : role === "helpdesk" ? "Helpdesk" : "Viewer";
}

function renderModuleNavigation() {
  const host = $("moduleNavigation");
  if (!host) return;
  const role = state.bootstrap?.user?.role || "viewer";
  const modules = Array.isArray(state.bootstrap?.modules) ? state.bootstrap.modules : [];
  host.innerHTML = modules
    .filter((item) => !Array.isArray(item.permissions) || !item.permissions.length || item.permissions.includes(role))
    .sort((a, b) => Number(a.navigation?.order || 100) - Number(b.navigation?.order || 100))
    .map((item) => { const path = item.navigation?.path || `/m/${item.id}/`; const label = item.navigation?.label || item.name || item.id; const icon = item.navigation?.icon || "◫"; return `<a class="navbtn module-nav-link" href="${escapeHtml(path)}"><span class="nav-icon">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span><span class="module-badge">${escapeHtml(item.version || "")}</span></a>`; }).join("");
}

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("ems-theme", selected);
  $("themeButton").textContent = selected === "dark" ? "☀" : "☾";
  if ($("appearanceTheme")) $("appearanceTheme").value = selected;
  return selected;
}

function toggleTheme() {
  return applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
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
      ? savedCompany : "";
    updateSelectors();
    await renderRoute(true);
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
  $("networkMapButton")?.classList.toggle("hidden", true);
  $("topologyButton")?.classList.toggle("hidden", true);
  $("companiesButton")?.classList.toggle("hidden", !hasClientModule("ipam"));
  $("ipamButton")?.classList.toggle("hidden", !hasClientModule("ipam"));
  $("inventoryButton")?.classList.toggle("hidden", !hasClientModule("inventory"));
  const user = state.bootstrap?.user || {};
  if ($("loggedInUserName")) $("loggedInUserName").textContent = user.displayName || user.username || "User";
  if ($("userRoleName")) $("userRoleName").textContent = roleLabel(user.role);
  if ($("sidebarVersion")) $("sidebarVersion").textContent = `v${state.bootstrap?.version || ""}`;
  if ($("settingsVersion")) $("settingsVersion").textContent = state.bootstrap?.version || "";
  if ($("userMenuButton")?.querySelector(".avatar")) $("userMenuButton").querySelector(".avatar").textContent = String(user.displayName || user.username || "A").trim().charAt(0).toUpperCase() || "A";
  renderModuleNavigation();
}

function updateSelectors() {
  const companies = state.bootstrap?.companies || [];
  $("companySelect").innerHTML = `<option value="">همه شرکت‌ها</option>${companies.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
  $("companySelect").value = state.currentCompanyId || "";
  const spaces = (state.bootstrap?.spaces || []).filter((item) => item.companyId === state.currentCompanyId);
  $("spaceSelect").innerHTML = `<option value="">نمای شرکت</option>${spaces.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.cidr)} — ${escapeHtml(item.name)}</option>`).join("")}`;
  $("spaceSelect").value = state.currentSpaceId || "";
}

async function renderRoute(replace = false) {
  if (state.routeBusy || !state.bootstrap) return;
  state.routeBusy = true;
  try {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (!parts.length) {
      setRoute("/companies", true);
      renderCompanies({ keepRoute: true });
    } else if (parts[0] === "company" && parts[1]) await openCompanyPage(parts[1], { fromRoute: true });
    else if (parts[0] === "ipam" && parts[1]) await loadSpace(parts[1], { sheetCidr: parts[2] || null, fromRoute: true });
    else if (parts[0] === "inventory") await openInventoryPage(true, { fromRoute: true });
    else if (parts[0] === "radios") await openRadiosPage(true, { fromRoute: true });
    else if (parts[0] === "topology") await openTopologyPage(true, { fromRoute: true });
    else {
      setRoute("/companies", replace);
      renderCompanies({ keepRoute: true });
    }
  } finally { state.routeBusy = false; }
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
        } else if (state.view === "topology" && change.type === "topology") await openTopologyPage(true);
        else if (state.view === "radios" && change.type === "host") await openRadiosPage(true);
        else if (state.view === "inventory" && change.type === "host") await openInventoryPage(true, { fromRoute: true });
        else if (state.view === "company" && state.currentCompanyId) await openCompanyPage(state.currentCompanyId, { fromRoute: true });
        else if (state.view === "companies") renderCompanies();
      } catch (error) { console.warn(error); }
    }, 250);
  });
}

async function loadSpace(spaceId, { sheetCidr = null, fromRoute = false } = {}) {
  state.currentSpaceId = spaceId;
  const space = state.bootstrap.spaces.find((item) => item.id === spaceId);
  if (!space) return;
  state.currentCompanyId = space.companyId;
  state.data = await request(`/api/spaces/${encodeURIComponent(spaceId)}/data`);
  state.view = sheetCidr ? "sheet" : "overview";
  state.sheetCidr = sheetCidr;
  state.paint = false;
  state.selectedCidr = null;
  state.companyData = null;
  localStorage.setItem("ems-company", state.currentCompanyId);
  updateSelectors();
  navActive("ipam");
  if (!fromRoute) setRoute(`/ipam/${encodeURIComponent(spaceId)}${sheetCidr ? `/${encodeURIComponent(sheetCidr)}` : ""}`);
  renderCurrent();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrent() {
  if (state.view === "sheet") renderSheet();
  else if (state.view === "overview") renderOverview();
  else if (state.view === "radios") renderRadios();
  else if (state.view === "inventory") renderInventory();
  else if (state.view === "topology") renderTopology();
  else if (state.view === "company" && state.currentCompanyId) openCompanyPage(state.currentCompanyId, { fromRoute: true }).catch((error) => toast(error.message));
  else renderCompanies();
}

function renderCompanies({ keepRoute = false } = {}) {
  state.view = "companies";
  state.currentSpaceId = null;
  state.data = null;
  state.companyData = null;
  navActive("companies");
  if (!keepRoute) setRoute("/companies");
  updateSelectors();
  const companies = state.bootstrap?.companies || [];
  const cards = companies.map((company) => {
    const spaces = state.bootstrap.spaces.filter((item) => item.companyId === company.id);
    const parent = companies.find((item) => item.id === company.parentCompanyId);
    const kind = { company: "شرکت", branch: "شعبه", customer: "مشتری", site: "سایت" }[company.kind] || "شرکت";
    return `<article class="company-card">
      <div class="company-card-head"><div><span class="company-tree-badge">${escapeHtml(kind)}${parent ? ` زیرمجموعه ${escapeHtml(parent.name)}` : ""}</span><h3>${escapeHtml(company.name)}</h3><p>${escapeHtml(company.description || company.address || "بدون توضیح")}</p></div></div>
      <div class="company-card-meta"><span>مدیر<b>${escapeHtml(company.managerName || "ثبت نشده")}</b></span><span>شماره تماس<b class="ltr">${escapeHtml(company.phone || "—")}</b></span><span>رنج اصلی<b>${formatNumber(spaces.length)}</b></span><span>افراد تماس<b>${formatNumber(company.contactCount || 0)}</b></span></div>
      <div class="entity-actions"><button class="btn primary open-company" data-company="${escapeHtml(company.id)}">مشاهده شرکت</button>${canManageCompany(company.id) ? `<button class="btn edit-company" data-company="${escapeHtml(company.id)}">ویرایش</button><button class="btn add-space" data-company="${escapeHtml(company.id)}">افزودن رنج</button>` : ""}${isAdmin() ? `<button class="btn danger delete-company" data-company="${escapeHtml(company.id)}">حذف</button>` : ""}</div>
    </article>`;
  }).join("");
  page.innerHTML = `<div class="headline"><div><div class="crumb">نمای سازمانی و سرویس‌دهنده</div><h2>شرکت‌ها، شعبه‌ها و مشتریان</h2><div class="subtitle">برای مشاهده اطلاعات تماس، موقعیت، ارتباط‌ها و رنج‌ها یک شرکت را باز کنید.</div></div><div class="head-actions">${isAdmin() ? `<button id="addCompanyButton" class="btn primary">افزودن شرکت یا شعبه</button>` : ""}</div></div><section class="company-grid">${cards || `<div class="empty-state panel">شرکتی برای نمایش وجود ندارد.</div>`}</section>`;
  $("addCompanyButton")?.addEventListener("click", () => openCompanyDialog());
  page.querySelectorAll(".add-space").forEach((node) => node.addEventListener("click", () => openSpaceDialog(node.dataset.company)));
  page.querySelectorAll(".open-company").forEach((node) => node.addEventListener("click", () => openCompanyPage(node.dataset.company)));
  page.querySelectorAll(".edit-company").forEach((node) => node.addEventListener("click", () => openCompanyDialog(node.dataset.company)));
  page.querySelectorAll(".delete-company").forEach((node) => node.addEventListener("click", () => deleteCompany(node.dataset.company)));
}

async function openCompanyPage(companyId, { fromRoute = false } = {}) {
  const result = await request(`/api/companies/${encodeURIComponent(companyId)}`);
  state.companyData = result;
  state.currentCompanyId = companyId;
  state.currentSpaceId = null;
  state.data = null;
  state.view = "company";
  localStorage.setItem("ems-company", companyId);
  updateSelectors();
  navActive("companies");
  if (!fromRoute) setRoute(`/company/${encodeURIComponent(companyId)}`);
  const company = result.company;
  const kind = { company: "شرکت", branch: "شعبه", customer: "مشتری", site: "سایت" }[company.kind] || "شرکت";
  const parent = state.bootstrap.companies.find((item) => item.id === company.parentCompanyId);
  const mapUrl = company.latitude !== null && company.longitude !== null ? `https://www.google.com/maps?q=${encodeURIComponent(`${company.latitude},${company.longitude}`)}` : "";
  const contacts = (result.contacts || []).map((item) => `<article class="contact-card"><span class="contact-icon">${escapeHtml((item.fullName || "؟").slice(0, 1))}</span><div><b>${escapeHtml(item.fullName)}</b><small>${escapeHtml(item.jobTitle || "بدون سمت")} — ${escapeHtml(item.mobile || item.phone || "بدون شماره")} ${item.email ? `— ${escapeHtml(item.email)}` : ""}</small></div>${item.isPrimary ? `<span class="company-tree-badge">تماس اصلی</span>` : ""}</article>`).join("") || `<div class="empty-state compact-empty">فردی ثبت نشده است.</div>`;
  const connections = (result.connections || []).map((item) => `<article class="connection-card"><span class="contact-icon">↗</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.provider || "بدون شرکت اینترنتی")} — ${escapeHtml(item.deviceName || "تجهیز نامشخص")}</small></div><div><b class="connection-ip">${escapeHtml(item.ip)}</b>${normalizedConnectionMethods(item).length ? `<button class="btn sm company-tool" data-ip="${escapeHtml(item.ip)}">اتصال</button>` : ""}</div></article>`).join("") || `<div class="empty-state compact-empty">ارتباطی ثبت نشده است.</div>`;
  const personnel = (result.personnel || []).map((item) => `<article class="contact-card"><span class="contact-icon">${escapeHtml((item.fullName || "؟").slice(0,1))}</span><div><b>${escapeHtml(item.fullName)}</b><small>کد ${escapeHtml(item.employeeCode)} — ${escapeHtml(item.department || item.jobTitle || "بدون واحد")} ${item.mobile ? `— ${escapeHtml(item.mobile)}` : ""}</small></div><span class="status-pill">${item.active === false ? "غیرفعال" : "فعال"}</span></article>`).join("") || `<div class="empty-state compact-empty">پرسنلی برای این شرکت ثبت نشده است.</div>`;
  const spaces = (result.spaces || []).map((space) => `<div class="space-card-wrap"><button class="space-card open-space" data-space="${escapeHtml(space.id)}" style="--space-color:${escapeHtml(space.color)}"><b>${escapeHtml(space.name)}</b><small>${escapeHtml(space.cidr)}</small></button>${canManageCompany(companyId) ? `<div class="space-actions"><button class="btn sm edit-space" data-space="${escapeHtml(space.id)}">ویرایش</button><button class="btn sm danger delete-space" data-space="${escapeHtml(space.id)}">حذف</button></div>` : ""}</div>`).join("") || `<div class="empty-state compact-empty">رنج اصلی تعریف نشده است.</div>`;
  page.innerHTML = `<section class="company-hero"><div class="company-identity"><span class="company-avatar">${escapeHtml(company.name.slice(0, 1))}</span><div><span class="company-tree-badge">${escapeHtml(kind)}${parent ? ` زیرمجموعه ${escapeHtml(parent.name)}` : ""}</span><h2>${escapeHtml(company.name)}</h2><p>${escapeHtml(company.description || company.address || "اطلاعات تکمیلی ثبت نشده است.")}</p></div></div><div class="company-hero-actions"><button id="backCompanies" class="btn">بازگشت به شرکت‌ها</button>${canManageCompany(companyId) ? `<button id="editCurrentCompany" class="btn">ویرایش اطلاعات</button><button id="addCurrentSpace" class="btn primary">افزودن رنج اصلی</button>` : ""}</div></section>
    <section class="company-quick-info"><article class="info-card"><span>مدیر شرکت</span><b>${escapeHtml(company.managerName || "ثبت نشده")}</b></article><article class="info-card"><span>شماره تماس</span><b class="ltr">${escapeHtml(company.phone || "—")}</b></article><article class="info-card"><span>کد پستی</span><b class="ltr">${escapeHtml(company.postalCode || "—")}</b></article><article class="info-card"><span>موقعیت</span>${mapUrl ? `<a href="${mapUrl}" target="_blank" rel="noopener noreferrer">نمایش در Google Maps</a>` : `<b>ثبت نشده</b>`}</article></section>
    <section class="company-layout"><div><article class="company-section"><div class="section-title"><div><h4>رنج‌ها و مدیریت IP</h4><span>${formatNumber(result.stats?.prefixes || 0)} زیرشبکه و ${formatNumber(result.stats?.hosts || 0)} تجهیز ثبت‌شده</span></div></div><div class="company-section-body">${spaces}</div></article><article class="company-section"><div class="section-title"><div><h4>یادداشت‌های شرکت</h4><span>اطلاعات آزاد پشتیبانی</span></div></div><div class="company-section-body company-notes">${escapeHtml(company.notes || "یادداشتی ثبت نشده است.")}</div></article></div><aside><article class="company-section"><div class="section-title split"><div><h4>پرسنل این شعبه / شرکت</h4><span>${formatNumber(result.personnel?.length || 0)} نفر با کد پرسنلی</span></div>${isAdmin() ? `<button id="manageCompanyPersonnel" class="btn sm">مدیریت پرسنل</button>` : ""}</div><div class="company-section-body">${personnel}</div></article><article class="company-section"><div class="section-title"><div><h4>افراد تماس</h4><span>${formatNumber(result.contacts?.length || 0)} نفر</span></div></div><div class="company-section-body">${contacts}</div></article><article class="company-section"><div class="section-title"><div><h4>IP معتبر و ارتباط‌ها</h4><span>${formatNumber(result.connections?.length || 0)} ارتباط</span></div></div><div class="company-section-body">${connections}</div></article></aside></section>`;
  $("backCompanies").addEventListener("click", () => renderCompanies());
  $("editCurrentCompany")?.addEventListener("click", () => openCompanyDialog(companyId));
  $("addCurrentSpace")?.addEventListener("click", () => openSpaceDialog(companyId));
  $("manageCompanyPersonnel")?.addEventListener("click", () => openPersonnelDialog(companyId));
  page.querySelectorAll(".open-space").forEach((node) => node.addEventListener("click", () => loadSpace(node.dataset.space)));
  page.querySelectorAll(".edit-space").forEach((node) => node.addEventListener("click", () => openSpaceDialog(null, node.dataset.space)));
  page.querySelectorAll(".delete-space").forEach((node) => node.addEventListener("click", () => deleteSpace(node.dataset.space)));
  page.querySelectorAll(".company-tool").forEach((node) => node.addEventListener("click", (event) => {
    const connection = result.connections.find((item) => item.ip === node.dataset.ip);
    openToolMenu(event, node.dataset.ip, connection?.connectionMethods || [], connection || {});
  }));
}

function rangeBand(item, row, column, span) {
  const title = item.name || item.cidr;
  return `<button class="range-band edit-prefix" data-id="${escapeHtml(item.id)}" style="grid-row:${row};grid-column:${column}/span ${span};background:${escapeHtml(item.color)}" title="${escapeHtml(`${title} — ${item.cidr}`)}">${escapeHtml(title)}</button>`;
}

function overviewBands(rowStartIndex, rowTileCount, root, tileSize) {
  const rowStart = root.start + rowStartIndex * tileSize;
  const rowEnd = rowStart + rowTileCount * tileSize - 1;
  const relevant = prefixesIn(rowStart, rowEnd).map((item) => ({ item, info: prefixInfo(item) })).filter(({ info }) => info.prefix <= 24);
  const defaults = [20, 21, 22, 23, 24].filter((prefix) => prefix > root.prefix);
  const levels = [...new Set([...defaults, ...relevant.map(({ info }) => info.prefix)])].sort((a, b) => a - b);
  let html = `<div class="band-stack">${levels.map((prefix, index) => `<i class="band-guide" style="grid-row:${index + 1}" data-label="/${prefix}"></i>`).join("")}`;
  for (const { item, info } of relevant) {
    const segmentStart = Math.max(rowStart, info.start);
    const segmentEnd = Math.min(rowEnd, info.end);
    const column = Math.floor((segmentStart - rowStart) / tileSize) + 2;
    const span = Math.floor((segmentEnd - segmentStart + 1) / tileSize);
    html += rangeBand(item, levels.indexOf(info.prefix) + 1, column, Math.max(1, span));
  }
  return html + `</div>`;
}

function tileVisual(start) {
  const prefix = mostSpecific(start);
  const samples = [];
  for (let offset = 0; offset < 256; offset += 16) samples.push(mostSpecific(start + offset)?.color || "#eef1f6");
  const stripe = `linear-gradient(90deg,${samples.map((color, index) => `${color} ${index * 6.25}%,${color} ${(index + 1) * 6.25}%`).join(",")})`;
  return { color: prefix?.color || "#eef1f6", stripe, has: samples.some((color) => color !== "#eef1f6") };
}

function renderRootVerticalTable(root, hosts) {
  const space = state.data.space;
  const rowCount = 2 ** (24 - root.prefix);
  const levels = rootVerticalLevels(root.prefix);
  const exactPrefixes = new Map(state.data.prefixes.map((item) => [item.cidr, item]));
  const hostCounts = new Map();
  for (const ip of hosts.keys()) {
    const address = ipv4ToInt(ip);
    if (address === null || !contains(root, address)) continue;
    const index = Math.floor((address - root.start) / 256);
    hostCounts.set(index, (hostCounts.get(index) || 0) + 1);
  }
  let html = `<div class="root-vertical-wrap"><table class="root-range-table"><thead><tr><th>شبکه /24</th>${levels.map((prefix) => `<th>/${prefix}</th>`).join("")}</tr></thead><tbody>`;
  for (let row = 0; row < rowCount; row += 1) {
    const start = root.start + row * 256;
    const cidr = `${intToIpv4(start)}/24`;
    const exact = exactPrefixes.get(cidr);
    html += `<tr><td class="root-network-cell"><div class="range-cell-wrap"><button class="root-row-open" data-cidr="${cidr}" style="--range-color:${escapeHtml(exact?.color || "#eef2f7")}"><span class="root-octet">${(start >>> 8) & 255}</span><span><b class="mono ltr">${cidr}</b><small>${escapeHtml(exact?.name || "بدون نام")} — ${formatNumber(hostCounts.get(row) || 0)} IP</small></span></button>${canWrite() ? `<button class="range-label-action" data-cidr="${cidr}" data-prefix-id="${escapeHtml(exact?.id || "")}" style="--label-color:${escapeHtml(exact?.color || "#94a3b8")}" title="نام‌گذاری و رنگ‌کردن همین /24">■</button>` : ""}</div></td>`;
    for (const prefix of levels) {
      const span = 2 ** (24 - prefix);
      if (row % span !== 0) continue;
      const info = networkAt(start, prefix);
      const item = exactPrefixes.get(info.cidr);
      const isRoot = info.cidr === root.cidr;
      const color = item?.color || (isRoot ? space.color : "#eef2f7");
      const label = item?.name || (isRoot ? space.name : "آزاد");
      const detail = [item?.role, item?.description].filter(Boolean).join(" — ");
      const first = (start >>> 8) & 255;
      const last = ((start + span * 256 - 1) >>> 8) & 255;
      html += `<td rowspan="${span}" class="root-prefix-span" style="--range-color:${escapeHtml(color)}"><div class="range-cell-wrap"><button class="root-prefix-open ${item || isRoot ? "named" : ""}" data-cidr="${escapeHtml(info.cidr)}" title="${escapeHtml([label, detail, info.cidr].filter(Boolean).join(" — "))}"><b class="mono ltr">${escapeHtml(info.cidr)}</b><span>${first}–${last}</span><strong>${escapeHtml(label)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</button>${canWrite() ? `<button class="range-label-action ${isRoot ? "root-space-label" : ""}" data-cidr="${escapeHtml(info.cidr)}" data-prefix-id="${escapeHtml(item?.id || "")}" style="--label-color:${escapeHtml(color)}" title="${isRoot ? "ویرایش نام و رنگ رنج اصلی" : "نام‌گذاری و رنگ‌کردن همین رنج"}">■</button>` : ""}</div></td>`;
    }
    html += `</tr>`;
  }
  return html + `</tbody></table></div>`;
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
  const selected = state.paint ? state.paintPrefix : state.drillPrefix;
  for (let prefix = maximum; prefix >= minimum; prefix -= 1) items.push(`<button class="paint-prefix ${selected === prefix ? "active" : ""}" data-prefix="${prefix}">/${prefix}</button>`);
  return `<div class="segmented">${items.join("")}</div>`;
}

function renderOverview() {
  navActive("ipam");
  if (state.currentSpaceId) setRoute(`/ipam/${encodeURIComponent(state.currentSpaceId)}`);
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
    grid += overviewBands(rowStartIndex, rowCount, root, 256);
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
      const exact = state.data.prefixes.find((item) => item.cidr === cidr);
      grid += `<button class="subnet-tile open-tile" data-cidr="${cidr}" style="--tile-color:${escapeHtml(exact?.color || "#eef2f7")};--stripe:${escapeHtml(exact?.color || "#eef2f7")}" title="${escapeHtml(exact?.name || cidr)}"><i class="fill"></i><span class="octet">${third}</span>${exact ? `<div class="tile-name">${escapeHtml(exact.name)}</div>` : ""}<div class="cidr">${cidr}</div><div class="count">${count ? `${formatNumber(count)} IP` : "—"}</div></button>`;
    }
    grid += `</div>`;
  }
  grid += `</div>`;
  const rangeRows = [...state.data.prefixes].sort((a, b) => prefixInfo(a).start - prefixInfo(b).start || prefixInfo(a).prefix - prefixInfo(b).prefix).map((item) => {
    const info = prefixInfo(item);
    return `<div class="range-row"><i class="swatch" style="background:${escapeHtml(item.color)}"></i><div><div class="range-name">${escapeHtml(item.name)}</div><small class="ltr mono">${escapeHtml(item.cidr)}</small></div><small>${formatNumber(info.size)} آدرس</small><span class="status-pill">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span><div class="row-actions">${info.prefix <= 24 ? `<button class="btn sm open-prefix-sheet" data-cidr="${escapeHtml(item.cidr)}">نمایش</button>` : ""}${canWrite() ? `<button class="btn sm edit-prefix" data-id="${escapeHtml(item.id)}">ویرایش</button><button class="btn sm danger quick-delete-prefix" data-id="${escapeHtml(item.id)}">حذف</button>` : ""}</div></div>`;
  }).join("");
  const selectionMinimum = root.prefix;
  if (state.paintPrefix < selectionMinimum || state.paintPrefix > 24) state.paintPrefix = 24;
  if (state.drillPrefix < selectionMinimum || state.drillPrefix > 24) state.drillPrefix = 24;
  const overviewContent = state.overviewMode === "table" ? renderRootVerticalTable(root, hosts) : grid;
  page.innerHTML = `<div class="headline"><div><div class="crumb">${escapeHtml(space.companyName)} ← رنج اصلی</div><h2 class="ltr mono">${escapeHtml(space.cidr)}</h2><div class="subtitle">${escapeHtml(space.name)} — هر ردیف یک شبکهٔ /24 است و ستون‌ها مرز دقیق رنج‌های بزرگ‌تر را نشان می‌دهند.</div></div><div class="head-actions"><button class="btn" id="companyBack">نمای شرکت</button>${canWrite() ? `<button class="btn" id="editCurrentSpace">ویرایش رنج اصلی</button>` : ""}</div></div>
    <section class="stats"><div class="stat"><div class="label">کل آدرس‌ها</div><div class="value">${formatNumber(root.size)}</div><div class="foot ltr">${intToIpv4(root.start)} – ${intToIpv4(root.end)}</div></div><div class="stat"><div class="label">فضای تخصیص‌یافته</div><div class="value">${formatNumber(used)}</div><div class="progress"><i style="width:${Math.min(100, percent)}%"></i></div></div><div class="stat"><div class="label">فضای ثبت‌نشده</div><div class="value">${formatNumber(Math.max(0, root.size - used))}</div><div class="foot">${formatNumber(Math.max(0, 100 - percent))}٪ از کل شبکه</div></div><div class="stat"><div class="label">IP دارای اطلاعات</div><div class="value">${formatNumber(state.data.hosts.length)}</div><div class="foot">صرف‌نظر از نتیجهٔ پینگ</div></div></section>
    <section class="panel"><div class="toolbar"><div class="toolgroup">${state.overviewMode === "table" ? `<b>نقشه رنج‌ها</b><span class="mode-note">روی متن CIDR برای ورود به همان رنج کلیک کنید؛ مربع کوچک کنار هر کادر فقط نام‌گذاری و رنگ همان رنج را باز می‌کند.</span>` : `<b>${state.paint ? "اندازه رنج جدید" : "اندازه نمایش"}</b>${prefixButtons(selectionMinimum, 24)}${canWrite() ? `<button class="btn ${state.paint ? "paint-active" : ""}" id="paintToggle">${state.paint ? "پایان ثبت رنج" : "ثبت رنج جدید"}</button>` : ""}`}<div class="segmented"><button class="overview-mode ${state.overviewMode === "table" ? "active" : ""}" data-mode="table">جدول عمودی</button><button class="overview-mode ${state.overviewMode === "cards" ? "active" : ""}" data-mode="cards">نمای کاشی</button></div></div><div class="legend"><span><i class="dot used"></i>گروه ثبت‌شده</span><span><i class="dot record"></i>IP دارای اطلاعات</span><span><i class="dot free"></i>خالی/بدون گروه</span></div></div><div class="map-wrap ${state.overviewMode === "table" ? "root-table-container" : ""}">${overviewContent}</div></section>
    <div class="lower-grid"><section class="panel"><div class="section-title"><h3>رنج‌های ثبت‌شده</h3><span class="subtitle">${formatNumber(state.data.prefixes.length)} رنج</span></div><div class="range-list">${rangeRows || `<div class="empty-state">هنوز رنجی ثبت نشده است.</div>`}</div></section><section class="panel"><div class="section-title"><h3>خلاصه</h3></div><div class="summary-list"><div class="summary-item"><span>شرکت</span><b>${escapeHtml(space.companyName)}</b></div><div class="summary-item"><span>رنج اصلی</span><b class="ltr mono">${escapeHtml(space.cidr)}</b></div><div class="summary-item"><span>زیررنج‌ها</span><b>${formatNumber(state.data.prefixes.length)}</b></div><div class="summary-item"><span>درصد استفاده</span><b>${formatNumber(percent)}٪</b></div></div></section></div>`;
  $("companyBack").addEventListener("click", renderCompanies);
  $("editCurrentSpace")?.addEventListener("click", () => openSpaceDialog(null, space.id));
  $("paintToggle")?.addEventListener("click", () => { state.paint = !state.paint; renderOverview(); });
  page.querySelectorAll(".overview-mode").forEach((node) => node.addEventListener("click", () => {
    state.overviewMode = node.dataset.mode;
    localStorage.setItem("ems-overview-mode", state.overviewMode);
    renderOverview();
  }));
  page.querySelectorAll(".paint-prefix").forEach((node) => node.addEventListener("click", () => {
    if (state.paint) state.paintPrefix = Number(node.dataset.prefix);
    else state.drillPrefix = Number(node.dataset.prefix);
    renderOverview();
  }));
  page.querySelectorAll(".open-tile").forEach((node) => node.addEventListener("click", () => {
    const tile = parseCidr(node.dataset.cidr);
    const target = networkAt(tile.start, state.paint ? state.paintPrefix : state.drillPrefix);
    if (state.paint) {
      const existing = existingPrefixAt(tile.start);
      openPrefixDialog(existing?.cidr || target.cidr, existing?.id || null);
    } else { state.view = "sheet"; state.sheetCidr = target.cidr; renderSheet(); window.scrollTo(0, 0); }
  }));
  page.querySelectorAll(".root-row-open,.root-prefix-open").forEach((node) => node.addEventListener("click", () => {
    state.paint = false;
    state.view = "sheet";
    state.sheetCidr = node.dataset.cidr;
    state.treeFocusCidr = null;
    renderSheet();
    window.scrollTo(0, 0);
  }));
  page.querySelectorAll(".range-label-action").forEach((node) => node.addEventListener("click", (event) => {
    event.stopPropagation();
    if (node.classList.contains("root-space-label")) return openSpaceDialog(state.data.space.companyId, state.data.space.id);
    openPrefixDialog(node.dataset.cidr, node.dataset.prefixId || null);
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
      const explicitHostPrefix = state.data.prefixes.find((item) => item.cidr === `${ip}/32`);
      const system = last === 0 || last === 255;
      const connectable = !system && host && normalizedConnectionMethods(host).length > 0;
      grid += `<div class="ip-cell ${host ? "recorded" : ""} ${system ? "system" : ""}" data-ip="${ip}" style="--cell-color:${explicitHostPrefix?.color || "#eef1f6"};--host-color:${HOST_COLORS[host?.status] || "#3157d5"}" title="${escapeHtml(host?.name || ip)}"><i class="fill"></i><button class="ping-dot ${pingClass(ip, system, pings)} ${connectable ? "connectable" : ""}" data-ip="${ip}" title="${connectable ? "ابزارهای اتصال" : "وضعیت IP"}"></button><span class="last">${last}</span>${host ? `<div class="host-name">${escapeHtml(host.name || host.type || STATUS_LABELS[host.status])}</div>` : system ? `<div class="host-name">${last === 0 ? "Network" : "Broadcast"}</div>` : ""}</div>`;
    }
    grid += `</div>`;
  }
  return grid + `</div>`;
}

function renderVerticalTable(sheet) {
  const exactPrefixes = new Map(state.data.prefixes.map((item) => [item.cidr, item]));
  const hosts = hostMap();
  const pings = pingMap();
  let html = `<div class="vertical-table-wrap"><table class="vertical-subnet-table"><thead><tr><th>IP و نام تجهیز</th><th>وضعیت</th><th>اتصال</th>${DETAIL_PREFIXES.map((prefix) => `<th>/${prefix}</th>`).join("")}</tr></thead><tbody>`;
  for (let last = 0; last < 256; last += 1) {
    const ip = intToIpv4(sheet.start + last);
    const host = hosts.get(ip);
    const system = last === 0 || last === 255;
    const ping = pings.get(ip);
    const status = system ? (last === 0 ? "Network" : "Broadcast") : host ? (STATUS_LABELS[host.status] || host.status) : "آزاد";
    const connectionLabel = host ? hostConnectionLabel(host) : "";
    html += `<tr class="${host ? "recorded" : ""} ${system ? "system" : ""}"><td><button class="ip-line map-ip-cell" data-ip="${ip}"><span class="mono ltr">${escapeHtml(ip)}</span>${host?.name ? `<b>${escapeHtml(host.name)}</b>` : ""}</button></td><td><span class="table-status"><i class="${ping ? (ping.online ? "online" : "offline") : "unknown"}"></i>${escapeHtml(status)}</span></td><td class="table-connect">${connectionLabel ? `<button class="table-connect-button" data-ip="${escapeHtml(ip)}" title="${escapeHtml(`اتصال با ${connectionLabel}`)}">${escapeHtml(connectionLabel)}</button>` : `<span>—</span>`}</td>`;
    for (const prefix of DETAIL_PREFIXES) {
      const size = detailGroupSize(prefix);
      if (last % size !== 0) continue;
      const cidr = `${intToIpv4(sheet.start + last)}/${prefix}`;
      const item = exactPrefixes.get(cidr);
      const detail = [item?.role, item?.description].filter(Boolean).join(" — ");
      html += `<td rowspan="${size}" class="subnet-span prefix-${prefix}" style="--range-color:${escapeHtml(item?.color || "#eef2f7")}"><div class="range-cell-wrap detail-range-wrap"><button class="table-prefix focus-detail-prefix ${item ? "named" : ""}" data-cidr="${cidr}" title="${escapeHtml([item?.name, detail, cidr].filter(Boolean).join(" — "))}"><b class="mono ltr">${escapeHtml(cidr)}</b><span>${last}–${last + size - 1}</span><strong>${escapeHtml(item?.name || "آزاد")}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</button>${canWrite() ? `<button class="detail-range-label" data-cidr="${cidr}" data-prefix-id="${escapeHtml(item?.id || "")}" style="--label-color:${escapeHtml(item?.color || "#94a3b8")}" title="نام‌گذاری و رنگ‌کردن همین رنج">■</button>` : ""}</div></td>`;
    }
    html += `</tr>`;
  }
  return html + `</tbody></table></div>`;
}

function renderSubnetSelector(selected) {
  const hosts = hostMap();
  const count = selected.size / 256;
  const tiles = Array.from({ length: count }, (_, index) => {
    const start = selected.start + index * 256;
    const cidr = `${intToIpv4(start)}/24`;
    const exact = state.data.prefixes.find((item) => item.cidr === cidr);
    const hostCount = [...hosts.keys()].filter((ip) => { const value = ipv4ToInt(ip); return value >= start && value <= start + 255; }).length;
    return `<button class="drill-tile open-drill-tile" data-cidr="${cidr}" style="--range-color:${escapeHtml(exact?.color || "#eef2f7")}"><b class="mono ltr">${cidr}</b>${exact?.name ? `<span>${escapeHtml(exact.name)}</span>` : `<span>بدون نام</span>`}<small>${formatNumber(hostCount)} IP ثبت‌شده</small></button>`;
  }).join("");
  return `<div class="subnet-selector">${tiles}</div>`;
}

function treeBranch(info, remaining) {
  const exact = state.data.prefixes.find((item) => item.cidr === info.cidr);
  const isHost = info.prefix === 32;
  const name = isHost ? hostMap().get(intToIpv4(info.start))?.name : exact?.name;
  let html = `<li><div class="tree-node-wrap"><button class="tree-node ${isHost ? "host-node" : ""}" data-cidr="${escapeHtml(info.cidr)}" style="--range-color:${escapeHtml(exact?.color || "#eef2f7")}"><b class="mono ltr">${escapeHtml(info.cidr)}</b><small>${escapeHtml(name || (isHost ? "IP آزاد" : "رنج بدون نام"))}</small></button>${canWrite() && info.prefix <= 31 ? `<button class="tree-edit-prefix" data-cidr="${escapeHtml(info.cidr)}" title="ثبت یا ویرایش">✎</button>` : ""}</div>`;
  if (remaining > 0 && info.prefix < 32) {
    const childPrefix = info.prefix + 1;
    const half = info.size / 2;
    html += `<ul>${treeBranch(networkAt(info.start, childPrefix), remaining - 1)}${treeBranch(networkAt(info.start + half, childPrefix), remaining - 1)}</ul>`;
  }
  return html + `</li>`;
}

function renderTreeView(selected) {
  const focus = parseCidr(state.treeFocusCidr || selected.cidr);
  const safeFocus = focus && contains(selected, focus) ? focus : selected;
  state.treeFocusCidr = safeFocus.cidr;
  const depth = treeDepth(safeFocus.prefix);
  const endPrefix = safeFocus.prefix + depth;
  const trail = [];
  for (let prefix = selected.prefix; prefix <= safeFocus.prefix; prefix += 1) trail.push(networkAt(safeFocus.start, prefix).cidr);
  return `<div class="tree-toolbar"><div class="tree-current"><span>مسیر انتخاب</span><span class="tree-breadcrumbs">${trail.map((cidr, index) => `<button class="tree-jump" data-cidr="${escapeHtml(cidr)}">${index ? "← " : ""}${escapeHtml(cidr)}</button>`).join("")}</span><small>نمایش فعلی تا /${endPrefix}</small></div><div>${safeFocus.prefix > selected.prefix ? `<button class="btn sm tree-up" data-cidr="${escapeHtml(networkAt(safeFocus.start, safeFocus.prefix - 1).cidr)}">یک سطح بالاتر</button>` : ""}${canWrite() && safeFocus.prefix <= 31 ? `<button class="btn sm primary tree-edit-prefix" data-cidr="${escapeHtml(safeFocus.cidr)}">ثبت مشخصات این رنج</button>` : ""}</div></div><div class="tree-scroll" tabindex="0"><ul class="subnet-tree">${treeBranch(safeFocus, depth)}</ul></div><p class="mode-note tree-note">برای رسیدن به /30 و /32 روی شاخهٔ موردنظر کلیک کنید. کادر درخت در هر دو جهت اسکرول می‌شود و کلیک روی /32 فرم همان IP را باز می‌کند.</p>`;
}

function renderSheet() {
  navActive("ipam");
  const selected = parseCidr(state.sheetCidr);
  const space = state.data.space;
  const root = parseCidr(space.cidr);
  if (!selected || selected.prefix > 24 || !contains(root, selected)) { state.view = "overview"; renderOverview(); return; }
  if (state.currentSpaceId) setRoute(`/ipam/${encodeURIComponent(state.currentSpaceId)}/${encodeURIComponent(selected.cidr)}`);
  const blockCount = tableBlockCount(selected.prefix);
  const hosts = hostMap();
  const pings = pingMap();
  const relevant = prefixesIn(selected.start, selected.end);
  const hostCount = [...hosts.keys()].filter((ip) => contains(selected, ip)).length;
  const onlineCount = [...pings.values()].filter((item) => contains(selected, item.ip) && item.online).length;
  if (state.tableScopeCidr !== selected.cidr) {
    state.tableScopeCidr = selected.cidr;
    state.tableVisibleBlocks = visibleTableCount(blockCount, 8);
  }
  const visibleBlockCount = state.displayMode === "table" ? Math.min(blockCount, state.tableVisibleBlocks) : blockCount;
  const detailTables = (mode, count = blockCount) => Array.from({ length: count }, (_, index) => {
    const sheet = parseCidr(`${intToIpv4(selected.start + index * 256)}/24`);
    const content = mode === "table" ? renderVerticalTable(sheet) : renderIpGrid(sheet);
    return `<section class="panel detail-block"><div class="section-title"><div><h3 class="ltr mono">${escapeHtml(sheet.cidr)}</h3><span class="subtitle">IP 0–255 — جدول ${formatNumber(index + 1)} از ${formatNumber(blockCount)}</span></div>${canWrite() ? `<button class="btn sm edit-exact-prefix" data-cidr="${escapeHtml(sheet.cidr)}">ثبت / ویرایش مشخصات /24</button>` : ""}</div><div class="ip-wrap">${content}</div></section>`;
  }).join("");
  const blocks = state.displayMode === "tree"
    ? `<section class="panel detail-block"><div class="ip-wrap">${renderTreeView(selected)}</div></section>`
    : state.displayMode === "table"
      ? `${detailTables("table", visibleBlockCount)}${visibleBlockCount < blockCount ? `<section class="panel table-load-more"><div><b>${formatNumber(visibleBlockCount)} از ${formatNumber(blockCount)} جدول /24 نمایش داده شده</b><span>جدول‌های بعدی برای جلوگیری از کندشدن مرورگر مرحله‌ای اضافه می‌شوند.</span></div><button id="loadMoreTables" class="btn primary">نمایش ${formatNumber(Math.min(8, blockCount - visibleBlockCount))} جدول بعدی</button></section>` : ""}`
    : selected.prefix < 23
      ? `<section class="panel detail-block"><div class="section-title"><div><h3>زیرشبکه‌های /24</h3><span class="subtitle">برای مشاهده IPها یک شبکه را باز کنید.</span></div></div><div class="ip-wrap">${renderSubnetSelector(selected)}</div></section>`
      : detailTables("classic");
  const selectionIndex = Math.floor((selected.start - root.start) / selected.size);
  const selectionCount = Math.floor(root.size / selected.size);
  const options = Array.from({ length: selectionCount }, (_, index) => {
    const cidr = `${intToIpv4(root.start + index * selected.size)}/${selected.prefix}`;
    return `<option value="${cidr}" ${cidr === selected.cidr ? "selected" : ""}>${cidr}</option>`;
  }).join("");
  const rangeRows = relevant.sort((a, b) => prefixInfo(a).start - prefixInfo(b).start || prefixInfo(a).prefix - prefixInfo(b).prefix).map((item) => `<div class="range-row"><i class="swatch" style="background:${escapeHtml(item.color)}"></i><div><div class="range-name">${escapeHtml(item.name)}</div><small class="ltr mono">${escapeHtml(item.cidr)}</small></div><small>${formatNumber(prefixInfo(item).size)} آدرس</small><span class="status-pill">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span><div class="row-actions">${canWrite() ? `<button class="btn sm edit-prefix" data-id="${escapeHtml(item.id)}">ویرایش</button><button class="btn sm danger quick-delete-prefix" data-id="${escapeHtml(item.id)}">حذف</button>` : ""}</div></div>`).join("");
  const containingRanges = (state.data.prefixes || [])
    .map((item) => ({ item, info: prefixInfo(item) }))
    .filter(({ info }) => info && contains(info, selected))
    .sort((a, b) => b.info.prefix - a.info.prefix);
  const contextRange = containingRanges[0]?.item || null;
  const contextInfo = contextRange ? prefixInfo(contextRange) : root;
  const contextIsExact = contextInfo.cidr === selected.cidr;
  const sheetColor = contextRange?.color || space.color;
  const contextTitle = contextRange?.name || space.name;
  const contextDescription = contextRange?.description || contextRange?.role || space.description || "بدون توضیح ثبت‌شده";
  const usable = blockCount * 254;
  page.innerHTML = `<section class="sheet-banner" style="--sheet-color:${escapeHtml(sheetColor)}"><div class="sheet-color"></div><div class="sheet-main"><div class="sheet-title"><button id="overviewBack" class="back">← نمای رنج اصلی</button><div><div class="subtitle">رنج انتخاب‌شده</div><h2 class="ltr mono">${escapeHtml(selected.cidr)}</h2><p>${escapeHtml(space.companyName)} ← ${escapeHtml(space.name)} — ${formatNumber(blockCount)} جدول /24</p></div><div class="sheet-context"><i></i><div><span>${contextIsExact ? "مشخصات همین رنج" : `رنج ثبت‌شدهٔ والد /${contextInfo.prefix}`}</span><b>${escapeHtml(contextTitle)}</b><small class="mono ltr">${escapeHtml(contextInfo.cidr)}</small><em>${escapeHtml(contextDescription)}</em></div></div></div><div class="util"><div><b>${formatNumber(hostCount)}</b><div class="subtitle">IP ثبت‌شده</div></div><div class="ring" style="--p:${Math.round(hostCount / Math.max(1, usable) * 100)}" data-value="${formatNumber(Math.round(hostCount / Math.max(1, usable) * 100))}٪"></div></div><div class="sheet-nav"><button class="btn sm" id="prevSheet" ${selectionIndex <= 0 ? "disabled" : ""}>قبلی</button><select id="sheetSelect">${options}</select><button class="btn sm" id="nextSheet" ${selectionIndex >= selectionCount - 1 ? "disabled" : ""}>بعدی</button></div></div></section>
    <section class="panel view-controls"><div class="toolbar"><div class="toolgroup"><b>حالت نمایش</b><div class="segmented"><button class="display-mode ${state.displayMode === "classic" ? "active" : ""}" data-mode="classic">نمای تصویری</button><button class="display-mode ${state.displayMode === "table" ? "active" : ""}" data-mode="table">جدول عمودی</button><button class="display-mode ${state.displayMode === "tree" ? "active" : ""}" data-mode="tree">نمای درختی</button></div>${canWrite() && selected.prefix === 24 ? `<button class="btn" id="scanButton" ${state.scanning ? "disabled" : ""}>${state.scanning ? "در حال پینگ…" : "پینگ مجدد"}</button>` : ""}</div><span class="mode-note">در جدول عمودی، هر سطر یک IP است و گروه‌های /30 تا /24 در ستون‌های کنار آن قرار دارند.</span></div></section>
    <div class="detail-stack">${blocks}</div>
    <div class="lower-grid"><section class="panel"><div class="section-title"><h3>رنج‌های مرتبط</h3><span class="subtitle">${formatNumber(relevant.length)} رنج</span></div><div class="range-list">${rangeRows || `<div class="empty-state">برای این محدوده رنجی تعریف نشده است.</div>`}</div></section><section class="panel"><div class="section-title"><h3>خلاصه</h3></div><div class="summary-list"><div class="summary-item"><span>تعداد جدول /24</span><b>${formatNumber(blockCount)}</b></div><div class="summary-item"><span>IP ثبت‌شده</span><b>${formatNumber(hostCount)}</b></div><div class="summary-item"><span>پاسخ پینگ</span><b>${formatNumber(onlineCount)}</b></div><div class="summary-item"><span>رنج مرتبط</span><b>${formatNumber(relevant.length)}</b></div></div></section></div>`;
  $("overviewBack").addEventListener("click", () => { state.view = "overview"; state.paint = false; renderOverview(); });
  $("prevSheet").addEventListener("click", () => { if (selectionIndex > 0) { state.sheetCidr = `${intToIpv4(root.start + (selectionIndex - 1) * selected.size)}/${selected.prefix}`; renderSheet(); } });
  $("nextSheet").addEventListener("click", () => { if (selectionIndex < selectionCount - 1) { state.sheetCidr = `${intToIpv4(root.start + (selectionIndex + 1) * selected.size)}/${selected.prefix}`; renderSheet(); } });
  $("sheetSelect").addEventListener("change", (event) => { state.sheetCidr = event.target.value; renderSheet(); });
  $("scanButton")?.addEventListener("click", runPing);
  page.querySelectorAll(".display-mode").forEach((node) => node.addEventListener("click", () => { state.displayMode = node.dataset.mode; state.treeFocusCidr = selected.cidr; state.tableScopeCidr = null; localStorage.setItem("ems-display-mode", state.displayMode); renderSheet(); }));
  $("loadMoreTables")?.addEventListener("click", () => {
    const top = window.scrollY;
    state.tableVisibleBlocks = Math.min(blockCount, state.tableVisibleBlocks + 8);
    renderSheet();
    window.scrollTo(0, top);
  });
  page.querySelectorAll(".ip-cell").forEach((node) => node.addEventListener("click", (event) => {
    if (event.target.closest(".ping-dot")) return;
    openHostDialog(node.dataset.ip);
  }));
  page.querySelectorAll(".map-ip-cell").forEach((node) => node.addEventListener("click", () => openHostDialog(node.dataset.ip)));
  page.querySelectorAll(".edit-exact-prefix").forEach((node) => node.addEventListener("click", () => openPrefixDialog(node.dataset.cidr)));
  page.querySelectorAll(".detail-range-label").forEach((node) => node.addEventListener("click", (event) => { event.stopPropagation(); openPrefixDialog(node.dataset.cidr, node.dataset.prefixId || null); }));
  page.querySelectorAll(".focus-detail-prefix").forEach((node) => node.addEventListener("click", () => {
    const info = parseCidr(node.dataset.cidr);
    if (!info) return;
    const firstIp = intToIpv4(info.start);
    const row = page.querySelector(`.map-ip-cell[data-ip="${CSS.escape(firstIp)}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    page.querySelectorAll(".focus-detail-prefix").forEach((item) => item.classList.toggle("range-selected", item === node));
  }));
  page.querySelectorAll(".open-drill-tile").forEach((node) => node.addEventListener("click", () => { state.sheetCidr = node.dataset.cidr; state.treeFocusCidr = null; renderSheet(); window.scrollTo(0, 0); }));
  page.querySelectorAll(".tree-node").forEach((node) => node.addEventListener("click", () => {
    const info = parseCidr(node.dataset.cidr);
    if (info.prefix === 32) openHostDialog(intToIpv4(info.start));
    else { state.treeFocusCidr = info.cidr; renderSheet(); }
  }));
  page.querySelectorAll(".tree-edit-prefix").forEach((node) => node.addEventListener("click", (event) => { event.stopPropagation(); openPrefixDialog(node.dataset.cidr); }));
  page.querySelector(".tree-up")?.addEventListener("click", (event) => { state.treeFocusCidr = event.currentTarget.dataset.cidr; renderSheet(); });
  page.querySelectorAll(".tree-jump").forEach((node) => node.addEventListener("click", () => { state.treeFocusCidr = node.dataset.cidr; renderSheet(); }));
  page.querySelectorAll(".ping-dot.connectable,.table-connect-button").forEach((node) => node.addEventListener("click", (event) => { event.stopPropagation(); openToolMenu(event, node.dataset.ip); }));
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

function renderCompanyContacts(items = []) {
  $("companyContacts").innerHTML = items.map((item) => `<div class="repeat-row contact-row" data-id="${escapeHtml(item.id || "")}"><input class="contact-name" value="${escapeHtml(item.fullName || "")}" placeholder="نام و نام خانوادگی"><input class="contact-title" value="${escapeHtml(item.jobTitle || "")}" placeholder="سمت"><input class="contact-phone ltr" value="${escapeHtml(item.phone || "")}" placeholder="تلفن"><input class="contact-mobile ltr" value="${escapeHtml(item.mobile || "")}" placeholder="موبایل"><input class="contact-email ltr" value="${escapeHtml(item.email || "")}" placeholder="ایمیل"><button class="btn sm danger remove-repeat" type="button">حذف</button><label class="check-field"><input class="contact-primary" type="checkbox" ${item.isPrimary ? "checked" : ""}> تماس اصلی</label></div>`).join("") || `<div class="empty-state compact-empty">با دکمه «افزودن شخص» اولین فرد را ثبت کنید.</div>`;
  $("companyContacts").querySelectorAll(".remove-repeat").forEach((node) => node.addEventListener("click", () => { node.closest(".repeat-row").remove(); $("companyForm").dataset.dirty = "1"; }));
}

function collectCompanyContacts() {
  return [...$("companyContacts").querySelectorAll(".contact-row")].map((row) => ({ id: row.dataset.id || undefined, fullName: row.querySelector(".contact-name").value, jobTitle: row.querySelector(".contact-title").value, phone: row.querySelector(".contact-phone").value, mobile: row.querySelector(".contact-mobile").value, email: row.querySelector(".contact-email").value, isPrimary: row.querySelector(".contact-primary").checked })).filter((item) => item.fullName.trim());
}

function formatConnectionMethods(methods = []) {
  return methods.map((method) => `${method.type}${method.port !== null && method.port !== undefined ? `:${method.port}` : ""}`).join(", ");
}

function parseConnectionMethods(value) {
  return String(value || "").split(/[,،\s]+/).filter(Boolean).map((token) => {
    const match = token.match(/^([A-Za-z]+)(?::(\d{1,5}))?$/);
    if (!match) return null;
    const port = match[2] === undefined ? null : Number(match[2]);
    if (port !== null && (port < 0 || port > 65535)) return null;
    return { type: match[1].toUpperCase(), port };
  }).filter(Boolean);
}

function renderCompanyConnections(items = []) {
  $("companyConnections").innerHTML = items.map((item) => `<div class="repeat-row connection-row" data-id="${escapeHtml(item.id || "")}"><input class="connection-title" value="${escapeHtml(item.title || "")}" placeholder="عنوان ارتباط"><input class="connection-ip ltr mono" value="${escapeHtml(item.ip || "")}" placeholder="Public IP"><input class="connection-provider" value="${escapeHtml(item.provider || "")}" placeholder="شرکت اینترنتی"><select class="connection-role"><option value="primary" ${item.linkRole === "primary" ? "selected" : ""}>اصلی</option><option value="backup" ${item.linkRole === "backup" ? "selected" : ""}>پشتیبان</option><option value="other" ${item.linkRole === "other" ? "selected" : ""}>سایر</option></select><input class="connection-device" value="${escapeHtml(item.deviceName || "")}" placeholder="نام روتر"><button class="btn sm danger remove-repeat" type="button">حذف</button><input class="connection-methods ltr" value="${escapeHtml(formatConnectionMethods(item.connectionMethods || []))}" placeholder="WINBOX:8291, SSH:22, HTTPS:443"></div>`).join("") || `<div class="empty-state compact-empty">با دکمه «افزودن ارتباط» IP معتبر شرکت را ثبت کنید.</div>`;
  $("companyConnections").querySelectorAll(".remove-repeat").forEach((node) => node.addEventListener("click", () => { node.closest(".repeat-row").remove(); $("companyForm").dataset.dirty = "1"; }));
}

function collectCompanyConnections() {
  return [...$("companyConnections").querySelectorAll(".connection-row")].map((row) => ({
    id: row.dataset.id || undefined,
    title: row.querySelector(".connection-title").value,
    ip: row.querySelector(".connection-ip").value,
    provider: row.querySelector(".connection-provider").value,
    linkRole: row.querySelector(".connection-role").value,
    deviceName: row.querySelector(".connection-device").value,
    username: "",
    connectionMethods: parseConnectionMethods(row.querySelector(".connection-methods").value),
  })).filter((item) => item.ip.trim());
}

async function openCompanyDialog(id = null) {
  const base = id ? state.bootstrap.companies.find((entry) => entry.id === id) : null;
  const detail = id ? await request(`/api/companies/${encodeURIComponent(id)}`) : null;
  const item = detail?.company || base;
  $("companyForm").reset();
  $("companyId").value = item?.id || "";
  $("companyName").value = item?.name || "";
  $("companyKind").value = item?.kind || "company";
  $("companyCode").value = item?.code || "";
  $("companyManager").value = item?.managerName || "";
  $("companyPhone").value = item?.phone || "";
  $("companyPostalCode").value = item?.postalCode || "";
  $("companyAddress").value = item?.address || "";
  $("companyLatitude").value = item?.latitude ?? "";
  $("companyLongitude").value = item?.longitude ?? "";
  $("companyDescription").value = item?.description || "";
  $("companyNotes").value = item?.notes || "";
  $("companyParent").innerHTML = `<option value="">بدون شرکت مادر</option>${state.bootstrap.companies.filter((company) => company.id !== id).map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`).join("")}`;
  $("companyParent").value = item?.parentCompanyId || "";
  renderCompanyContacts(detail?.contacts || []);
  renderCompanyConnections(detail?.connections || []);
  $("companyDialogTitle").textContent = item ? "ویرایش شرکت" : "افزودن شرکت";
  $("deleteCompanyButton").classList.toggle("hidden", !item || !isAdmin());
  markFormClean($("companyForm"));
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
  if (!item || !confirm(`شرکت «${item.name}» به سطل بازیافت منتقل شود؟`)) return;
  try {
    await request(`/api/companies/${encodeURIComponent(id)}`, { method: "DELETE" });
    markFormClean($("companyForm")); $("companyDialog").close(); state.bootstrap = await request("/api/bootstrap");
    state.currentCompanyId = ""; renderCompanies(); toast("شرکت به سطل بازیافت منتقل شد.");
  } catch (error) { toast(error.message); }
}

async function deleteSpace(id) {
  const item = state.bootstrap.spaces.find((entry) => entry.id === id);
  if (!item || !confirm(`رنج اصلی ${item.cidr} به سطل بازیافت منتقل شود؟`)) return;
  try {
    await request(`/api/spaces/${encodeURIComponent(id)}`, { method: "DELETE" });
    $("spaceDialog").close(); state.bootstrap = await request("/api/bootstrap"); state.currentSpaceId = null;
    if (state.currentCompanyId) await openCompanyPage(state.currentCompanyId); else renderCompanies(); toast("رنج اصلی به سطل بازیافت منتقل شد.");
  } catch (error) { toast(error.message); }
}

function nextRangeColor(cidr) {
  const palette = ["#3157d5","#2fa36f","#d94b5b","#e48a2d","#805ad5","#2b9ca8","#c2418c","#64748b","#0f9f82","#d97706","#7c3aed","#0369a1","#be123c","#4d7c0f","#a16207","#4338ca"];
  const info = parseCidr(cidr);
  const used = new Set((state.data?.prefixes || []).filter((item) => { const p = prefixInfo(item); return p && info && p.prefix === info.prefix; }).map((item) => String(item.color || "").toLowerCase()));
  return palette.find((color) => !used.has(color.toLowerCase())) || palette[(state.data?.prefixes?.length || 0) % palette.length];
}

function openPrefixDialog(cidr, id = null) {
  const item = id ? state.data.prefixes.find((entry) => entry.id === id) : state.data.prefixes.find((entry) => entry.cidr === cidr) || null;
  const value = item
    ? { ...item, gateway: item.gateway || defaultGatewayForCidr(item.cidr) }
    : { id: "", cidr, name: "", status: "active", role: "", vlan: "", gateway: defaultGatewayForCidr(cidr), color: nextRangeColor(cidr), description: "" };
  if (!value.cidr) return;
  $("prefixDialogTitle").textContent = item ? "ویرایش رنج" : "ثبت و رنگ‌کردن رنج";
  $("prefixCidrTitle").textContent = value.cidr;
  for (const [key, field] of [["id", "prefixId"], ["cidr", "prefixCidr"], ["name", "prefixName"], ["status", "prefixStatus"], ["role", "prefixRole"], ["vlan", "prefixVlan"], ["gateway", "prefixGateway"], ["color", "prefixColor"], ["description", "prefixDescription"]]) $(field).value = value[key] || "";
  $("deletePrefixButton").classList.toggle("hidden", !item || !canWrite());
  $("exportPrefixButton").classList.toggle("hidden", !item);
  setFormWritable($("prefixForm"), canWrite());
  markFormClean($("prefixForm"));
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

function renderHostConnections(host = {}) {
  const configured = new Set((host.connectionMethods || []).map((item) => String(item.type || "").toUpperCase()).map((type) => type === "WINBOX" ? "MIK" : type));
  const legacy = new Set(normalizedConnectionMethods(host).map((item) => item.type));
  const selected = configured.size ? configured : legacy;
  $("hostConnections").innerHTML = state.bootstrap.tools.map((tool) => `<label class="connection-choice"><input type="checkbox" value="${escapeHtml(tool.tool)}" ${selected.has(tool.tool) ? "checked" : ""}><b style="color:${escapeHtml(tool.color)}">${escapeHtml(tool.label || tool.tool)}</b></label>`).join("");
}

function collectHostConnections() {
  return [...$("hostConnections").querySelectorAll("input:checked")].map((node) => ({ type: node.value === "MIK" ? "WINBOX" : node.value }));
}

function renderDevicePorts(items = []) {
  $("devicePortsList").innerHTML = items.map((item) => `<div class="device-port-row" data-id="${escapeHtml(item.id || "")}"><input class="device-port-name ltr" value="${escapeHtml(item.name || "")}" placeholder="ether1 / Gi1/0/1"><input class="device-port-description" value="${escapeHtml(item.description || "")}" placeholder="توضیح پورت"><select class="device-port-type"><option value="ethernet" ${item.portType === "ethernet" ? "selected" : ""}>Ethernet</option><option value="fiber" ${item.portType === "fiber" ? "selected" : ""}>Fiber</option><option value="wireless" ${item.portType === "wireless" ? "selected" : ""}>Wireless</option><option value="virtual" ${item.portType === "virtual" ? "selected" : ""}>Virtual</option></select><input class="device-port-speed ltr" value="${escapeHtml(item.speed || "")}" placeholder="1G"><input class="device-port-vlan ltr" value="${escapeHtml(item.vlan || "")}" placeholder="VLAN / Trunk"><button class="btn sm danger remove-device-port" type="button">حذف</button></div>`).join("");
  $("devicePortsList").querySelectorAll(".remove-device-port").forEach((node) => node.addEventListener("click", () => node.closest(".device-port-row").remove()));
}

function appendDevicePort(item = {}) {
  const current = collectDevicePorts();
  current.push(item);
  renderDevicePorts(current);
}

function collectDevicePorts() {
  return [...$("devicePortsList").querySelectorAll(".device-port-row")].map((row) => ({
    id: row.dataset.id || undefined,
    name: row.querySelector(".device-port-name").value,
    description: row.querySelector(".device-port-description").value,
    portType: row.querySelector(".device-port-type").value,
    speed: row.querySelector(".device-port-speed").value,
    vlan: row.querySelector(".device-port-vlan").value,
    enabled: true,
  })).filter((item) => item.name.trim());
}

async function ensureInventory(force = false) {
  if (!force && state.inventory.length) return state.inventory;
  const result = await request("/api/inventory");
  state.inventory = result.items || [];
  return state.inventory;
}

function monitorDisplay(item) {
  if (item.radioParentHostId) return { className: "", label: item.signal || "ثبت دستی" };
  return { className: "", label: "پایش خودکار خاموش" };
}

async function openInventoryPage(force = false, { fromRoute = false } = {}) {
  await ensureInventory(force);
  state.view = "inventory";
  state.data = null;
  state.currentSpaceId = null;
  navActive("inventory");
  if (!fromRoute) setRoute("/inventory");
  renderInventory();
}

function renderInventory() {
  const types = [...new Set(state.inventory.map((item) => item.type).filter(Boolean))].sort();
  const q = state.inventoryQuery.trim().toLowerCase();
  const items = state.inventory.filter((item) => {
    const companyMatch = !state.currentCompanyId || item.companyId === state.currentCompanyId;
    const typeMatch = !state.inventoryType || item.type === state.inventoryType;
    const queryMatch = !q || [item.name,item.ip,item.mac,item.vendor,item.model,item.serial,item.owner,item.companyName,item.spaceName].some((value) => String(value || "").toLowerCase().includes(q));
    return companyMatch && typeMatch && queryMatch;
  });
  page.innerHTML = `<div class="headline"><div><div class="crumb">موجودی شبکه</div><h2>تجهیزات و اطلاعات IP</h2><div class="subtitle">جست‌وجو، ویرایش و اتصال دستی به تجهیزات همه شرکت‌ها از یک صفحه</div></div></div><section class="stats"><article class="stat"><div class="label">کل تجهیزات</div><div class="value">${formatNumber(items.length)}</div></article><article class="stat"><div class="label">شرکت‌ها</div><div class="value">${formatNumber(new Set(items.map((item) => item.companyId)).size)}</div></article><article class="stat"><div class="label">رادیوها</div><div class="value">${formatNumber(items.filter((item) => item.radioMode).length)}</div></article><article class="stat"><div class="label">پایش خودکار</div><div class="value">خاموش</div></article></section><div class="inventory-toolbar"><div class="inventory-filters"><input id="inventorySearch" value="${escapeHtml(state.inventoryQuery)}" placeholder="نام، IP، MAC، مدل یا سریال…"><select id="inventoryType"><option value="">همه انواع تجهیزات</option>${types.map((type) => `<option value="${escapeHtml(type)}" ${type === state.inventoryType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select></div><button id="refreshInventory" class="btn">به‌روزرسانی فهرست</button></div><div class="inventory-table-wrap"><table class="inventory-table"><thead><tr><th>تجهیز</th><th>IP و MAC</th><th>شرکت و رنج</th><th>نوع و مدل</th><th>وضعیت پایش</th><th>عملیات</th></tr></thead><tbody>${items.map((item) => { const monitor = monitorDisplay(item); const hasTools = normalizedConnectionMethods(item).length > 0; return `<tr><td class="inventory-name"><b>${escapeHtml(item.name || "بدون نام")}</b><small>${escapeHtml(item.owner || item.location || "—")}</small></td><td><b class="ltr mono">${escapeHtml(item.ip)}</b><small class="ltr mono">${escapeHtml(item.mac || "—")}</small></td><td>${escapeHtml(item.companyName)}<small>${escapeHtml(item.spaceName)}</small></td><td>${escapeHtml(item.type || "نامشخص")}<small>${escapeHtml([item.vendor,item.model].filter(Boolean).join(" ") || "—")}</small></td><td><span class="monitor-pill ${monitor.className}">${escapeHtml(monitor.label)}</span></td><td><div class="row-actions"><button class="btn sm edit-inventory" data-id="${escapeHtml(item.id)}">مشاهده و ویرایش</button>${hasTools ? `<button class="btn sm inventory-tools" data-id="${escapeHtml(item.id)}">اتصال</button>` : ""}</div></td></tr>`; }).join("") || `<tr><td colspan="6"><div class="empty-state">تجهیزی مطابق فیلتر پیدا نشد.</div></td></tr>`}</tbody></table></div>`;
  $("inventorySearch").addEventListener("input", (event) => { state.inventoryQuery = event.target.value; renderInventory(); requestAnimationFrame(() => { $("inventorySearch")?.focus(); $("inventorySearch")?.setSelectionRange(state.inventoryQuery.length, state.inventoryQuery.length); }); });
  $("inventoryType").addEventListener("change", (event) => { state.inventoryType = event.target.value; renderInventory(); });
  $("refreshInventory").addEventListener("click", () => openInventoryPage(true));
  page.querySelectorAll(".edit-inventory").forEach((node) => node.addEventListener("click", () => openInventoryItem(state.inventory.find((item) => item.id === node.dataset.id))));
  page.querySelectorAll(".inventory-tools").forEach((node) => node.addEventListener("click", (event) => { const item = state.inventory.find((entry) => entry.id === node.dataset.id); if (item) openToolMenu(event, item.ip); }));
}

function updateRadioFields(selectedParent = "") {
  const mode = $("hostRadioMode").value;
  $("radioParentField").classList.toggle("hidden", mode !== "station");
  const aps = state.inventory.filter((item) => item.radioMode === "ap" && item.id !== $("hostId").value);
  const query = $("hostRadioParentSearch").value.trim().toLowerCase();
  const matches = aps.filter((item) => !query || [item.name, item.ip, item.ssid, item.mac, item.companyName, item.spaceName, item.location].some((value) => String(value || "").toLowerCase().includes(query)));
  const visible = selectedParent && !matches.some((item) => item.id === selectedParent) ? [aps.find((item) => item.id === selectedParent), ...matches].filter(Boolean) : matches;
  $("hostRadioParent").innerHTML = `<option value="">انتخاب نشده</option>${visible.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedParent ? "selected" : ""}>${escapeHtml(item.name || item.ip)} — ${escapeHtml(item.ssid || "بدون SSID")} — ${escapeHtml(item.ip)} — ${escapeHtml(item.companyName || "")}</option>`).join("")}`;
  $("hostRadioParentHint").textContent = `${formatNumber(matches.length)} AP پیدا شد${query ? "؛ نتیجه با نوشتن فیلتر می‌شود." : "؛ برای جست‌وجوی سریع تایپ کنید."}`;
  $("ssidSuggestions").innerHTML = aps.filter((item) => item.ssid).map((item) => `<option value="${escapeHtml(item.ssid)}">${escapeHtml(item.name || item.ip)}</option>`).join("");
  if (mode === "station") {
    const parent = aps.find((item) => item.id === $("hostRadioParent").value);
    if (parent?.ssid && !$("hostSsid").value) $("hostSsid").value = parent.ssid;
  }
}

function monitorPortFor(driver) {
  return driver === "mikrotik-api" ? 8728 : driver === "mikrotik-api-ssl" ? 8729 : 443;
}

function updateMonitorDriverUi({ syncPort = false, script = false } = {}) {
  if (!script) return;
  const driver = $("scriptTransport").value;
  if (syncPort) $("scriptPort").value = monitorPortFor(driver);
  $("scriptCertificateField").classList.toggle("hidden", driver === "mikrotik-api");
}

function renderHostCustomFields(fields = {}) {
  const list = Object.entries(fields || {});
  $("hostCustomFields").innerHTML = list.map(([key, value]) => `<div class="custom-field-row"><input class="custom-field-key" value="${escapeHtml(key)}" placeholder="نام فیلد"><input class="custom-field-value" value="${escapeHtml(value ?? "")}" placeholder="مقدار"><button class="btn sm danger remove-custom-field" type="button">حذف</button></div>`).join("") || `<div class="empty-state compact-empty">فیلد سفارشی ثبت نشده است.</div>`;
  $("hostCustomFields").querySelectorAll(".remove-custom-field").forEach((button) => button.addEventListener("click", () => { button.closest(".custom-field-row").remove(); if (!$("hostCustomFields").querySelector(".custom-field-row")) $("hostCustomFields").innerHTML = `<div class="empty-state compact-empty">فیلد سفارشی ثبت نشده است.</div>`; $("hostForm").dataset.dirty = "1"; }));
}

function addHostCustomFieldRow(key = "", value = "") {
  const empty = $("hostCustomFields").querySelector(".compact-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "custom-field-row";
  row.innerHTML = `<input class="custom-field-key" value="${escapeHtml(key)}" placeholder="نام فیلد"><input class="custom-field-value" value="${escapeHtml(value)}" placeholder="مقدار"><button class="btn sm danger remove-custom-field" type="button">حذف</button>`;
  row.querySelector(".remove-custom-field").addEventListener("click", () => { row.remove(); if (!$("hostCustomFields").querySelector(".custom-field-row")) $("hostCustomFields").innerHTML = `<div class="empty-state compact-empty">فیلد سفارشی ثبت نشده است.</div>`; });
  $("hostCustomFields").appendChild(row);
}

function collectHostCustomFields() {
  const result = {};
  $("hostCustomFields").querySelectorAll(".custom-field-row").forEach((row) => {
    const key = row.querySelector(".custom-field-key").value.trim();
    const value = row.querySelector(".custom-field-value").value.trim();
    if (key) result[key] = value;
  });
  return result;
}

function openHostDialog(ip) {
  const item = state.data.hosts.find((entry) => entry.ip === ip) || null;
  const value = item || { id: "", ip, name: "", status: "active", type: "", os: "", mac: "", vlan: "", username: "", owner: "", location: "", secretRef: "", notes: "", ports: {}, devicePorts: [] };
  $("hostIpTitle").textContent = ip;
  for (const [key, field] of [["id", "hostId"], ["ip", "hostIp"], ["name", "hostName"], ["status", "hostStatus"], ["type", "hostType"], ["os", "hostOs"], ["mac", "hostMac"], ["vlan", "hostVlan"], ["username", "hostUsername"], ["owner", "hostOwner"], ["location", "hostLocation"], ["vendor", "hostVendor"], ["model", "hostModel"], ["serial", "hostSerial"], ["firmware", "hostFirmware"], ["radioMode", "hostRadioMode"], ["ssid", "hostSsid"], ["frequency", "hostFrequency"], ["channel", "hostChannel"], ["signal", "hostSignal"], ["secretRef", "hostSecretRef"], ["notes", "hostNotes"]]) $(field).value = value[key] || "";
  $("hostRadioParentSearch").value = "";
  renderHostPorts(value);
  renderHostConnections(value);
  renderDevicePorts(value.devicePorts || []);
  renderHostCustomFields(value.customFields || {});
  ensureInventory().then(() => updateRadioFields(value.radioParentHostId || "")).catch(() => updateRadioFields(value.radioParentHostId || ""));
  $("deleteHostButton").classList.toggle("hidden", !item || !canWrite());
  setFormWritable($("hostForm"), canWrite());
  const sheet = parseCidr(state.sheetCidr || `${ip}/24`);
  const current = ipv4ToInt(ip);
  const prev = current > sheet.start ? intToIpv4(current - 1) : "";
  const next = current < sheet.end ? intToIpv4(current + 1) : "";
  $("prevHostButton").disabled = !prev; $("prevHostButton").dataset.ip = prev;
  $("nextHostButton").disabled = !next; $("nextHostButton").dataset.ip = next;
  markFormClean($("hostForm"));
  $("hostDialog").showModal();
}

function openToolMenu(event, ip, allowedMethods = null, connection = {}) {
  event?.stopPropagation?.();
  const host = state.data?.hosts?.find((item) => item.ip === ip) || state.inventory.find((item) => item.ip === ip) || { ports: {} };
  const configured = normalizedConnectionMethods(host, Array.isArray(allowedMethods) ? allowedMethods : null);
  const allowed = new Set(configured.map((item) => item.type));
  const connectionPorts = new Map(configured.filter((item) => item?.port !== null && item?.port !== undefined).map((item) => [item.type, Number(item.port)]));
  const username = connection.username || host.username || "";
  const tools = state.bootstrap.tools.filter((tool) => allowed.has(tool.tool));
  if (!tools.length) return toast("برای این تجهیز روش اتصالی انتخاب نشده است.");
  const menu = $("toolMenu");
  menu.innerHTML = `<div class="tool-menu-title">${escapeHtml(ip)} — انتخاب ابزار</div><div class="tool-buttons">${tools.map((tool) => {
    const port = connectionPorts.has(tool.tool) ? connectionPorts.get(tool.tool) : Object.prototype.hasOwnProperty.call(host.ports || {}, tool.tool) ? host.ports[tool.tool] : tool.defaultPort;
    return `<button class="tool-square" data-tool="${escapeHtml(tool.tool)}" data-port="${escapeHtml(port)}" style="background:${escapeHtml(tool.color)}">${escapeHtml(tool.tool)}<small>${port ? `:${port}` : "پیش‌فرض"}</small></button>`;
  }).join("")}</div>`;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 265)}px`;
  menu.style.top = `${Math.min(event.clientY + 10, window.innerHeight - 90)}px`;
  menu.classList.remove("hidden");
  menu.querySelectorAll(".tool-square").forEach((node) => node.addEventListener("click", () => {
    if (node.dataset.tool === "HTTP" || node.dataset.tool === "HTTPS") {
      const scheme = node.dataset.tool.toLowerCase();
      const port = node.dataset.port && !(["80", "443"].includes(node.dataset.port)) ? `:${node.dataset.port}` : "";
      window.open(`${scheme}://${ip}${port}`, "_blank", "noopener");
      menu.classList.add("hidden");
      return;
    }
    const url = new URL("emsipam://open");
    url.searchParams.set("tool", node.dataset.tool);
    url.searchParams.set("host", ip);
    url.searchParams.set("port", node.dataset.port || "0");
    if (username) url.searchParams.set("username", username);
    window.location.href = url.toString();
    menu.classList.add("hidden");
  }));
}

function activateSearchResult(index) {
  const nodes = [...$("searchResults").querySelectorAll(".search-item")];
  if (!nodes.length) { state.searchIndex = -1; return; }
  state.searchIndex = Math.max(0, Math.min(index, nodes.length - 1));
  nodes.forEach((node, i) => node.classList.toggle("keyboard-active", i === state.searchIndex));
  nodes[state.searchIndex]?.scrollIntoView({ block: "nearest" });
}

async function chooseSearchItem(item) {
  $("searchResults").classList.add("hidden");
  state.searchIndex = -1;
  if (!item) return;
  if (item.kind === "company") { await openCompanyPage(item.companyId || item.id); return; }
  if (item.kind === "personnel") { await openPersonnelDialog(); editPersonnel(item); return; }
  const address = item.ip ? ipv4ToInt(item.ip) : parseCidr(item.cidr)?.start;
  const sheetCidr = `${intToIpv4(address & 0xffffff00)}/24`;
  await loadSpace(item.spaceId, { sheetCidr });
  if (item.kind === "prefix") openPrefixDialog(item.cidr, item.id);
  else openHostDialog(item.ip);
}

function doSearch(query) {
  const resultsNode = $("searchResults");
  const value = String(query || "").trim();
  clearTimeout(state.searchTimer);
  state.searchItems = [];
  state.searchIndex = -1;
  if (!value) { resultsNode.classList.add("hidden"); return; }
  resultsNode.innerHTML = `<div class="search-loading">در حال جست‌وجو…</div>`;
  resultsNode.classList.remove("hidden");
  state.searchTimer = setTimeout(async () => {
    try {
      const result = await request(`/api/search?q=${encodeURIComponent(value)}`);
      const items = result.items || [];
      state.searchItems = items;
      resultsNode.innerHTML = items.map((item, index) => {
        const title = item.kind === "company" ? item.name : item.kind === "personnel" ? item.fullName : item.kind === "prefix" ? (item.name || item.cidr) : (item.name || item.ip);
        const detail = item.kind === "company" ? (item.address || item.phone || "اطلاعات شرکت") : item.kind === "personnel" ? `${item.employeeCode || ""}${item.department ? ` — ${item.department}` : ""}` : item.kind === "prefix" ? item.cidr : item.ip;
        const badge = item.kind === "company" ? "شرکت" : item.kind === "personnel" ? "پرسنل" : item.kind === "free-ip" ? "IP ثبت‌نشده" : item.kind === "prefix" ? "رنج" : "IP";
        return `<button class="search-item" data-index="${index}"><span><b>${escapeHtml(title)}</b><em>${escapeHtml(badge)}</em></span><small>${escapeHtml(detail)}${item.spaceName ? ` — ${escapeHtml(item.spaceName)}` : ""}</small></button>`;
      }).join("") || `<div class="empty-state">نتیجه‌ای پیدا نشد.</div>`;
      resultsNode.querySelectorAll(".search-item").forEach((node) => node.addEventListener("click", () => chooseSearchItem(items[Number(node.dataset.index)])));
    } catch (error) { resultsNode.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  }, 180);
}

async function refreshPersonnel(query = "") {
  const result = await request(`/api/personnel${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const items = result.items || [];
  $("personnelList").innerHTML = items.map((item) => `<div class="personnel-row"><div><b>${escapeHtml(item.fullName)}</b><small>${escapeHtml(item.employeeCode)} — ${escapeHtml(item.department || item.companyName || "")}</small><small>${escapeHtml(item.mobile || item.phone || item.email || "")}</small></div><div class="row-actions"><button class="btn sm edit-personnel" data-id="${escapeHtml(item.id)}">ویرایش</button><button class="btn sm danger delete-personnel" data-id="${escapeHtml(item.id)}">حذف</button></div></div>`).join("") || `<div class="empty-state">پرسنلی ثبت نشده است.</div>`;
  $("personnelList").querySelectorAll(".edit-personnel").forEach((node) => node.addEventListener("click", () => editPersonnel(items.find((item) => item.id === node.dataset.id))));
  $("personnelList").querySelectorAll(".delete-personnel").forEach((node) => node.addEventListener("click", async () => {
    const item = items.find((entry) => entry.id === node.dataset.id); if (!item || !confirm(`پرسنل «${item.fullName}» حذف شود؟`)) return;
    try { await request(`/api/personnel/${encodeURIComponent(item.id)}`, { method: "DELETE" }); resetPersonnelForm(); await refreshPersonnel($("personnelSearch").value); toast("پرسنل حذف شد."); } catch (error) { toast(error.message); }
  }));
}

function resetPersonnelForm() {
  $("personnelForm").reset(); $("personnelId").value = ""; $("personnelActive").checked = true; $("personnelFormTitle").textContent = "پرسنل جدید"; $("cancelPersonnelEdit").classList.add("hidden");
}

function editPersonnel(item) {
  if (!item) return; $("personnelId").value = item.id; $("personnelCode").value = item.employeeCode || ""; $("personnelName").value = item.fullName || ""; $("personnelMobile").value = item.mobile || ""; $("personnelPhone").value = item.phone || ""; $("personnelEmail").value = item.email || ""; $("personnelDepartment").value = item.department || ""; $("personnelJobTitle").value = item.jobTitle || ""; $("personnelCompany").value = item.companyId || ""; $("personnelNotes").value = item.notes || ""; $("personnelActive").checked = item.active !== false; $("personnelFormTitle").textContent = "ویرایش پرسنل"; $("cancelPersonnelEdit").classList.remove("hidden");
}

async function openPersonnelDialog(companyId = "") {
  $("personnelCompany").innerHTML = `<option value="">بدون شرکت</option>${(state.bootstrap?.companies || []).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
  resetPersonnelForm();
  if (companyId) $("personnelCompany").value = companyId;
  $("personnelSearch").value = ""; await refreshPersonnel(); $("personnelDialog").showModal();
}

async function openUsersDialog() {
  resetUserForm();
  renderCompanyAccess();
  $("usersDialog").showModal();
  await refreshUsers();
}

function renderModuleAccess(selectedModules = []) {
  const isGlobal = $("userRole").value === "admin";
  const catalog = Array.isArray(state.bootstrap?.moduleCatalog) ? state.bootstrap.moduleCatalog : [];
  $("moduleAccessList").innerHTML = catalog.map((item) => {
    const checked = isGlobal || selectedModules.includes(item.id);
    const installState = item.installed ? "فعال/آماده" : "ماژول آینده";
    return `<label class="module-access-item"><input class="module-access-check" type="checkbox" value="${escapeHtml(item.id)}" ${checked ? "checked" : ""} ${isGlobal ? "disabled" : ""}><span><b>${escapeHtml(item.name || item.id)}</b><small>${escapeHtml(item.description || "")} — ${escapeHtml(installState)}</small></span></label>`;
  }).join("") || `<div class="empty-state compact-empty">ماژولی تعریف نشده است.</div>`;
}

function renderCompanyAccess(selectedCompanies = [], selectedSpaces = [], selectedModules = []) {
  renderModuleAccess(selectedModules);
  const isGlobal = $("userRole").value === "admin";
  $("companyAccessList").innerHTML = state.bootstrap.companies.map((company) => `<label><input class="company-access-check" type="checkbox" value="${escapeHtml(company.id)}" ${selectedCompanies.includes(company.id) ? "checked" : ""}>${escapeHtml(company.name)} <small>همه شبکه‌ها</small></label>`).join("");
  $("spaceAccessList").innerHTML = state.bootstrap.companies.map((company) => {
    const spaces = state.bootstrap.spaces.filter((space) => space.companyId === company.id);
    return `<div class="space-access-group"><b>${escapeHtml(company.name)}</b>${spaces.map((space) => `<label><input class="space-access-check" data-company="${escapeHtml(company.id)}" type="checkbox" value="${escapeHtml(space.id)}" ${selectedSpaces.includes(space.id) ? "checked" : ""}> <span class="ltr mono">${escapeHtml(space.cidr)}</span> — ${escapeHtml(space.name)}</label>`).join("") || `<small>شبکه‌ای وجود ندارد.</small>`}</div>`;
  }).join("");
  $("companyAccessField").classList.toggle("hidden", isGlobal);
  $("spaceAccessField").classList.toggle("hidden", isGlobal);
  const sync = () => {
    const fullCompanies = new Set([...$("companyAccessList").querySelectorAll("input:checked")].map((node) => node.value));
    $("spaceAccessList").querySelectorAll(".space-access-check").forEach((node) => {
      node.disabled = fullCompanies.has(node.dataset.company);
      if (node.disabled) node.checked = false;
    });
  };
  $("companyAccessList").querySelectorAll("input").forEach((node) => node.addEventListener("change", sync));
  sync();
}

async function refreshUsers() {
  const result = await request("/api/users");
  $("usersList").innerHTML = result.users.map((user) => `<div class="user-row"><div><b>${escapeHtml(user.displayName || user.username)}</b><small>${escapeHtml(user.username)}</small></div><span class="status-pill">${user.role === "admin" ? "مدیر" : user.role === "support" ? "پشتیبانی" : user.role === "helpdesk" ? "هلپ‌دسک" : "مشاهده‌گر"}</span><small>${user.role === "admin" ? "همه ماژول‌ها" : `${formatNumber((user.moduleIds || []).length)} دسترسی`}</small><div class="row-actions"><button class="btn sm edit-user" data-id="${escapeHtml(user.id)}">ویرایش</button><button class="btn sm danger delete-user" data-id="${escapeHtml(user.id)}">حذف</button></div></div>`).join("");
  $("usersList").querySelectorAll(".edit-user").forEach((node) => node.addEventListener("click", () => editUser(result.users.find((item) => item.id === node.dataset.id))));
  $("usersList").querySelectorAll(".delete-user").forEach((node) => node.addEventListener("click", async () => {
    const account = result.users.find((item) => item.id === node.dataset.id);
    if (!account || !confirm(`کاربر «${account.username}» حذف شود؟`)) return;
    try { await request(`/api/users/${encodeURIComponent(account.id)}`, { method: "DELETE" }); resetUserForm(); await refreshUsers(); toast("کاربر حذف شد."); }
    catch (error) { toast(error.message); }
  }));
}

function resetUserForm() {
  $("userForm").reset(); $("userId").value = ""; $("userUsername").disabled = false; $("userFormTitle").textContent = "کاربر جدید"; $("passwordHint").textContent = "هر رمز دلخواه؛ برای کاربر جدید خالی نباشد"; $("userActiveWrap").classList.add("hidden"); $("cancelUserEdit").classList.add("hidden"); renderCompanyAccess([], [], ["ipam","inventory"]);
}

function editUser(user) {
  $("userId").value = user.id; $("userUsername").value = user.username; $("userUsername").disabled = true; $("userDisplayName").value = user.displayName || ""; $("userPassword").value = ""; $("userRole").value = user.role; $("userActive").checked = user.active; $("userFormTitle").textContent = "ویرایش کاربر"; $("passwordHint").textContent = "برای حفظ رمز فعلی خالی بماند"; $("userActiveWrap").classList.remove("hidden"); $("cancelUserEdit").classList.remove("hidden"); renderCompanyAccess(user.companyIds || [], user.spaceIds || [], user.moduleIds || []);
}

async function openInventoryItem(item) {
  if (!item) return;
  const address = ipv4ToInt(item.ip);
  await loadSpace(item.spaceId, { sheetCidr: `${intToIpv4(address & 0xffffff00)}/24` });
  openHostDialog(item.ip);
}

async function quickOpenIp(ip) {
  const value = String(ip || "").trim();
  if (ipv4ToInt(value) === null) return toast("یک IP معتبر وارد کنید.");
  try {
    const result = await request(`/api/search?q=${encodeURIComponent(value)}`);
    const item = (result.items || []).find((entry) => entry.ip === value);
    if (!item) return toast("این IP داخل شبکه‌های قابل دسترسی نیست.");
    await loadSpace(item.spaceId, { sheetCidr: `${intToIpv4(ipv4ToInt(value) & 0xffffff00)}/24` });
    openHostDialog(value);
  } catch (error) { toast(error.message); }
}

async function openRadiosPage(force = true, { fromRoute = false } = {}) {
  try {
    await ensureInventory(force);
    state.view = "radios";
    state.currentSpaceId = null;
    state.data = null;
    updateSelectors();
    navActive("radios");
    if (!fromRoute) setRoute("/radios");
    renderRadios();
  } catch (error) { toast(error.message); }
}

async function quickOpenRadio(ip, mode, parentId = "") {
  const value = String(ip || "").trim();
  if (ipv4ToInt(value) === null) return toast("یک IP معتبر برای رادیو وارد کنید.");
  if (!['ap', 'station'].includes(mode)) return toast("حالت رادیو را انتخاب کنید.");
  if (mode === "station" && !parentId) return toast("برای Station یک AP انتخاب کنید.");
  try {
    const result = await request(`/api/search?q=${encodeURIComponent(value)}`);
    const item = (result.items || []).find((entry) => entry.ip === value);
    if (!item) return toast("این IP داخل شبکه‌های قابل دسترسی نیست.");
    await loadSpace(item.spaceId, { sheetCidr: `${intToIpv4(ipv4ToInt(value) & 0xffffff00)}/24` });
    openHostDialog(value);
    $("hostRadioMode").value = mode;
    updateRadioFields(parentId);
    if (mode === "station") {
      $("hostRadioParent").value = parentId;
      const parent = state.inventory.find((entry) => entry.id === parentId);
      if (parent?.ssid) $("hostSsid").value = parent.ssid;
    }
    if (!$("hostType").value) $("hostType").value = "رادیو";
    $("hostName").focus();
  } catch (error) { toast(error.message); }
}

function radioSignalClass(signal) {
  const value = Number.parseInt(String(signal || ""), 10);
  if (!Number.isFinite(value)) return "unknown";
  if (value >= -60) return "excellent";
  if (value >= -70) return "good";
  return "weak";
}

function renderRadios() {
  const radios = state.inventory.filter((item) => (!state.currentCompanyId || item.companyId === state.currentCompanyId) && (item.radioMode === "ap" || item.radioMode === "station"));
  const aps = radios.filter((item) => item.radioMode === "ap");
  const stations = radios.filter((item) => item.radioMode === "station");
  const stationNode = (item) => { const monitor = monitorDisplay(item); return `<article class="radio-station-node ${radioSignalClass(item.signal)}"><button class="open-inventory-host radio-station-main" data-id="${escapeHtml(item.id)}"><span class="radio-node-icon">ST</span><span><b>${escapeHtml(item.name || item.ip)}</b><small class="ltr mono">${escapeHtml(item.ip)}</small><em>${escapeHtml(item.ssid || "SSID نامشخص")}</em></span><span class="radio-health"><span class="monitor-pill ${monitor.className}">${escapeHtml(monitor.label)}</span><small class="radio-signal">${escapeHtml(item.signal || "—")}</small></span></button>${normalizedConnectionMethods(item).length ? `<button class="radio-tools radio-node-tool" data-id="${escapeHtml(item.id)}">اتصال</button>` : ""}</article>`; };
  const listStation = (item) => { const monitor = monitorDisplay(item); return `<div class="radio-station"><span class="status-dot ${monitor.className === "online" ? "online" : "unknown"}"></span><button class="open-inventory-host radio-list-main" data-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.name || item.ip)}</b><small class="ltr mono">${escapeHtml(item.ip)}</small></button><span class="monitor-pill ${monitor.className}">${escapeHtml(monitor.label)}</span>${normalizedConnectionMethods(item).length ? `<button class="btn sm radio-tools" data-id="${escapeHtml(item.id)}">اتصال</button>` : ""}</div>`; };
  const treeCards = aps.map((ap) => {
    const children = stations.filter((item) => item.radioParentHostId === ap.id);
    const monitor = monitorDisplay(ap);
    return `<article class="radio-tree-card"><div class="radio-tree-card-head"><div><h3>${escapeHtml(ap.name || ap.ip)}</h3><div class="radio-health"><span class="mono ltr">${escapeHtml(ap.ip)}</span><span class="monitor-pill ${monitor.className}">${escapeHtml(monitor.label)}</span></div></div><div class="row-actions"><button class="btn sm radio-add-station" data-id="${escapeHtml(ap.id)}">افزودن Station</button>${normalizedConnectionMethods(ap).length ? `<button class="btn sm radio-tools" data-id="${escapeHtml(ap.id)}">اتصال</button>` : ""}</div></div><div class="radio-tree-scroll"><div class="radio-tree-canvas"><button class="radio-ap-node open-inventory-host" data-id="${escapeHtml(ap.id)}"><span class="radio-node-icon ap">AP</span><span><b>${escapeHtml(ap.name || ap.ip)}</b><small class="ltr mono">${escapeHtml(ap.ip)}</small><em>${escapeHtml(ap.ssid || "SSID تعریف نشده")}</em></span><span class="radio-ap-meta">${escapeHtml(ap.frequency || "—")}<br>${escapeHtml(ap.channel || "—")}</span></button>${children.length ? `<div class="radio-tree-stem"></div><div class="radio-station-branches">${children.map((item) => `<div class="radio-branch"><i></i>${stationNode(item)}</div>`).join("")}</div>` : `<div class="radio-empty-branch"><span>Station متصل ثبت نشده است.</span><button class="btn sm primary radio-add-station" data-id="${escapeHtml(ap.id)}">اتصال اولین Station</button></div>`}</div></div></article>`;
  }).join("");
  const listCards = aps.map((ap) => {
    const children = stations.filter((item) => item.radioParentHostId === ap.id);
    return `<article class="radio-ap-card"><div class="radio-ap-head"><button class="open-inventory-host radio-title" data-id="${escapeHtml(ap.id)}"><span class="radio-icon">AP</span><div><h3>${escapeHtml(ap.name || ap.ip)}</h3><p><span class="mono ltr">${escapeHtml(ap.ip)}</span> — ${escapeHtml(ap.ssid || "SSID تعریف نشده")}</p></div></button><div class="row-actions"><button class="btn sm radio-add-station" data-id="${escapeHtml(ap.id)}">افزودن Station</button>${normalizedConnectionMethods(ap).length ? `<button class="btn sm radio-tools" data-id="${escapeHtml(ap.id)}">اتصال</button>` : ""}</div></div><div class="radio-meta"><span>فرکانس: <b>${escapeHtml(ap.frequency || "—")}</b></span><span>کانال: <b>${escapeHtml(ap.channel || "—")}</b></span><span>کلاینت: <b>${formatNumber(children.length)}</b></span></div><div class="radio-children">${children.map(listStation).join("") || `<div class="empty-state compact-empty">Station متصل ثبت نشده است.</div>`}</div></article>`;
  }).join("");
  const orphans = stations.filter((item) => !aps.some((ap) => ap.id === item.radioParentHostId));
  const parentOptions = aps.map((ap) => `<option value="${escapeHtml(ap.id)}">${escapeHtml(ap.name || ap.ip)} — ${escapeHtml(ap.ssid || "بدون SSID")} — ${escapeHtml(ap.ip)}</option>`).join("");
  const radioContent = state.radioViewMode === "tree" ? `<section class="radio-tree-grid">${treeCards || `<div class="panel empty-state">هنوز رادیویی با حالت AP ثبت نشده است.</div>`}</section>` : `<section class="radio-grid">${listCards || `<div class="panel empty-state">هنوز رادیویی با حالت AP ثبت نشده است.</div>`}</section>`;
  page.innerHTML = `<div class="headline"><div><div class="crumb">مدیریت تجهیزات</div><h2>رادیوها و ارتباط AP / Station</h2><div class="subtitle">اطلاعات ثبت‌شده و اتصال دستی؛ سامانه در نبود کاربر هیچ پایش خودکاری انجام نمی‌دهد.</div></div><div class="head-actions"><div class="segmented"><button class="radio-view-mode ${state.radioViewMode === "tree" ? "active" : ""}" data-mode="tree">نمای درختی</button><button class="radio-view-mode ${state.radioViewMode === "list" ? "active" : ""}" data-mode="list">نمای فهرست</button></div></div></div><section class="panel radio-register-panel"><div class="radio-register-title"><div><b>ثبت سریع رادیو و اتصال</b><small>IP را وارد کنید؛ فرم همان IP با حالت رادیو و AP انتخاب‌شده باز می‌شود.</small></div><button id="newApShortcut" class="btn sm">ثبت AP جدید</button></div><div class="radio-register-form"><input id="radioQuickIp" class="ltr mono" placeholder="192.168.1.11"><select id="radioQuickMode"><option value="ap">AP</option><option value="station">Station</option></select><input id="radioQuickParentSearch" class="hidden" placeholder="جست‌وجوی AP…"><select id="radioQuickParent" class="hidden"><option value="">انتخاب AP</option>${parentOptions}</select><button id="radioQuickOpen" class="btn primary">ادامه و تکمیل اطلاعات</button></div></section><section class="stats"><div class="stat"><div class="label">کل رادیوها</div><div class="value">${formatNumber(radios.length)}</div></div><div class="stat"><div class="label">Access Point</div><div class="value">${formatNumber(aps.length)}</div></div><div class="stat"><div class="label">Station</div><div class="value">${formatNumber(stations.length)}</div></div><div class="stat"><div class="label">پایش خودکار</div><div class="value">خاموش</div></div></section>${radioContent}${orphans.length ? `<section class="panel orphan-panel"><div class="section-title"><h3>Stationهای بدون AP مشخص</h3><span class="subtitle">برای اتصال، روی رکورد کلیک کنید یا از فرم سریع بالا استفاده کنید.</span></div><div class="radio-orphan-grid">${orphans.map(stationNode).join("")}</div></section>` : ""}`;
  const syncQuickMode = () => {
    const hidden = $("radioQuickMode").value !== "station";
    $("radioQuickParentSearch").classList.toggle("hidden", hidden);
    $("radioQuickParent").classList.toggle("hidden", hidden);
  };
  const filterQuickParents = (selected = $("radioQuickParent").value) => {
    const query = $("radioQuickParentSearch").value.trim().toLowerCase();
    const matches = aps.filter((item) => !query || [item.name, item.ip, item.ssid, item.mac, item.companyName, item.spaceName].some((value) => String(value || "").toLowerCase().includes(query)));
    $("radioQuickParent").innerHTML = `<option value="">انتخاب AP — ${formatNumber(matches.length)} نتیجه</option>${matches.map((ap) => `<option value="${escapeHtml(ap.id)}" ${ap.id === selected ? "selected" : ""}>${escapeHtml(ap.name || ap.ip)} — ${escapeHtml(ap.ssid || "بدون SSID")} — ${escapeHtml(ap.ip)}</option>`).join("")}`;
  };
  $("radioQuickMode").addEventListener("change", syncQuickMode);
  $("radioQuickParentSearch").addEventListener("input", () => filterQuickParents());
  $("radioQuickOpen").addEventListener("click", () => quickOpenRadio($("radioQuickIp").value, $("radioQuickMode").value, $("radioQuickParent").value));
  $("radioQuickIp").addEventListener("keydown", (event) => { if (event.key === "Enter") quickOpenRadio(event.currentTarget.value, $("radioQuickMode").value, $("radioQuickParent").value); });
  $("newApShortcut").addEventListener("click", () => { $("radioQuickMode").value = "ap"; syncQuickMode(); $("radioQuickIp").focus(); });
  page.querySelectorAll(".radio-view-mode").forEach((node) => node.addEventListener("click", () => { state.radioViewMode = node.dataset.mode; localStorage.setItem("ems-radio-view-mode", state.radioViewMode); renderRadios(); }));
  page.querySelectorAll(".radio-add-station").forEach((node) => node.addEventListener("click", () => { $("radioQuickMode").value = "station"; $("radioQuickParentSearch").value = ""; filterQuickParents(node.dataset.id); syncQuickMode(); $("radioQuickIp").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  page.querySelectorAll(".open-inventory-host").forEach((node) => node.addEventListener("click", () => openInventoryItem(state.inventory.find((item) => item.id === node.dataset.id))));
  page.querySelectorAll(".radio-tools").forEach((node) => node.addEventListener("click", (event) => {
    const item = state.inventory.find((entry) => entry.id === node.dataset.id);
    if (item) openToolMenu(event, item.ip);
  }));
}

async function openTopologyPage(force = false, { fromRoute = false } = {}) {
  try {
    const [mapsResult] = await Promise.all([request("/api/maps"), ensureInventory(force)]);
    state.maps = mapsResult.items || [];
    if (!state.maps.some((item) => item.id === state.currentMapId)) state.currentMapId = state.maps[0]?.id || null;
    state.mapData = state.currentMapId ? await request(`/api/maps/${encodeURIComponent(state.currentMapId)}/data`) : null;
    state.view = "topology";
    state.currentSpaceId = null;
    state.data = null;
    state.linkSelection = [];
    updateSelectors();
    document.querySelectorAll(".navbtn").forEach((node) => node.classList.remove("active"));
    if (!fromRoute) setRoute("/topology");
    renderTopology();
  } catch (error) { toast(error.message); }
}

function topologyIcon(type, radioMode) {
  if (radioMode === "ap") return "AP";
  if (radioMode === "station") return "ST";
  if (type === "روتر") return "R";
  if (type === "سوئیچ") return "SW";
  if (type === "فایروال") return "FW";
  if (type === "سرور" || type === "ماشین مجازی") return "SRV";
  return "IP";
}

function renderTopology() {
  const map = state.mapData?.map;
  const canEditMap = Boolean(map && canManageCompany(map.companyId));
  const nodes = state.mapData?.nodes || [];
  const links = state.mapData?.links || [];
  const nodeMap = new Map(nodes.map((item) => [item.id, item]));
  const lines = links.map((link) => {
    const from = nodeMap.get(link.fromNodeId); const to = nodeMap.get(link.toNodeId);
    if (!from || !to) return "";
    const x1 = from.x + from.width / 2; const y1 = from.y + from.height / 2; const x2 = to.x + to.width / 2; const y2 = to.y + to.height / 2;
    const label = link.label || [link.fromPortName, link.toPortName].filter(Boolean).join(" ↔ ") || link.speed || link.medium;
    return `<g class="topology-link-group" data-id="${escapeHtml(link.id)}"><line class="topology-link" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeHtml(link.color)}"></line><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}">${escapeHtml(label)}</text></g>`;
  }).join("");
  const cards = nodes.map((node) => `<article class="topology-node" data-id="${escapeHtml(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px"><button class="node-drag" type="button" title="جابه‌جایی">⠿</button><button class="node-main node-open" data-id="${escapeHtml(node.id)}"><span class="node-icon">${topologyIcon(node.type, node.radioMode)}</span><span><b>${escapeHtml(node.name || node.ip)}</b><small class="mono ltr">${escapeHtml(node.ip)}</small></span></button><div class="node-actions">${normalizedConnectionMethods(node).length ? `<button class="node-connect" data-id="${escapeHtml(node.id)}" title="اتصال">↗</button>` : ""}${canEditMap ? `<button class="node-link" data-id="${escapeHtml(node.id)}" title="ساخت لینک">⌁</button><button class="node-remove" data-id="${escapeHtml(node.id)}" title="حذف از نقشه">×</button>` : ""}</div></article>`).join("");
  const mapOptions = state.maps.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.currentMapId ? "selected" : ""}>${escapeHtml(item.name)} — ${escapeHtml(item.companyName || "")}</option>`).join("");
  page.innerHTML = `<div class="headline"><div><div class="crumb">مدیریت تصویری شبکه</div><h2>نقشه اتصال تجهیزات و پورت‌ها</h2><div class="subtitle">هر گره به همان IP و دستگاه ثبت‌شده در سامانه متصل است.</div></div><div class="head-actions">${state.maps.length ? `<select id="mapSelect" class="map-select">${mapOptions}</select>` : ""}${(state.bootstrap.fullCompanyIds || []).length ? `<button id="addMapButton" class="btn">نقشه جدید</button>` : ""}${canEditMap ? `<button id="editMapButton" class="btn">ویرایش نقشه</button><button id="addMapNodeButton" class="btn primary">افزودن تجهیز</button><button id="deleteMapButton" class="btn danger">حذف نقشه</button>` : ""}</div></div>${map ? `<section class="panel topology-panel"><div class="topology-toolbar"><div><b>${escapeHtml(map.name)}</b><span>${escapeHtml(map.description || map.companyName || "")}</span></div><div class="legend"><span><i class="dot used"></i>برای اتصال، دکمه زنجیر دو تجهیز را بزنید.</span></div></div><div class="topology-scroll"><div class="topology-canvas"><svg class="topology-svg" width="1800" height="900">${lines}</svg>${cards}</div></div></section>` : `<section class="panel empty-state">هنوز نقشه‌ای ساخته نشده است.${(state.bootstrap.fullCompanyIds || []).length ? " با دکمه «نقشه جدید» شروع کنید." : ""}</section>`}`;
  $("mapSelect")?.addEventListener("change", async (event) => { state.currentMapId = event.target.value; state.mapData = await request(`/api/maps/${encodeURIComponent(state.currentMapId)}/data`); renderTopology(); });
  $("addMapButton")?.addEventListener("click", () => openMapDialog());
  $("editMapButton")?.addEventListener("click", () => openMapDialog(map));
  $("addMapNodeButton")?.addEventListener("click", openMapNodeDialog);
  $("deleteMapButton")?.addEventListener("click", async () => {
    if (!confirm(`نقشه «${map.name}» حذف شود؟ اطلاعات IP و تجهیزات حذف نمی‌شود.`)) return;
    try { await request(`/api/maps/${encodeURIComponent(map.id)}`, { method: "DELETE" }); state.currentMapId = null; await openTopologyPage(true); toast("نقشه حذف شد."); } catch (error) { toast(error.message); }
  });
  page.querySelectorAll(".node-open").forEach((button) => button.addEventListener("click", () => {
    const node = nodeMap.get(button.dataset.id); openInventoryItem(state.inventory.find((item) => item.id === node?.hostId));
  }));
  page.querySelectorAll(".node-connect").forEach((button) => button.addEventListener("click", (event) => {
    const node = nodeMap.get(button.dataset.id); if (node) openToolMenu(event, node.ip);
  }));
  page.querySelectorAll(".node-link").forEach((button) => button.addEventListener("click", () => {
    if (!state.linkSelection.includes(button.dataset.id)) state.linkSelection.push(button.dataset.id);
    button.closest(".topology-node").classList.add("link-selected");
    if (state.linkSelection.length === 2) openMapLinkDialog();
    else toast("حالا دکمه اتصال تجهیز دوم را انتخاب کنید.");
  }));
  page.querySelectorAll(".node-remove").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("این تجهیز از نقشه حذف شود؟ رکورد IP باقی می‌ماند.")) return;
    try { await request(`/api/maps/${encodeURIComponent(map.id)}/nodes/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" }); await openTopologyPage(true); } catch (error) { toast(error.message); }
  }));
  page.querySelectorAll(".topology-link-group").forEach((group) => group.addEventListener("click", () => {
    if (!canEditMap) return;
    openMapLinkDialog(links.find((item) => item.id === group.dataset.id));
  }));
  enableTopologyDrag(map);
}

function enableTopologyDrag(map) {
  if (!map || !canManageCompany(map.companyId)) return;
  page.querySelectorAll(".topology-node").forEach((node) => {
    const handle = node.querySelector(".node-drag");
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const startX = event.clientX; const startY = event.clientY; const originX = parseInt(node.style.left, 10); const originY = parseInt(node.style.top, 10);
      handle.setPointerCapture(event.pointerId); node.classList.add("dragging");
      const move = (moveEvent) => { node.style.left = `${Math.max(0, originX + moveEvent.clientX - startX)}px`; node.style.top = `${Math.max(0, originY + moveEvent.clientY - startY)}px`; };
      const up = async () => {
        handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); node.classList.remove("dragging");
        try { await request(`/api/maps/${encodeURIComponent(map.id)}/nodes/${encodeURIComponent(node.dataset.id)}`, { method: "PUT", body: { x: parseInt(node.style.left, 10), y: parseInt(node.style.top, 10) } }); state.mapData = await request(`/api/maps/${encodeURIComponent(map.id)}/data`); renderTopology(); } catch (error) { toast(error.message); }
      };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
    });
  });
}

function openMapDialog(item = null) {
  $("mapForm").reset(); $("mapId").value = item?.id || "";
  const allowed = new Set(state.bootstrap.fullCompanyIds || []);
  $("mapCompany").innerHTML = state.bootstrap.companies.filter((company) => allowed.has(company.id)).map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`).join("");
  $("mapCompany").value = item?.companyId || state.currentCompanyId || state.bootstrap.companies[0]?.id || "";
  $("mapCompany").disabled = Boolean(item); $("mapName").value = item?.name || ""; $("mapDescription").value = item?.description || ""; $("mapDialog").showModal();
}

function openMapNodeDialog() {
  if (!state.mapData?.map) return;
  const existing = new Set(state.mapData.nodes.map((item) => item.hostId));
  const items = state.inventory.filter((item) => item.companyId === state.mapData.map.companyId && !existing.has(item.id));
  $("mapNodeHost").innerHTML = items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.ip)} — ${escapeHtml(item.ip)} — ${escapeHtml(item.type || "تجهیز")}</option>`).join("");
  if (!items.length) return toast("همه تجهیزات این شرکت روی نقشه قرار گرفته‌اند یا هنوز تجهیزی ثبت نشده است.");
  $("mapNodeDialog").showModal();
}

function openMapLinkDialog(existing = null) {
  if (existing) state.linkSelection = [existing.fromNodeId, existing.toNodeId];
  const [fromNode, toNode] = state.linkSelection.map((id) => state.mapData.nodes.find((item) => item.id === id));
  if (!fromNode || !toNode) { state.linkSelection = []; return; }
  const fromHost = state.inventory.find((item) => item.id === fromNode.hostId); const toHost = state.inventory.find((item) => item.id === toNode.hostId);
  const options = (ports) => `<option value="">بدون انتخاب</option>${(ports || []).map((port) => `<option value="${escapeHtml(port.id)}">${escapeHtml(port.name)}${port.description ? ` — ${escapeHtml(port.description)}` : ""}</option>`).join("")}`;
  $("mapLinkTitle").textContent = `${fromNode.name || fromNode.ip} ↔ ${toNode.name || toNode.ip}`;
  $("mapFromPort").innerHTML = options(fromHost?.devicePorts); $("mapToPort").innerHTML = options(toHost?.devicePorts);
  $("mapLinkForm").reset(); $("mapLinkId").value = existing?.id || ""; $("mapFromPort").value = existing?.fromPortId || ""; $("mapToPort").value = existing?.toPortId || ""; $("mapLinkMedium").value = existing?.medium || "ethernet"; $("mapLinkSpeed").value = existing?.speed || ""; $("mapLinkVlan").value = existing?.vlan || ""; $("mapLinkLabel").value = existing?.label || ""; $("mapLinkColor").value = existing?.color || "#64748b"; $("deleteMapLink").classList.toggle("hidden", !existing); $("mapLinkDialog").showModal();
}

async function refreshBackups() {
  const result = await request("/api/backups");
  $("backupPath").textContent = result.path;
  $("backupEnabled").checked = result.settings?.enabled !== false;
  $("backupIntervalDays").value = result.settings?.intervalDays || 1;
  $("backupHour").value = result.settings?.hour ?? 2;
  $("backupRetentionDays").value = result.settings?.retentionDays || 30;
  $("backupNextRun").textContent = result.nextRunAt ? new Date(result.nextRunAt).toLocaleString("fa-IR") : "غیرفعال";
  markFormClean($("backupSettingsForm"));
  $("backupsList").innerHTML = (result.items || []).map((item) => `<div class="backup-row"><div><b class="ltr mono">${escapeHtml(item.name)}</b><small>${new Date(item.createdAt).toLocaleString("fa-IR")} — ${formatNumber(Math.ceil(item.size / 1024))} KB</small></div><div class="row-actions"><a class="btn sm" href="/api/backups/${encodeURIComponent(item.name)}/download">دانلود</a><button class="btn sm danger delete-backup" data-name="${escapeHtml(item.name)}">حذف</button></div></div>`).join("") || `<div class="empty-state">هنوز فایل پشتیبانی وجود ندارد.</div>`;
  $("backupsList").querySelectorAll(".delete-backup").forEach((node) => node.addEventListener("click", async () => {
    if (!confirm("این فایل پشتیبان حذف شود؟")) return;
    try { await request(`/api/backups/${encodeURIComponent(node.dataset.name)}`, { method: "DELETE" }); await refreshBackups(); } catch (error) { toast(error.message); }
  }));
}

async function openBackupsDialog() {
  $("backupsDialog").showModal();
  try { await refreshBackups(); } catch (error) { toast(error.message); }
}

function openSettingsDialog() {
  if ($("appearanceTheme")) $("appearanceTheme").value = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  if ($("settingsModulesList")) {
    const modules = Array.isArray(state.bootstrap?.modules) ? state.bootstrap.modules : [];
    $("settingsModulesList").innerHTML = modules.length ? modules.map((item) => `<div class="user-row"><div><b>${escapeHtml(item.name || item.id)}</b><small>${escapeHtml(item.description || item.id)}</small></div><span class="status-pill">v${escapeHtml(item.version || "0.0.0")}</span></div>`).join("") : `<div class="empty-state compact-empty">فعلاً افزونه‌ای نصب نشده است. Core + IPAM مستقل فعال است.</div>`;
  }
  $("toolsSettings").innerHTML = state.bootstrap.tools.map((tool) => `<div class="tool-setting" data-tool="${escapeHtml(tool.tool)}"><b style="color:${escapeHtml(tool.color)}">${escapeHtml(tool.tool)}</b><input class="tool-label" value="${escapeHtml(tool.label)}"><input class="tool-port" type="number" min="0" max="65535" value="${escapeHtml(tool.defaultPort)}"><input class="tool-color" type="color" value="${escapeHtml(tool.color)}"></div>`).join("");
  if ($("settingsVersion")) $("settingsVersion").textContent = state.bootstrap?.version || "";
  document.querySelectorAll(".settings-tab").forEach((node, index) => node.classList.toggle("active", index === 0));
  document.querySelectorAll(".settings-pane").forEach((node, index) => node.classList.toggle("active", index === 0));
  $("settingsDialog").showModal();
}

function syncImportSpaces() {
  const companyId = $("importCompany").value;
  const spaces = state.bootstrap.spaces.filter((item) => item.companyId === companyId);
  $("importSpace").innerHTML = spaces.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} — ${escapeHtml(item.cidr)}</option>`).join("");
}

function openImportDialog() {
  $("importForm").reset();
  state.importPackage = null;
  const companies = state.bootstrap.companies.filter((item) => canManageCompany(item.id));
  $("importCompany").innerHTML = companies.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  $("importCompany").value = companies.some((item) => item.id === state.currentCompanyId) ? state.currentCompanyId : companies[0]?.id || "";
  syncImportSpaces();
  $("importFileSummary").textContent = "هنوز فایلی انتخاب نشده است.";
  markFormClean($("importForm"));
  $("importDialog").showModal();
}

async function openTrashDialog() {
  if (!$("trashDialog").open) $("trashDialog").showModal();
  try {
    const result = await request("/api/trash");
    const labels = { company: "شرکت", space: "رنج اصلی", prefix: "زیرشبکه", host: "تجهیز / IP" };
    $("trashList").innerHTML = (result.items || []).map((item) => `<div class="trash-row"><b>${labels[item.kind] || item.kind}</b><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.companyName || "")}</small></div><small>${new Date(item.deletedAt).toLocaleString("fa-IR")}</small><div class="row-actions"><button class="btn sm restore-trash" data-kind="${item.kind}" data-id="${escapeHtml(item.id)}">بازگردانی</button><button class="btn sm danger purge-trash" data-kind="${item.kind}" data-id="${escapeHtml(item.id)}">حذف نهایی</button></div></div>`).join("") || `<div class="empty-state">سطل بازیافت خالی است.</div>`;
    $("trashList").querySelectorAll(".restore-trash").forEach((node) => node.addEventListener("click", async () => { try { await request(`/api/trash/${node.dataset.kind}/${encodeURIComponent(node.dataset.id)}`, { method: "POST" }); state.bootstrap = await request("/api/bootstrap"); await openTrashDialog(); toast("اطلاعات بازگردانده شد."); } catch (error) { toast(error.message); } }));
    $("trashList").querySelectorAll(".purge-trash").forEach((node) => node.addEventListener("click", async () => { if (!confirm("این مورد برای همیشه حذف شود؟")) return; try { await request(`/api/trash/${node.dataset.kind}/${encodeURIComponent(node.dataset.id)}`, { method: "DELETE" }); await openTrashDialog(); toast("حذف نهایی انجام شد."); } catch (error) { toast(error.message); } }));
  } catch (error) { toast(error.message); }
}

function openAboutDialog() {
  $("aboutVersion").textContent = state.bootstrap?.version || "";
  $("aboutDialog").showModal();
}

function openMikrotikScriptDialog() {
  $("mikrotikScriptForm").reset();
  $("scriptTransport").value = "mikrotik-api";
  $("scriptUsername").value = "ems-ipam";
  $("scriptPassword").value = "";
  $("scriptPort").value = 8728;
  $("scriptOutput").value = "";
  updateMonitorDriverUi({ script: true });
  markFormClean($("mikrotikScriptForm"));
  $("mikrotikScriptDialog").showModal();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#toolMenu") && !event.target.closest(".ping-dot") && !event.target.closest(".table-connect-button")) $("toolMenu").classList.add("hidden");
  if (!event.target.closest(".searchbox")) $("searchResults").classList.add("hidden");
});

document.querySelectorAll("dialog form").forEach((form) => form.addEventListener("input", () => { form.dataset.dirty = "1"; }));
document.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => {
  const dialog = node.closest("dialog");
  const form = dialog.querySelector("form");
  if (form?.dataset.dirty === "1" && !confirm("تغییرات ذخیره نشده است. بدون ذخیره خارج می‌شوید؟")) return;
  markFormClean(form);
  dialog.close();
}));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("cancel", (event) => {
  const form = dialog.querySelector("form");
  if (form?.dataset.dirty === "1" && !confirm("تغییرات ذخیره نشده است. بدون ذخیره خارج می‌شوید؟")) event.preventDefault();
  else markFormClean(form);
}));
window.addEventListener("beforeunload", (event) => {
  if ([...document.querySelectorAll("dialog[open] form")].some((form) => form.dataset.dirty === "1")) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("popstate", () => renderRoute().catch((error) => toast(error.message)));

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("loginError").classList.add("hidden");
  try {
    await request("/api/auth/login", { method: "POST", body: { username: $("loginUsername").value, password: $("loginPassword").value } });
    $("loginPassword").value = ""; await boot();
  } catch (error) { $("loginError").textContent = error.message; $("loginError").classList.remove("hidden"); }
});

$("logoutButton").addEventListener("click", async () => { $("userMenu").classList.add("hidden"); await request("/api/auth/logout", { method: "POST" }); state.events?.close(); state.bootstrap = null; state.data = null; setLoginVisible(true); });
$("homeButton").addEventListener("click", () => renderCompanies());
$("companiesButton").addEventListener("click", () => renderCompanies());
$("ipamButton").addEventListener("click", () => {
  const target = state.currentSpaceId || state.bootstrap.spaces.find((item) => !state.currentCompanyId || item.companyId === state.currentCompanyId)?.id;
  if (target) loadSpace(target); else toast("ابتدا برای یک شرکت رنج اصلی تعریف کنید.");
});
$("inventoryButton").addEventListener("click", () => openInventoryPage(true));
$("radiosButton").addEventListener("click", () => openRadiosPage(true));
$("networkMapButton").addEventListener("click", () => { window.location.href = "/network-map/"; });
$("topologyButton").addEventListener("click", () => { window.location.href = "/network-map/"; });
$("backupsButton").addEventListener("click", openBackupsDialog);
$("trashButton").addEventListener("click", openTrashDialog);
$("importButton").addEventListener("click", openImportDialog);
$("aboutButton").addEventListener("click", openAboutDialog);
$("themeButton").addEventListener("click", toggleTheme);
$("themeButton").textContent = savedTheme === "dark" ? "☀" : "☾";
$("userMenuButton").addEventListener("click", () => { const menu = $("userMenu"); const show = menu.classList.contains("hidden"); menu.classList.toggle("hidden", !show); $("userMenuButton").setAttribute("aria-expanded", show ? "true" : "false"); });
document.addEventListener("click", (event) => { if (!$("userMenuButton").contains(event.target) && !$("userMenu").contains(event.target)) $("userMenu").classList.add("hidden"); });
document.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("searchInput").focus(); $("searchInput").select(); } });
$("searchInput").addEventListener("keydown", async (event) => { if (event.key === "ArrowDown") { event.preventDefault(); activateSearchResult(state.searchIndex + 1); } else if (event.key === "ArrowUp") { event.preventDefault(); activateSearchResult(state.searchIndex <= 0 ? 0 : state.searchIndex - 1); } else if (event.key === "Enter" && state.searchIndex >= 0) { event.preventDefault(); await chooseSearchItem(state.searchItems[state.searchIndex]); } else if (event.key === "Escape") { $("searchResults").classList.add("hidden"); } });
$("companySelect").addEventListener("change", (event) => {
  state.currentCompanyId = event.target.value;
  localStorage.setItem("ems-company", state.currentCompanyId);
  if (state.view === "inventory") renderInventory();
  else if (state.view === "radios") renderRadios();
  else if (state.currentCompanyId) openCompanyPage(state.currentCompanyId);
  else renderCompanies();
});
$("spaceSelect").addEventListener("change", (event) => event.target.value ? loadSpace(event.target.value) : (state.currentCompanyId ? openCompanyPage(state.currentCompanyId) : renderCompanies()));
$("searchInput").addEventListener("input", (event) => doSearch(event.target.value));
$("usersButton").addEventListener("click", openUsersDialog);
$("settingsButton").addEventListener("click", openSettingsDialog);
$("openUsersFromSettings").addEventListener("click", () => { $("settingsDialog").close(); openUsersDialog(); });
$("openPersonnelFromSettings").addEventListener("click", () => { $("settingsDialog").close(); openPersonnelDialog(); });
$("openBackupsFromSettings").addEventListener("click", () => { $("settingsDialog").close(); openBackupsDialog(); });
$("applyAppearance").addEventListener("click", () => { applyTheme($("appearanceTheme").value); toast("تنظیم ظاهر اعمال شد."); });
document.querySelectorAll(".settings-tab").forEach((node) => node.addEventListener("click", () => { document.querySelectorAll(".settings-tab").forEach((n) => n.classList.toggle("active", n === node)); document.querySelectorAll(".settings-pane").forEach((pane) => pane.classList.toggle("active", pane.dataset.settingsPane === node.dataset.settingsTab)); }));
$("exportButton").addEventListener("click", () => state.currentSpaceId ? window.location.assign(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/export`) : toast("ابتدا یک رنج اصلی را باز کنید."));

$("companyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("companyId").value;
  const body = { parentCompanyId: $("companyParent").value || null, kind: $("companyKind").value, code: $("companyCode").value, name: $("companyName").value, managerName: $("companyManager").value, phone: $("companyPhone").value, postalCode: $("companyPostalCode").value, address: $("companyAddress").value, latitude: $("companyLatitude").value, longitude: $("companyLongitude").value, description: $("companyDescription").value, notes: $("companyNotes").value, contacts: collectCompanyContacts(), connections: collectCompanyConnections() };
  try { const result = await request(id ? `/api/companies/${encodeURIComponent(id)}` : "/api/companies", { method: id ? "PUT" : "POST", body }); markFormClean(event.currentTarget); $("companyDialog").close(); state.bootstrap = await request("/api/bootstrap"); state.currentCompanyId = id || result.id; updateSelectors(); await openCompanyPage(state.currentCompanyId); toast(id ? "اطلاعات شرکت ویرایش شد." : "شرکت اضافه شد."); } catch (error) { toast(error.message); }
});

$("addCompanyContact").addEventListener("click", () => { const items = collectCompanyContacts(); items.push({}); renderCompanyContacts(items); $("companyForm").dataset.dirty = "1"; });
$("addCompanyConnection").addEventListener("click", () => { const items = collectCompanyConnections(); items.push({}); renderCompanyConnections(items); $("companyForm").dataset.dirty = "1"; });

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

$("exportPrefixButton").addEventListener("click", () => {
  const id = $("prefixId").value;
  if (id) window.location.assign(`/api/prefixes/${encodeURIComponent(id)}/export`);
});

$("hostForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ports = {};
  $("hostPorts").querySelectorAll(".host-port").forEach((node) => { if (node.value !== "") ports[node.dataset.tool] = Number(node.value); });
  const body = {
    id: $("hostId").value || undefined,
    spaceId: state.currentSpaceId,
    ip: $("hostIp").value,
    name: $("hostName").value,
    status: $("hostStatus").value,
    type: $("hostType").value,
    os: $("hostOs").value,
    mac: $("hostMac").value,
    vlan: $("hostVlan").value,
    username: $("hostUsername").value,
    owner: $("hostOwner").value,
    location: $("hostLocation").value,
    vendor: $("hostVendor").value,
    model: $("hostModel").value,
    serial: $("hostSerial").value,
    firmware: $("hostFirmware").value,
    radioMode: $("hostRadioMode").value,
    ssid: $("hostSsid").value,
    frequency: $("hostFrequency").value,
    channel: $("hostChannel").value,
    signal: $("hostSignal").value,
    radioParentHostId: $("hostRadioParent").value || null,
    secretRef: $("hostSecretRef").value,
    notes: $("hostNotes").value,
    connectionMethods: collectHostConnections(),
    ports,
    devicePorts: collectDevicePorts(),
    customFields: collectHostCustomFields(),
  };
  try { await request("/api/hosts", { method: "PUT", body }); markFormClean(event.currentTarget); $("hostDialog").close(); state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`); await ensureInventory(true); renderCurrent(); toast("اطلاعات IP ذخیره شد؛ هیچ رمز تجهیزی نگهداری نشد."); } catch (error) { toast(error.message); }
});

$("addDevicePort").addEventListener("click", () => appendDevicePort());
$("addHostCustomField").addEventListener("click", () => { addHostCustomFieldRow(); $("hostForm").dataset.dirty = "1"; });
$("hostRadioMode").addEventListener("change", () => updateRadioFields($("hostRadioParent").value));
$("hostRadioParentSearch").addEventListener("input", () => updateRadioFields($("hostRadioParent").value));
$("hostRadioParent").addEventListener("change", () => {
  const parent = state.inventory.find((item) => item.id === $("hostRadioParent").value);
  if (parent?.ssid) $("hostSsid").value = parent.ssid;
});
$("scriptTransport").addEventListener("change", () => updateMonitorDriverUi({ syncPort: true, script: true }));

function navigateHostFromDialog(button) {
  const ip = button.dataset.ip;
  if (!ip) return;
  if ($("hostForm").dataset.dirty === "1" && !confirm("تغییرات این IP ذخیره نشده است. بدون ذخیره به IP بعدی برویم؟")) return;
  markFormClean($("hostForm"));
  openHostDialog(ip);
}
$("prevHostButton").addEventListener("click", () => navigateHostFromDialog($("prevHostButton")));
$("nextHostButton").addEventListener("click", () => navigateHostFromDialog($("nextHostButton")));

$("deleteHostButton").addEventListener("click", async () => {
  if (!confirm("اطلاعات این IP حذف شود؟")) return;
  try { await request(`/api/hosts/${encodeURIComponent(state.currentSpaceId)}/${encodeURIComponent($("hostIp").value)}`, { method: "DELETE" }); $("hostDialog").close(); state.data = await request(`/api/spaces/${encodeURIComponent(state.currentSpaceId)}/data`); renderCurrent(); toast("اطلاعات IP حذف شد."); } catch (error) { toast(error.message); }
});

$("userRole").addEventListener("change", () => renderCompanyAccess(
  [...$("companyAccessList").querySelectorAll("input:checked")].map((node) => node.value),
  [...$("spaceAccessList").querySelectorAll("input:checked")].map((node) => node.value),
  [...$("moduleAccessList").querySelectorAll("input:checked")].map((node) => node.value),
));
$("cancelUserEdit").addEventListener("click", resetUserForm);
$("userForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("userId").value; const companyIds = [...$("companyAccessList").querySelectorAll("input:checked")].map((node) => node.value); const spaceIds = [...$("spaceAccessList").querySelectorAll("input:checked:not(:disabled)")].map((node) => node.value); const moduleIds = [...$("moduleAccessList").querySelectorAll("input:checked:not(:disabled)")].map((node) => node.value);
  const body = { username: $("userUsername").value, displayName: $("userDisplayName").value, password: $("userPassword").value, role: $("userRole").value, active: $("userActive").checked, companyIds, spaceIds, moduleIds };
  try { await request(id ? `/api/users/${encodeURIComponent(id)}` : "/api/users", { method: id ? "PUT" : "POST", body }); resetUserForm(); await refreshUsers(); toast("کاربر ذخیره شد."); } catch (error) { toast(error.message); }
});

$("settingsForm").addEventListener("submit", (event) => event.preventDefault());
$("saveToolsSettings").addEventListener("click", async () => {
  const tools = [...$("toolsSettings").querySelectorAll(".tool-setting")].map((node) => ({ tool: node.dataset.tool, label: node.querySelector(".tool-label").value, defaultPort: Number(node.querySelector(".tool-port").value), color: node.querySelector(".tool-color").value }));
  try { await request("/api/tools", { method: "PUT", body: { tools } }); state.bootstrap = await request("/api/bootstrap"); toast("تنظیمات ابزارهای IP ذخیره شد."); } catch (error) { toast(error.message); }
});

$("createBackupButton").addEventListener("click", async () => {
  const button = $("createBackupButton"); button.disabled = true; button.textContent = "در حال ساخت…";
  try { await request("/api/backups", { method: "POST" }); await refreshBackups(); toast("فایل پشتیبان ساخته شد."); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "ساخت پشتیبان جدید"; }
});

$("backupSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request("/api/backups/settings", { method: "PUT", body: { enabled: $("backupEnabled").checked, intervalDays: Number($("backupIntervalDays").value), hour: Number($("backupHour").value), retentionDays: Number($("backupRetentionDays").value) } });
    markFormClean(event.currentTarget); await refreshBackups(); toast("برنامه پشتیبان‌گیری خودکار ذخیره شد.");
  } catch (error) { toast(error.message); }
});

$("importCompany").addEventListener("change", syncImportSpaces);
$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  state.importPackage = null;
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== "EMS-IPAM-SUBNET" || Number(payload.formatVersion) !== 1) throw new Error("فایل انتخاب‌شده بسته معتبر EMS IPAM نیست.");
    state.importPackage = payload;
    $("importFileSummary").textContent = `${payload.source?.cidr || "رنج نامشخص"} — ${formatNumber(payload.summary?.prefixes || payload.prefixes?.length || 0)} زیرشبکه، ${formatNumber(payload.summary?.hosts || payload.hosts?.length || 0)} تجهیز`;
  } catch (error) { event.target.value = ""; $("importFileSummary").textContent = error.message; toast(error.message); }
});
$("importForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.importPackage) return toast("ابتدا فایل بسته معتبر را انتخاب کنید.");
  const button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "در حال ورود…";
  try {
    const response = await request("/api/imports/subnet", { method: "POST", body: { destinationSpaceId: $("importSpace").value, mode: $("importMode").value, package: state.importPackage } });
    markFormClean(event.currentTarget); $("importDialog").close(); state.bootstrap = await request("/api/bootstrap"); await loadSpace($("importSpace").value); const r = response.result; toast(`${formatNumber(r.prefixesCreated + r.prefixesUpdated)} زیرشبکه و ${formatNumber(r.hostsCreated + r.hostsUpdated)} تجهیز وارد شد.`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "بررسی و ورود اطلاعات"; }
});

$("mikrotikScriptForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await request("/api/mikrotik/script", { method: "POST", body: { username: $("scriptUsername").value, password: $("scriptPassword").value, certificateName: $("scriptCertificate").value, port: Number($("scriptPort").value), transport: $("scriptTransport").value } });
    $("scriptOutput").value = result.script;
    $("scriptPassword").value = "";
    markFormClean(event.currentTarget); toast("اسکریپت آماده شد؛ رمز واردشده در فرم پاک شد.");
  } catch (error) { toast(error.message); }
});
$("copyMikrotikScript").addEventListener("click", async () => { if (!$("scriptOutput").value) return toast("ابتدا اسکریپت را بسازید."); await navigator.clipboard.writeText($("scriptOutput").value); toast("اسکریپت کپی شد."); });

$("mapForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("mapId").value;
  try {
    const result = await request(id ? `/api/maps/${encodeURIComponent(id)}` : "/api/maps", { method: id ? "PUT" : "POST", body: { companyId: $("mapCompany").value, name: $("mapName").value, description: $("mapDescription").value } });
    $("mapDialog").close(); state.currentMapId = id || result.id; await openTopologyPage(true); toast("نقشه ذخیره شد.");
  } catch (error) { toast(error.message); }
});

$("mapNodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const offset = state.mapData.nodes.length * 35;
    await request(`/api/maps/${encodeURIComponent(state.currentMapId)}/nodes`, { method: "POST", body: { hostId: $("mapNodeHost").value, x: 80 + (offset % 900), y: 90 + (offset % 500) } });
    $("mapNodeDialog").close(); await openTopologyPage(true); toast("تجهیز به نقشه اضافه شد.");
  } catch (error) { toast(error.message); }
});

$("mapLinkForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const [fromNodeId, toNodeId] = state.linkSelection; const id = $("mapLinkId").value;
  try {
    await request(id ? `/api/maps/${encodeURIComponent(state.currentMapId)}/links/${encodeURIComponent(id)}` : `/api/maps/${encodeURIComponent(state.currentMapId)}/links`, { method: id ? "PUT" : "POST", body: { fromNodeId, toNodeId, fromPortId: $("mapFromPort").value || null, toPortId: $("mapToPort").value || null, medium: $("mapLinkMedium").value, speed: $("mapLinkSpeed").value, vlan: $("mapLinkVlan").value, color: $("mapLinkColor").value, label: $("mapLinkLabel").value } });
    $("mapLinkDialog").close(); state.linkSelection = []; await openTopologyPage(true); toast("اتصال ثبت شد.");
  } catch (error) { toast(error.message); }
});

$("deleteMapLink").addEventListener("click", async () => {
  const id = $("mapLinkId").value;
  if (!id || !confirm("این اتصال از نقشه حذف شود؟")) return;
  try { await request(`/api/maps/${encodeURIComponent(state.currentMapId)}/links/${encodeURIComponent(id)}`, { method: "DELETE" }); $("mapLinkDialog").close(); state.linkSelection = []; await openTopologyPage(true); toast("اتصال حذف شد."); } catch (error) { toast(error.message); }
});

$("mapLinkDialog").addEventListener("close", () => { if (!$("mapLinkDialog").open) state.linkSelection = []; });

boot();

export { contains, intToIpv4, ipv4ToInt, networkAt, parseCidr };
