const $ = (id) => document.getElementById(id);
const state = {
  bootstrap: null,
  map: null,
  snapshot: null,
  snapshots: [],
  deletedSnapshots: [],
  positions: new Map(),
  zoom: 1,
  panX: 30,
  panY: 30,
  status: {},
  onlineTimer: null,
  activeJobId: "",
  jobTimer: null,
};

document.documentElement.dataset.theme = localStorage.getItem("ems-theme") || "dark";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("fa-IR").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove("show"), 3500);
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  if (options.method && options.method !== "GET") headers["X-EMS-CSRF"] = "1";
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.error || `خطای ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function canWrite(companyId = "") {
  const role = state.bootstrap?.user?.role;
  if (["admin", "technical", "editor"].includes(role)) return true;
  return false;
  if (!companyId) return (state.bootstrap?.companies || []).some((item) => item.manageable);
  return Boolean((state.bootstrap?.companies || []).find((item) => item.id === companyId)?.manageable);
}

function clearOnline() {
  clearInterval(state.onlineTimer);
  state.onlineTimer = null;
  state.status = {};
}

function clearCredentialFields(prefix) {
  for (const suffix of ["Username", "Password", "EnablePassword"]) {
    const node = $(`${prefix}${suffix}`);
    if (node) node.value = "";
  }
}

function fillSystemAccounts(prefix) {
  const select = $(`${prefix}SystemAccount`);
  if (!select) return;
  const accounts = state.bootstrap?.systemAccounts || [];
  select.innerHTML = `<option value="">ورود دستی</option>${accounts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.username)}${item.displayName ? ` — ${escapeHtml(item.displayName)}` : ""}</option>`).join("")}`;
}

function updateCredentialMode(prefix) {
  const systemAccount = $(`${prefix}SystemAccount`)?.value || "";
  const username = $(`${prefix}Username`);
  const password = $(`${prefix}Password`);
  if (username) { username.disabled = Boolean(systemAccount); username.required = !systemAccount; }
  if (password) { password.disabled = Boolean(systemAccount); password.required = !systemAccount; }
  const enable = $(`${prefix}EnablePassword`);
  if (enable) enable.disabled = Boolean(systemAccount);
}

async function boot() {
  try {
    state.bootstrap = await request("/api/network-map/bootstrap");
    renderHome();
  } catch (error) {
    if (error.status === 401) {
      $("page").innerHTML = `<section class="empty"><h2>ابتدا وارد سامانه شوید</h2><p>ورود از همان حساب مدیریت آی‌پی انجام می‌شود.</p><a class="btn primary" href="/">رفتن به صفحه ورود</a></section>`;
    } else $("page").innerHTML = `<section class="empty">${escapeHtml(error.message)}</section>`;
  }
}

function renderHome() {
  clearOnline();
  state.map = null;
  state.snapshot = null;
  const maps = state.bootstrap.maps || [];
  const totalDevices = maps.reduce((sum, item) => sum + Number(item.deviceCount || 0), 0);
  const trash = state.bootstrap.trash || [];
  $("page").innerHTML = `<div class="headline"><div><div class="crumb">سامانه EMS</div><h1>نقشه‌های شبکه</h1><p>هر بررسی به‌صورت یک نسخه تاریخی مستقل ذخیره می‌شود.</p></div>${canWrite() ? `<button id="newMapButton" class="btn primary">ایجاد نقشه جدید</button>` : ""}</div>
    <section class="stats"><article class="stat"><span>نقشه فعال</span><b>${formatNumber(maps.length)}</b></article><article class="stat"><span>سوئیچ در آخرین نسخه‌ها</span><b>${formatNumber(totalDevices)}</b></article><article class="stat"><span>نقشه حذف‌شده قابل بازیابی</span><b>${formatNumber(trash.length)}</b></article><article class="stat"><span>پایش خودکار</span><b>خاموش</b></article></section>
    <section class="map-grid">${maps.map((item) => `<button class="map-card" data-id="${escapeHtml(item.id)}"><div class="map-card-head"><span class="badge">${escapeHtml(item.companyName)}</span><span>نسخه ${formatNumber(item.version || 0)}</span></div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || "بدون توضیحات")}</p><div class="map-card-foot"><span>${formatNumber(item.deviceCount)} سوئیچ · ${formatNumber(item.linkCount)} اتصال</span><span>${formatDate(item.lastScanAt)}</span></div></button>`).join("") || `<div class="empty">هنوز نقشه‌ای ساخته نشده است.</div>`}</section>
    ${trash.length ? `<details class="trash"><summary>سطل بازیافت نقشه‌ها (${formatNumber(trash.length)})</summary>${trash.map((item) => `<div class="trash-row"><span><b>${escapeHtml(item.name)}</b><small> — ${escapeHtml(item.companyName)}</small></span>${item.manageable ? `<button class="btn sm restore-map" data-id="${escapeHtml(item.id)}">بازیابی</button>` : `<small>فقط مشاهده</small>`}</div>`).join("")}</details>` : ""}`;
  $("newMapButton")?.addEventListener("click", () => openScanDialog());
  document.querySelectorAll(".map-card").forEach((node) => node.addEventListener("click", () => openMap(node.dataset.id)));
  document.querySelectorAll(".restore-map").forEach((node) => node.addEventListener("click", async () => {
    try { await request(`/api/network-map/maps/${encodeURIComponent(node.dataset.id)}/restore`, { method: "POST" }); await reloadBootstrap(); toast("نقشه بازیابی شد."); }
    catch (error) { toast(error.message); }
  }));
}

async function reloadBootstrap() {
  state.bootstrap = await request("/api/network-map/bootstrap");
  renderHome();
}

function openScanDialog(existing = null) {
  const form = $("scanForm");
  form.reset();
  $("scanProtocol").value = "ssh";
  $("scanPort").value = "22";
  $("scanMaxDevices").value = "200";
  $("scanConnectTimeout").value = "30";
  $("scanCommandTimeout").value = "90";
  $("scanRetries").value = "2";
  $("scanConcurrency").value = "4";
  fillSystemAccounts("scan");
  $("scanSystemAccount").value = state.bootstrap?.systemAccounts?.[0]?.id || "";
  updateCredentialMode("scan");
  $("scanMapId").value = existing?.id || "";
  $("scanTitle").textContent = existing ? "ساخت نسخه جدید نقشه" : "ایجاد نقشه جدید";
  $("scanCompany").innerHTML = (state.bootstrap.companies || []).filter((item) => item.manageable).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  $("scanCompany").value = existing?.companyId || state.bootstrap.companies?.[0]?.id || "";
  $("scanName").value = existing?.name || "";
  $("scanDescription").value = existing?.description || "";
  $("scanCompany").disabled = Boolean(existing);
  $("scanName").disabled = Boolean(existing);
  $("scanDescription").disabled = Boolean(existing);
  $("scanSeedIp").value = existing && state.snapshot ? state.snapshot.seedIp : "";
  $("telnetWarning").classList.add("hidden");
  $("scanDialog").showModal();
  $("scanSeedIp").focus();
}

function scanBody(formPrefix, extra = {}) {
  const protocol = $(`${formPrefix}Protocol`).value;
  return {
    ...extra,
    systemAccountId: $(`${formPrefix}SystemAccount`)?.value || "",
    protocol,
    port: Number($(`${formPrefix}Port`).value || (protocol === "ssh" ? 22 : 23)),
    username: $(`${formPrefix}Username`).disabled ? "" : $(`${formPrefix}Username`).value,
    password: $(`${formPrefix}Password`).disabled ? "" : $(`${formPrefix}Password`).value,
    enablePassword: $(`${formPrefix}EnablePassword`).disabled ? "" : $(`${formPrefix}EnablePassword`).value,
    connectTimeout: Number($("scanConnectTimeout")?.value || 30) * 1000,
    commandTimeout: Number($("scanCommandTimeout")?.value || 90) * 1000,
    retries: Number($("scanRetries")?.value ?? 2),
    concurrency: Number($("scanConcurrency")?.value || 4),
    maxDevices: Number($("scanMaxDevices")?.value || 200),
  };
}

function showJob(job, label) {
  state.activeJobId = job.id;
  $("jobType").textContent = label;
  $("jobMessage").textContent = job.progress?.message || "عملیات شروع شد.";
  $("jobCounters").textContent = "";
  $("jobProgress").style.width = "5%";
  $("jobResult").innerHTML = "";
  $("cancelJob").classList.remove("hidden");
  $("closeJob").classList.add("hidden");
  if (!$("jobDialog").open) $("jobDialog").showModal();
  clearTimeout(state.jobTimer);
  pollJob();
}

async function pollJob() {
  if (!state.activeJobId) return;
  try {
    const { job } = await request(`/api/network-map/jobs/${encodeURIComponent(state.activeJobId)}`);
    $("jobMessage").textContent = job.progress?.message || "در حال اجرا";
    const processed = Number(job.progress?.processed || 0);
    const discovered = Math.max(1, Number(job.progress?.discovered || 1));
    $("jobCounters").textContent = `پردازش‌شده: ${formatNumber(processed)} از ${formatNumber(discovered)}${job.progress?.currentIp ? ` — ${job.progress.currentIp}` : ""}`;
    $("jobProgress").style.width = `${Math.max(5, Math.min(95, Math.round(processed / discovered * 100)))}%`;
    if (job.status === "running") { state.jobTimer = setTimeout(pollJob, 2000); return; }
    state.activeJobId = "";
    $("cancelJob").classList.add("hidden");
    $("closeJob").classList.remove("hidden");
    $("jobProgress").style.width = job.status === "completed" ? "100%" : "0%";
    if (job.status === "completed") {
      $("jobMessage").textContent = "عملیات با موفقیت تمام شد.";
      if (job.result?.results) $("jobResult").innerHTML = job.result.results.map((item) => `<div class="${item.ok ? "ok" : "fail"}">${item.ok ? "✓" : "×"} ${escapeHtml(item.hostname || item.ip)} — ${item.ok ? `ذخیره شد؛ ${formatNumber(item.redactionCount)} خط حساس حذف شد` : escapeHtml(item.error)}</div>`).join("");
      else if (job.result?.summary) $("jobResult").innerHTML = `<div class="ok">${formatNumber(job.result.summary.scanned)} سوئیچ و ${formatNumber(job.result.summary.links)} اتصال ثبت شد.</div>`;
      state._completedJob = job;
    } else {
      $("jobMessage").textContent = job.status === "cancelled" ? "عملیات متوقف شد." : "عملیات ناموفق بود.";
      $("jobResult").innerHTML = `<div class="fail">${escapeHtml(job.error || "خطای نامشخص")}</div>`;
      state._completedJob = null;
    }
  } catch (error) {
    state.jobTimer = setTimeout(pollJob, 3000);
    $("jobMessage").textContent = error.message;
  }
}

async function openMap(id, snapshotId = "") {
  clearOnline();
  try {
    const result = await request(`/api/network-map/maps/${encodeURIComponent(id)}${snapshotId ? `?snapshot=${encodeURIComponent(snapshotId)}` : ""}`);
    state.map = result.map;
    state.snapshot = result.snapshot;
    state.snapshots = result.snapshots || [];
    state.deletedSnapshots = result.deletedSnapshots || [];
    state.status = {};
    renderMap();
  } catch (error) { toast(error.message); }
}

function graphLayout(topology) {
  const devices = topology?.devices || [];
  const links = topology?.links || [];
  const byKey = new Map(devices.map((item) => [item.key, item]));
  const adjacency = new Map(devices.map((item) => [item.key, []]));
  for (const link of links) {
    adjacency.get(link.from)?.push(link.to);
    adjacency.get(link.to)?.push(link.from);
  }
  const root = devices.find((item) => item.ip === topology.seedIp)?.key || devices[0]?.key;
  const level = new Map();
  const queue = root ? [root] : [];
  if (root) level.set(root, 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor];
    for (const next of adjacency.get(key) || []) if (!level.has(next)) { level.set(next, level.get(key) + 1); queue.push(next); }
  }
  const deepest = Math.max(0, ...level.values());
  for (const device of devices) if (!level.has(device.key)) level.set(device.key, deepest + 1);
  const groups = new Map();
  for (const device of devices) {
    const depth = level.get(device.key);
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push(device);
  }
  const positions = new Map();
  let maxWidth = 900;
  for (const [depth, items] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    items.sort((a, b) => String(a.hostname || a.ip).localeCompare(String(b.hostname || b.ip)));
    const width = Math.max(210, items.length * 290);
    maxWidth = Math.max(maxWidth, width);
    items.forEach((item, index) => positions.set(item.key, { x: 70 + index * 290, y: 65 + depth * 190 }));
  }
  const height = Math.max(560, (Math.max(0, ...groups.keys()) + 1) * 190 + 120);
  return { positions, width: maxWidth + 100, height, byKey };
}

function nodeStatus(device) {
  if (state.status[device.ip] === true) return "online";
  if (state.status[device.ip] === false) return "offline";
  return "";
}

function renderMap() {
  if (!state.snapshot) {
    $("page").innerHTML = `<div class="headline"><div><button id="backMaps" class="btn sm">بازگشت</button><h1>${escapeHtml(state.map.name)}</h1><p>این نقشه هنوز نسخه موفق ندارد.</p></div>${canWrite() ? `<button id="retryScan" class="btn primary">شروع بررسی</button>` : ""}</div>`;
    $("backMaps").addEventListener("click", renderHome);
    $("retryScan")?.addEventListener("click", () => openScanDialog(state.map));
    return;
  }
  const topology = state.snapshot.topology;
  const layout = graphLayout(topology);
  state.positions = layout.positions;
  const lines = topology.links.map((link) => {
    const a = layout.positions.get(link.from);
    const b = layout.positions.get(link.to);
    if (!a || !b) return "";
    const x1 = a.x + 105, y1 = a.y + 46, x2 = b.x + 105, y2 = b.y + 46;
    const ax = x1 + (x2 - x1) * .25, ay = y1 + (y2 - y1) * .25 - 7;
    const bx = x1 + (x2 - x1) * .75, by = y1 + (y2 - y1) * .75 - 7;
    return `<g title="${escapeHtml(link.warning || link.discoveredBy || "")}"><line class="link-line ${link.warning ? "warning" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line><text class="link-label" x="${ax}" y="${ay}" text-anchor="middle">${escapeHtml(link.fromLabel || "—")}</text><text class="link-label" x="${bx}" y="${by}" text-anchor="middle">${escapeHtml(link.toLabel || "—")}</text></g>`;
  }).join("");
  const cards = topology.devices.map((device) => {
    const pos = layout.positions.get(device.key);
    return `<button class="switch-node ${device.reachable === false ? "unreachable" : ""} ${nodeStatus(device)}" style="left:${pos.x}px;top:${pos.y}px" data-key="${escapeHtml(device.key)}" data-ip="${escapeHtml(device.ip)}"><span class="node-badges"><span>${escapeHtml(device.platform || "SW")}</span>${device.ipamHostId ? `<span class="ipam">IPAM</span>` : `<span>ثبت‌نشده</span>`}</span><b>${escapeHtml(device.hostname || "سوئیچ ناشناس")}</b><div class="ip">${escapeHtml(device.ip || "بدون IP مدیریتی")}</div><small><span>${escapeHtml(device.model || "مدل نامشخص")}</span><span>${device.reachable === false ? "دسترسی ناموفق" : `${formatNumber(device.portCounts?.up)} پورت فعال`}</span></small></button>`;
  }).join("");
  const writable = canWrite(state.map.companyId);
  const snapshotHistory = state.snapshots.map((item) => `<div class="history-row"><button class="snapshot-button ${item.id === state.snapshot.id ? "active" : ""}" data-id="${escapeHtml(item.id)}">نسخه ${formatNumber(item.version)}<small>${formatDate(item.createdAt)} · ${formatNumber(item.deviceCount)} سوئیچ</small></button>${writable && item.id !== state.snapshot.id ? `<button class="btn sm danger delete-snapshot" data-id="${escapeHtml(item.id)}" title="انتقال نسخه به سطل بازیافت">×</button>` : ""}</div>`).join("");
  const deletedHistory = state.deletedSnapshots.map((item) => `<div class="trash-row compact"><span><b>نسخه ${formatNumber(item.version)}</b><small>${formatDate(item.deletedAt)}</small></span><button class="btn sm restore-snapshot" data-id="${escapeHtml(item.id)}">بازیابی</button></div>`).join("");
  $("page").innerHTML = `<div class="headline"><div><div class="actions"><button id="backMaps" class="btn sm">بازگشت به نقشه‌ها</button><span class="badge">${escapeHtml(state.map.companyName)}</span></div><h1>${escapeHtml(state.map.name)}</h1><p>${escapeHtml(state.map.description || "آخرین توپولوژی ذخیره‌شده")}</p></div><div class="actions">${writable ? `<button id="editMap" class="btn">ویرایش</button><button id="addManualDevice" class="btn">افزودن دستی سوئیچ</button><button id="rescanMap" class="btn primary">بررسی مجدد و نسخه جدید</button>${state.bootstrap?.user?.role === "admin" ? `<button id="importMacBaseline" class="btn">ثبت MACهای فعلی</button>` : ""}<button id="openBackup" class="btn">بکاپ کانفیگ</button><button id="deleteMap" class="btn danger">حذف نقشه</button>` : ""}</div></div>
    <div class="map-shell"><section class="map-panel"><div class="map-toolbar"><label class="online-toggle"><input id="onlineToggle" type="checkbox"> نمایش آنلاین</label><input id="mapSearch" placeholder="جست‌وجو: نام، IP، VLAN 100 یا MAC" autocomplete="off"><button id="fitMap" class="btn sm">نمایش کامل</button><button id="zoomIn" class="btn sm">＋</button><button id="zoomOut" class="btn sm">−</button><span class="spacer"></span><span>${formatNumber(topology.devices.length)} سوئیچ · ${formatNumber(topology.links.length)} اتصال</span></div><div id="canvasWrap" class="canvas-wrap"><div id="stage" class="stage" style="width:${layout.width}px;height:${layout.height}px"><svg class="links" width="${layout.width}" height="${layout.height}">${lines}</svg>${cards}</div></div></section>
    <aside class="side-panel"><h3>نسخه‌های ذخیره‌شده</h3><div class="history">${snapshotHistory}</div>${writable && deletedHistory ? `<details class="trash compact-trash"><summary>نسخه‌های حذف‌شده (${formatNumber(state.deletedSnapshots.length)})</summary>${deletedHistory}</details>` : ""}<div id="searchInfo" class="search-info hidden"></div><div class="legend-list"><h3>راهنما</h3><span><i class="green"></i>پاسخ پینگ</span><span><i class="red"></i>بدون پاسخ پینگ</span><span><i></i>بررسی آنلاین خاموش</span><span><i class="blue"></i>نتیجه جست‌وجو</span><p>وضعیت آنلاین فقط تا زمان بازبودن این صفحه بررسی می‌شود.</p></div></aside></div>`;
  bindMapEvents(layout);
  requestAnimationFrame(() => fitMap(layout));
}

function applyTransform() {
  const stage = $("stage");
  if (stage) stage.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;
}

function fitMap(layout = null) {
  const wrap = $("canvasWrap");
  const stage = $("stage");
  if (!wrap || !stage) return;
  const width = layout?.width || Number.parseFloat(stage.style.width);
  const height = layout?.height || Number.parseFloat(stage.style.height);
  state.zoom = Math.max(.25, Math.min(1, Math.min((wrap.clientWidth - 40) / width, (wrap.clientHeight - 40) / height)));
  state.panX = Math.max(20, (wrap.clientWidth - width * state.zoom) / 2);
  state.panY = 20;
  applyTransform();
}

function bindMapEvents(layout) {
  $("backMaps").addEventListener("click", renderHome);
  $("rescanMap")?.addEventListener("click", () => openScanDialog(state.map));
  $("addManualDevice")?.addEventListener("click", () => { $("manualDeviceForm").reset(); $("manualDeviceDialog").showModal(); });
  $("editMap")?.addEventListener("click", () => { $("editName").value = state.map.name; $("editDescription").value = state.map.description || ""; $("editDialog").showModal(); });
  $("openBackup")?.addEventListener("click", openBackupDialog);
  $("importMacBaseline")?.addEventListener("click", async () => {
    if (!confirm("MACهای انتهایی دیده‌شده در این نسخه به‌عنوان Baseline مجاز ثبت شوند؟ MACهای روی Uplink وارد نمی‌شوند.")) return;
    try {
      const result = await request(`/api/network-map/maps/${encodeURIComponent(state.map.id)}/import-macs`, { method: "POST", body: { snapshotId: state.snapshot.id } });
      try { await request("/api/radius/apply", { method: "POST", body: {} }); } catch {}
      toast(`${formatNumber(result.imported)} MAC جدید ثبت شد؛ ${formatNumber(result.existing)} مورد از قبل وجود داشت.`);
    } catch (error) { toast(error.message); }
  });
  $("deleteMap")?.addEventListener("click", async () => {
    if (!confirm(`نقشه «${state.map.name}» به سطل بازیافت منتقل شود؟ نسخه‌ها و بکاپ‌ها فوراً پاک نمی‌شوند.`)) return;
    try { await request(`/api/network-map/maps/${encodeURIComponent(state.map.id)}`, { method: "DELETE" }); await reloadBootstrap(); toast("نقشه به سطل بازیافت منتقل شد."); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll(".snapshot-button").forEach((node) => node.addEventListener("click", () => openMap(state.map.id, node.dataset.id)));
  document.querySelectorAll(".delete-snapshot").forEach((node) => node.addEventListener("click", async () => {
    if (!confirm("این نسخه تاریخی به سطل بازیافت منتقل شود؟")) return;
    try { await request(`/api/network-map/maps/${encodeURIComponent(state.map.id)}/snapshots/${encodeURIComponent(node.dataset.id)}`, { method: "DELETE" }); await openMap(state.map.id); }
    catch (error) { toast(error.message); }
  }));
  document.querySelectorAll(".restore-snapshot").forEach((node) => node.addEventListener("click", async () => {
    try {
      await request(`/api/network-map/maps/${encodeURIComponent(state.map.id)}/snapshots/${encodeURIComponent(node.dataset.id)}/restore`, { method: "POST" });
      await openMap(state.map.id, node.dataset.id);
      toast("نسخه نقشه بازیابی شد.");
    } catch (error) { toast(error.message); }
  }));
  document.querySelectorAll(".switch-node").forEach((node) => node.addEventListener("click", () => window.open(`/network-map/device.html?map=${encodeURIComponent(state.map.id)}&snapshot=${encodeURIComponent(state.snapshot.id)}&device=${encodeURIComponent(node.dataset.key)}`, "_blank", "noopener")));
  $("fitMap").addEventListener("click", () => fitMap(layout));
  $("zoomIn").addEventListener("click", () => { state.zoom = Math.min(2, state.zoom * 1.2); applyTransform(); });
  $("zoomOut").addEventListener("click", () => { state.zoom = Math.max(.2, state.zoom / 1.2); applyTransform(); });
  const wrap = $("canvasWrap");
  wrap.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const old = state.zoom;
    const next = Math.max(.2, Math.min(2.5, old * (event.deltaY < 0 ? 1.12 : .89)));
    state.panX = x - (x - state.panX) * next / old;
    state.panY = y - (y - state.panY) * next / old;
    state.zoom = next;
    applyTransform();
  }, { passive: false });
  let drag = null;
  wrap.addEventListener("pointerdown", (event) => { if (event.target.closest(".switch-node")) return; drag = { x: event.clientX, y: event.clientY, px: state.panX, py: state.panY }; wrap.setPointerCapture(event.pointerId); wrap.classList.add("dragging"); });
  wrap.addEventListener("pointermove", (event) => { if (!drag) return; state.panX = drag.px + event.clientX - drag.x; state.panY = drag.py + event.clientY - drag.y; applyTransform(); });
  wrap.addEventListener("pointerup", () => { drag = null; wrap.classList.remove("dragging"); });
  $("mapSearch").addEventListener("input", (event) => focusSearch(event.target.value));
  $("onlineToggle").addEventListener("change", (event) => event.target.checked ? startOnlineStatus() : stopOnlineStatus());
}

function normalizedMac(value) {
  const raw = String(value || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  return /^[0-9a-f]{12}$/.test(raw) ? raw : "";
}

function focusDevice(device, highlightAll = false) {
  if (!device) return;
  const node = document.querySelector(`.switch-node[data-key="${CSS.escape(device.key)}"]`);
  const pos = state.positions.get(device.key);
  const wrap = $("canvasWrap");
  if (node) node.classList.add("highlight");
  if (!highlightAll && node && pos && wrap) {
    state.panX = wrap.clientWidth / 2 - (pos.x + 105) * state.zoom;
    state.panY = wrap.clientHeight / 2 - (pos.y + 46) * state.zoom;
    applyTransform();
  }
}

function focusSearch(value) {
  document.querySelectorAll(".switch-node").forEach((node) => node.classList.remove("highlight"));
  const info = $("searchInfo");
  if (info) { info.classList.add("hidden"); info.innerHTML = ""; }
  const query = String(value || "").trim();
  if (!query) return;
  const topology = state.snapshot.topology;
  const vlanMatch = query.match(/^(?:vlan\s*)?(\d{1,4})$/i);
  if (vlanMatch && /vlan/i.test(query)) {
    const vlan = Number(vlanMatch[1]);
    const devices = topology.devices.filter((item) => (item.vlans || []).some((v) => Number(v.id) === vlan) || (item.ports || []).some((p) => Number(p.vlan) === vlan));
    devices.forEach((d) => focusDevice(d, true));
    if (info) { info.innerHTML = `<b>VLAN ${vlan}</b><span>${formatNumber(devices.length)} سوئیچ پیدا شد.</span>`; info.classList.remove("hidden"); }
    return;
  }
  const mac = normalizedMac(query);
  if (mac) {
    const uplinks = new Map();
    const mark = (key, port) => { if (!uplinks.has(key)) uplinks.set(key, new Set()); uplinks.get(key).add(String(port || "").replace(/-T$/,"")); };
    for (const link of topology.links || []) { mark(link.from, link.fromPort?.name || link.fromLabel); mark(link.to, link.toPort?.name || link.toLabel); }
    const hits = [];
    for (const device of topology.devices) for (const entry of device.macTable || []) if (normalizedMac(entry.mac) === mac) hits.push({ device, entry, uplink: uplinks.get(device.key)?.has(entry.port) });
    const selected = hits.find((x) => !x.uplink && x.device.reachable !== false) || hits.find((x) => x.device.reachable !== false) || hits[0];
    if (selected) {
      focusDevice(selected.device);
      if (info) { info.innerHTML = `<b>${escapeHtml(query)}</b><span>${escapeHtml(selected.device.hostname || selected.device.ip)} / ${escapeHtml(selected.entry.port)} / VLAN ${escapeHtml(selected.entry.vlan || "-")}</span>`; info.classList.remove("hidden"); }
    } else if (info) { info.innerHTML = `<b>${escapeHtml(query)}</b><span>MAC در Snapshot فعلی پیدا نشد.</span>`; info.classList.remove("hidden"); }
    return;
  }
  const q = query.toLowerCase();
  const device = topology.devices.find((item) => String(item.hostname || "").toLowerCase().includes(q) || String(item.ip || "").includes(q));
  if (device) focusDevice(device);
}

async function updateOnlineStatus() {
  if (!$("onlineToggle")?.checked || !state.map || !state.snapshot) return;
  try {
    const result = await request("/api/network-map/status", { method: "POST", body: { mapId: state.map.id, snapshotId: state.snapshot.id } });
    state.status = result.status || {};
    document.querySelectorAll(".switch-node").forEach((node) => {
      node.classList.remove("online", "offline");
      if (Object.prototype.hasOwnProperty.call(state.status, node.dataset.ip)) node.classList.add(state.status[node.dataset.ip] ? "online" : "offline");
    });
  } catch (error) { toast(error.message); }
}

function startOnlineStatus() {
  updateOnlineStatus();
  clearInterval(state.onlineTimer);
  state.onlineTimer = setInterval(updateOnlineStatus, 30_000);
}

function stopOnlineStatus() {
  clearOnline();
  document.querySelectorAll(".switch-node").forEach((node) => node.classList.remove("online", "offline"));
}

function openBackupDialog() {
  const devices = state.snapshot.topology.devices.filter((item) => item.reachable !== false && item.ip);
  $("backupDevices").innerHTML = devices.map((item) => `<label class="device-check"><input type="checkbox" value="${escapeHtml(item.key)}"><span><b>${escapeHtml(item.hostname || "بدون نام")}</b><small>${escapeHtml(item.ip)}</small></span></label>`).join("");
  $("backupCount").textContent = `${formatNumber(devices.length)} سوئیچ`;
  $("backupAll").checked = false;
  fillSystemAccounts("backup");
  $("backupSystemAccount").value = state.bootstrap?.systemAccounts?.[0]?.id || "";
  updateCredentialMode("backup");
  $("backupProtocol").value = "ssh";
  $("backupPort").value = "22";
  clearCredentialFields("backup");
  $("backupDialog").showModal();
}

$("scanSystemAccount").addEventListener("change", () => updateCredentialMode("scan"));
$("backupSystemAccount").addEventListener("change", () => updateCredentialMode("backup"));
$("scanProtocol").addEventListener("change", () => {
  const telnet = $("scanProtocol").value === "telnet";
  $("scanPort").value = telnet ? "23" : "22";
  $("telnetWarning").classList.toggle("hidden", !telnet);
});
$("backupProtocol").addEventListener("change", () => { $("backupPort").value = $("backupProtocol").value === "telnet" ? "23" : "22"; });
$("backupAll").addEventListener("change", (event) => $("backupDevices").querySelectorAll("input").forEach((node) => { node.checked = event.target.checked; }));

$("scanForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const mapId = $("scanMapId").value;
  const body = scanBody("scan", {
    mapId: mapId || undefined,
    companyId: $("scanCompany").value,
    name: $("scanName").value,
    description: $("scanDescription").value,
    seedIp: $("scanSeedIp").value,
  });
  try {
    const result = await request("/api/network-map/scans", { method: "POST", body });
    $("scanDialog").close();
    clearCredentialFields("scan");
    showJob(result.job, mapId ? "ساخت نسخه جدید نقشه" : "کشف شبکه و ایجاد نقشه");
  } catch (error) { clearCredentialFields("scan"); toast(error.message); }
});

$("editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request(`/api/network-map/maps/${encodeURIComponent(state.map.id)}`, { method: "PUT", body: { name: $("editName").value, description: $("editDescription").value } });
    $("editDialog").close();
    await openMap(state.map.id, state.snapshot.id);
    toast("مشخصات نقشه ذخیره شد.");
  } catch (error) { toast(error.message); }
});

$("manualDeviceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await request(`/api/network-map/maps/${encodeURIComponent(state.map.id)}/manual-devices`, { method:"POST", body:{ ip:$("manualDeviceIp").value, hostname:$("manualDeviceName").value, notes:$("manualDeviceNotes").value } }); $("manualDeviceDialog").close(); await openMap(state.map.id,state.snapshot.id); toast("سوئیچ دستی به نقشه اضافه شد."); } catch(error){ toast(error.message); }
});

$("backupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const deviceKeys = [...$("backupDevices").querySelectorAll("input:checked")].map((node) => node.value);
  if (!deviceKeys.length) return toast("حداقل یک سوئیچ را انتخاب کنید.");
  const body = scanBody("backup", { mapId: state.map.id, snapshotId: state.snapshot.id, deviceKeys });
  try {
    const result = await request("/api/network-map/backups", { method: "POST", body });
    $("backupDialog").close();
    clearCredentialFields("backup");
    showJob(result.job, "بکاپ امن کانفیگ سوئیچ‌ها");
  } catch (error) { clearCredentialFields("backup"); toast(error.message); }
});

$("cancelJob").addEventListener("click", async () => {
  if (!state.activeJobId || !confirm("عملیات فعال متوقف شود؟")) return;
  try { await request(`/api/network-map/jobs/${encodeURIComponent(state.activeJobId)}`, { method: "DELETE" }); }
  catch (error) { toast(error.message); }
});

$("closeJob").addEventListener("click", async () => {
  $("jobDialog").close();
  const job = state._completedJob;
  state._completedJob = null;
  if (job?.result?.mapId) {
    state.bootstrap = await request("/api/network-map/bootstrap");
    await openMap(job.result.mapId, job.result.snapshotId || "");
  } else if (state.map) await openMap(state.map.id, state.snapshot?.id || "");
});

document.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => {
  const dialog = node.closest("dialog");
  if (dialog?.id === "scanDialog") clearCredentialFields("scan");
  if (dialog?.id === "backupDialog") clearCredentialFields("backup");
  dialog?.close();
}));

$("homeButton").addEventListener("click", renderHome);
$("themeButton").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ems-theme", theme);
});

window.addEventListener("beforeunload", () => {
  clearCredentialFields("scan");
  clearCredentialFields("backup");
  clearOnline();
  if (state.activeJobId) fetch(`/api/network-map/jobs/${encodeURIComponent(state.activeJobId)}`, { method: "DELETE", credentials: "same-origin", headers: { "X-EMS-CSRF": "1" }, keepalive: true }).catch(() => {});
});

boot();
