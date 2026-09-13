const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = { mapId: params.get("map") || "", snapshotId: params.get("snapshot") || "", deviceKey: params.get("device") || "", data: null, action: "", activeJob: "", timer: null };

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function formatNumber(value) { return new Intl.NumberFormat("fa-IR").format(Number(value || 0)); }
function formatDate(value) { return value ? new Date(value).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function toast(message) { const node = $("toast"); node.textContent = message; node.classList.add("show"); clearTimeout(node._timer); node._timer = setTimeout(() => node.classList.remove("show"), 3500); }

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== "string") { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(options.body); }
  if (options.method && options.method !== "GET") headers["X-EMS-CSRF"] = "1";
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) { const error = new Error(payload?.error || `خطای ${response.status}`); error.status = response.status; throw error; }
  return payload;
}

function clearCredentials() { for (const id of ["credentialUsername", "credentialPassword", "credentialEnable", "connectUsername"]) if ($(id)) $(id).value = ""; }
function connectionBody() { return { protocol: $("credentialProtocol").value, port: Number($("credentialPort").value), username: $("credentialUsername").value, password: $("credentialPassword").value, enablePassword: $("credentialEnable").value, connectTimeout: 30000, commandTimeout: 90000, retries: 2, concurrency: 1, maxDevices: 1, snapshotId: state.snapshotId }; }

async function load() {
  if (!state.mapId || !state.deviceKey) return showError("نشانی سوئیچ کامل نیست.");
  try {
    state.data = await request(`/api/network-map/maps/${encodeURIComponent(state.mapId)}/devices/${encodeURIComponent(state.deviceKey)}${state.snapshotId ? `?snapshot=${encodeURIComponent(state.snapshotId)}` : ""}`);
    state.snapshotId = state.data.snapshot.id;
    render();
  } catch (error) { if (error.status === 401) location.href = "/"; else showError(error.message); }
}

function showError(message) { $("devicePage").innerHTML = `<section class="empty"><h2>اطلاعات نمایش داده نشد</h2><p>${escapeHtml(message)}</p><a class="btn" href="/network-map/">بازگشت به نقشه‌ها</a></section>`; }

function render() {
  const { device, map, snapshot, backups, deletedBackups = [] } = state.data;
  document.title = `${device.hostname || device.ip} — نقشه شبکه`;
  const c = device.portCounts || {};
  const portTiles = (device.ports || []).map((port) => `<button class="port-tile ${escapeHtml(port.status || "free")}" title="${escapeHtml([port.description, port.speed, port.rawStatus].filter(Boolean).join(" — "))}"><b>${escapeHtml(port.name)}</b><small>${port.mode === "trunk" ? "Trunk" : port.vlan ? `Access VLAN ${escapeHtml(port.vlan)}` : "Access"}</small><em>${port.mode === "trunk" ? "T" : port.vlan ? `AC${escapeHtml(port.vlan)}` : "—"}</em></button>`).join("") || `<div class="empty">اطلاعات پورت از این سوئیچ دریافت نشده است.</div>`;
  const ipamLink = device.ipamHostId && device.ipamSpaceId ? `/#/ipam/${encodeURIComponent(device.ipamSpaceId)}` : "";
  const backupTrash = deletedBackups.map((item) => `<div class="trash-row compact"><span><b>${formatDate(item.createdAt)}</b><small>حذف: ${formatDate(item.deletedAt)}</small></span><button class="btn sm restore-backup" data-id="${escapeHtml(item.id)}">بازیابی</button></div>`).join("");
  $("devicePage").innerHTML = `<div class="device-hero"><div><div class="crumb">${escapeHtml(map.name)} · نسخه ${formatNumber(snapshot.version)}</div><h1>${escapeHtml(device.hostname || "سوئیچ ناشناس")}</h1><div class="ip">${escapeHtml(device.ip || "بدون IP مدیریتی")}</div></div><div class="actions"><button id="connectDevice" class="btn">اتصال</button><button id="refreshDevice" class="btn primary">به‌روزرسانی همین سوئیچ</button><button id="safeBackup" class="btn">بکاپ امن</button><button id="liveDownload" class="btn">دانلود کامل زنده</button>${ipamLink ? `<a class="btn" href="${ipamLink}">نمایش در مدیریت آی‌پی</a>` : ""}<a class="btn" href="/network-map/">بازگشت</a></div></div>
    ${device.reachable === false ? `<div class="warning-banner">سوئیچ در نقشه شناسایی شده اما اتصال به آن موفق نبوده است: ${escapeHtml(device.error)}</div>` : ""}
    <div class="device-grid"><div><section class="device-panel"><h2>نمای پورت‌ها</h2><div class="port-summary"><div><b>${formatNumber(c.total)}</b><span>کل</span></div><div><b>${formatNumber(c.up)}</b><span>فعال</span></div><div><b>${formatNumber(c.free)}</b><span>آزاد</span></div><div><b>${formatNumber(c.adminDown)}</b><span>خاموش مدیریتی</span></div><div><b>${formatNumber(c.error)}</b><span>خطا</span></div></div><div class="port-wall">${portTiles}</div></section>
    <section class="device-panel"><div class="headline"><div><h2>بکاپ‌های کانفیگ</h2><p>فقط نسخه پاک‌سازی‌شده در سامانه نگهداری می‌شود.</p></div><button id="compareBackups" class="btn sm">مقایسه دو انتخاب</button></div><div class="backup-table-wrap"><table class="backup-table"><thead><tr><th>انتخاب</th><th>تاریخ</th><th>هش</th><th>حذف خطوط حساس</th><th>عملیات</th></tr></thead><tbody>${backups.map((item) => `<tr><td><input class="backup-select" type="checkbox" value="${escapeHtml(item.id)}"></td><td>${formatDate(item.createdAt)}</td><td class="ltr">${escapeHtml(item.configHash.slice(0, 12))}</td><td>${formatNumber(item.redactionCount)}</td><td><div class="row-actions"><button class="btn sm view-backup" data-id="${escapeHtml(item.id)}">نمایش</button><a class="btn sm" href="/api/network-map/backups/${encodeURIComponent(item.id)}/download">دانلود</a><button class="btn sm danger delete-backup" data-id="${escapeHtml(item.id)}">حذف</button></div></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">بکاپی ثبت نشده است.</div></td></tr>`}</tbody></table></div>${backupTrash ? `<details class="trash backup-trash"><summary>بکاپ‌های حذف‌شده (${formatNumber(deletedBackups.length)})</summary>${backupTrash}</details>` : ""}</section></div>
    <aside><section class="device-panel"><h2>مشخصات سوئیچ</h2><div class="facts"><div class="fact"><span>مدل</span><b>${escapeHtml(device.model || "—")}</b></div><div class="fact"><span>شماره سریال</span><b>${escapeHtml(device.serial || "—")}</b></div><div class="fact"><span>سیستم‌عامل</span><b>${escapeHtml(device.platform || "—")}</b></div><div class="fact"><span>نسخه</span><b>${escapeHtml(device.osVersion || "—")}</b></div><div class="fact"><span>مدت کارکرد</span><b>${escapeHtml(device.uptime || "—")}</b></div><div class="fact"><span>سطح دسترسی اسکن</span><b>${formatNumber(device.privilege || 0)}</b></div><div class="fact"><span>آخرین خواندن</span><b>${formatDate(device.lastScanAt)}</b></div><div class="fact"><span>اتصال به مدیریت آی‌پی</span><b>${device.ipamHostId ? "ثبت‌شده" : "ثبت‌نشده"}</b></div></div></section><section class="device-panel"><h2>شبکه‌های مجازی</h2><div class="vlan-list">${(device.vlans || []).map((vlan) => `<span>${escapeHtml(vlan.id)} — ${escapeHtml(vlan.name)}</span>`).join("") || "اطلاعاتی دریافت نشده است."}</div></section></aside></div>`;
  bind();
}

function openCredential(action) {
  state.action = action;
  clearCredentials();
  $("credentialProtocol").value = "ssh";
  $("credentialPort").value = "22";
  $("fullWarning").classList.toggle("hidden", action !== "download");
  $("credentialTitle").textContent = action === "refresh" ? "به‌روزرسانی همین سوئیچ" : action === "backup" ? "بکاپ امن کانفیگ" : "دانلود کامل و زنده کانفیگ";
  $("credentialSubtitle").textContent = action === "download" ? "فایل روی سامانه ذخیره نمی‌شود." : "یک عملیات دستی و بدون ذخیره رمز";
  $("credentialSubmit").textContent = action === "download" ? "دریافت فایل" : "شروع عملیات";
  $("credentialDialog").showModal();
}

function bind() {
  $("connectDevice").addEventListener("click", () => { $("connectForm").reset(); $("connectProtocol").value = "SSH"; $("connectPort").value = "22"; $("connectDialog").showModal(); });
  $("refreshDevice").addEventListener("click", () => openCredential("refresh"));
  $("safeBackup").addEventListener("click", () => openCredential("backup"));
  $("liveDownload").addEventListener("click", () => openCredential("download"));
  $("compareBackups").addEventListener("click", compareSelected);
  document.querySelectorAll(".view-backup").forEach((node) => node.addEventListener("click", () => viewBackup(node.dataset.id)));
  document.querySelectorAll(".delete-backup").forEach((node) => node.addEventListener("click", () => deleteBackup(node.dataset.id)));
  document.querySelectorAll(".restore-backup").forEach((node) => node.addEventListener("click", () => restoreBackup(node.dataset.id)));
}

async function viewBackup(id) {
  try { const result = await request(`/api/network-map/backups/${encodeURIComponent(id)}`); $("configTitle").textContent = `${result.backup.hostname || result.backup.ip} — بکاپ پاک‌سازی‌شده`; $("configMeta").textContent = `${formatDate(result.backup.createdAt)} · ${formatNumber(result.backup.redactionCount)} خط حساس حذف شده`; $("configText").textContent = result.backup.configText; $("configDialog").showModal(); }
  catch (error) { toast(error.message); }
}

async function deleteBackup(id) {
  if (!confirm("این بکاپ به سطل بازیافت منتقل شود؟")) return;
  try { await request(`/api/network-map/backups/${encodeURIComponent(id)}`, { method: "DELETE" }); await load(); toast("بکاپ حذف شد و قابل بازیابی است."); }
  catch (error) { toast(error.message); }
}

async function restoreBackup(id) {
  try {
    await request(`/api/network-map/backups/${encodeURIComponent(id)}/restore`, { method: "POST" });
    await load();
    toast("بکاپ بازیابی شد.");
  } catch (error) { toast(error.message); }
}

async function compareSelected() {
  const ids = [...document.querySelectorAll(".backup-select:checked")].map((node) => node.value);
  if (ids.length !== 2) return toast("دقیقاً دو بکاپ را انتخاب کنید.");
  try {
    const result = await request("/api/network-map/backups/compare", { method: "POST", body: { ids } });
    $("diffMeta").textContent = `${formatDate(result.before.createdAt)} ← ${formatDate(result.after.createdAt)}`;
    $("diffText").innerHTML = result.diff.map((item) => `<span class="${item.type}">${item.type === "add" ? "+ " : item.type === "remove" ? "- " : "  "}${escapeHtml(item.line)}\n</span>`).join("");
    $("diffDialog").showModal();
  } catch (error) { toast(error.message); }
}

$("credentialProtocol").addEventListener("change", () => { $("credentialPort").value = $("credentialProtocol").value === "telnet" ? "23" : "22"; });
$("connectProtocol").addEventListener("change", () => { $("connectPort").value = $("connectProtocol").value === "TELNET" ? "23" : "22"; });

$("connectForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = new URL("emsipam://open");
  url.searchParams.set("tool", $("connectProtocol").value);
  url.searchParams.set("host", state.data.device.ip);
  url.searchParams.set("port", $("connectPort").value);
  if ($("connectUsername").value) url.searchParams.set("username", $("connectUsername").value);
  location.href = url.toString();
  clearCredentials();
  $("connectDialog").close();
});

$("credentialForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = connectionBody();
  try {
    if (state.action === "download") {
      const response = await fetch(`/api/network-map/maps/${encodeURIComponent(state.mapId)}/devices/${encodeURIComponent(state.deviceKey)}/download-live`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-EMS-CSRF": "1" }, body: JSON.stringify(body), cache: "no-store" });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `خطای ${response.status}`); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${state.data.device.hostname || state.data.device.ip}-${Date.now()}.cfg`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      clearCredentials(); $("credentialDialog").close(); toast("فایل کامل مستقیم دانلود شد و در سامانه ذخیره نشد.");
      return;
    }
    const endpoint = state.action === "refresh"
      ? `/api/network-map/maps/${encodeURIComponent(state.mapId)}/devices/${encodeURIComponent(state.deviceKey)}/refresh`
      : "/api/network-map/backups";
    const payload = state.action === "backup" ? { ...body, mapId: state.mapId, snapshotId: state.snapshotId, deviceKeys: [state.deviceKey] } : body;
    const result = await request(endpoint, { method: "POST", body: payload });
    clearCredentials(); $("credentialDialog").close(); showProgress(result.job);
  } catch (error) { clearCredentials(); toast(error.message); }
});

function showProgress(job) {
  state.activeJob = job.id;
  $("progressMessage").textContent = job.progress?.message || "عملیات شروع شد.";
  $("progressBar").style.width = "8%";
  $("progressResult").textContent = "";
  $("stopProgress").classList.remove("hidden"); $("closeProgress").classList.add("hidden");
  $("progressDialog").showModal(); pollProgress();
}

async function pollProgress() {
  if (!state.activeJob) return;
  try {
    const { job } = await request(`/api/network-map/jobs/${encodeURIComponent(state.activeJob)}`);
    $("progressMessage").textContent = job.progress?.message || "در حال اجرا";
    $("progressBar").style.width = job.status === "completed" ? "100%" : "65%";
    if (job.status === "running") { state.timer = setTimeout(pollProgress, 2000); return; }
    state.activeJob = "";
    $("stopProgress").classList.add("hidden"); $("closeProgress").classList.remove("hidden");
    if (job.status === "completed") { $("progressMessage").textContent = "عملیات با موفقیت تمام شد."; state.completedJob = job; }
    else { $("progressMessage").textContent = job.error || "عملیات متوقف شد."; state.completedJob = null; }
  } catch (error) { state.timer = setTimeout(pollProgress, 3000); }
}

$("stopProgress").addEventListener("click", async () => { if (state.activeJob && confirm("عملیات متوقف شود؟")) await request(`/api/network-map/jobs/${encodeURIComponent(state.activeJob)}`, { method: "DELETE" }).catch((error) => toast(error.message)); });
$("closeProgress").addEventListener("click", async () => {
  $("progressDialog").close();
  const job = state.completedJob; state.completedJob = null;
  if (job?.result?.deviceKey) { state.deviceKey = job.result.deviceKey; state.snapshotId = job.result.snapshotId; history.replaceState({}, "", `?map=${encodeURIComponent(state.mapId)}&snapshot=${encodeURIComponent(state.snapshotId)}&device=${encodeURIComponent(state.deviceKey)}`); }
  else if (job?.result?.snapshotId) state.snapshotId = job.result.snapshotId;
  await load();
});

document.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => { clearCredentials(); node.closest("dialog")?.close(); }));
window.addEventListener("beforeunload", () => { clearCredentials(); if (state.activeJob) fetch(`/api/network-map/jobs/${encodeURIComponent(state.activeJob)}`, { method: "DELETE", credentials: "same-origin", headers: { "X-EMS-CSRF": "1" }, keepalive: true }).catch(() => {}); });
load();
