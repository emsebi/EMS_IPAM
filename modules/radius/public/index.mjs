export function createUi(ctx) {
  const { state, $, page, request, escapeHtml, navActive, t, ensureInventory } = ctx;

  const jsonText = (value) => JSON.stringify(value, null, 2);
  const setResult = (id, value) => {
    const node = $(id);
    if (!node) return;
    node.textContent = jsonText(value);
  };
  let nasProfiles = [];
  let adminProfiles = [];
  let nasEditId = null;
  let adminEditId = null;

  function syncAdminFields() {
    const cisco = $("radiusAdminVendor")?.value === "cisco";
    $("radiusCiscoFields")?.classList.toggle("hidden", !cisco);
    $("radiusMikrotikFields")?.classList.toggle("hidden", cisco);
  }

  async function runMabPreview(event) {
    event.preventDefault();
    const known = $("radiusMabKnown").checked;
    const knownMode = $("radiusMabKnownMode").value;
    const unknownMode = $("radiusMabUnknownMode").value;
    const vlanText = $("radiusMabKnownVlan").value.trim();
    const guestText = $("radiusMabGuestVlan").value.trim();
    const mac = $("radiusMabMac").value.trim();
    const record = { mac, enabled: true };
    if (vlanText) record.vlan = vlanText;
    const knownRule = { mode: knownMode };
    const unknownRule = { mode: unknownMode };
    if (guestText) unknownRule.vlan = guestText;
    try {
      const response = await request("/api/radius/preview/mab", {
        method: "POST",
        body: {
          mac,
          switchId: $("radiusMabSwitch").value.trim(),
          knownMacs: known ? [record] : [],
          policy: { enabled: true, known: knownRule, unknown: unknownRule },
        },
      });
      setResult("radiusMabResult", response.result);
    } catch (error) {
      setResult("radiusMabResult", { decision: "error", reason: error.message });
    }
  }

  async function runAdminPreview(event) {
    event.preventDefault();
    const vendor = $("radiusAdminVendor").value;
    const profile = { enabled: true };
    if (vendor === "cisco") profile.ciscoPrivilege = Number($("radiusCiscoPrivilege").value);
    else profile.mikrotikGroup = $("radiusMikrotikGroup").value.trim();
    try {
      const response = await request("/api/radius/preview/admin-profile", {
        method: "POST",
        body: { vendor, profile },
      });
      setResult("radiusAdminResult", response.result);
    } catch (error) {
      setResult("radiusAdminResult", { decision: "error", reason: error.message });
    }
  }

  function selectedNasDevice() {
    const id = $("radiusNasDevice")?.value || "";
    return (state.inventory || []).find((item) => item.id === id) || null;
  }

  function syncNasDevice() {
    const device = selectedNasDevice();
    if ($("radiusNasIp")) $("radiusNasIp").value = device?.ip || "";
    if ($("radiusNasId") && !$("radiusNasId").value && device) $("radiusNasId").value = `nas-${device.id}`.slice(0, 80);
  }

  function currentNasProfile() {
    const device = selectedNasDevice();
    if (!device) return null;
    return {
      id: $("radiusNasId").value.trim(),
      companyId: device.companyId,
      deviceId: device.id,
      name: $("radiusNasName").value.trim(),
      vendor: $("radiusNasVendor").value,
      nasIp: $("radiusNasIp").value.trim(),
      enabled: $("radiusNasEnabled").checked,
      services: [...document.querySelectorAll('[name="radiusNasService"]:checked')].map((node) => node.value),
    };
  }

  async function runNasPreview(event) {
    event.preventDefault();
    const profile = currentNasProfile();
    if (!profile) return setResult("radiusNasResult", { status: "invalid", issues: ["device-required"] });
    try {
      const response = await request("/api/radius/preview/nas-client", {
        method: "POST",
        body: { profile },
      });
      const result = response.result;
      $("radiusNasResult").textContent = result?.text || jsonText(result);
    } catch (error) {
      setResult("radiusNasResult", { status: "error", reason: error.message });
    }
  }

  function resetNasEditor() {
    nasEditId = null;
    $("radiusNasForm").reset();
    $("radiusNasId").disabled = false;
    $("radiusNasName").value = "Lab NAS";
    $("radiusNasVendor").value = "cisco";
    document.querySelectorAll('[name="radiusNasService"]').forEach((node) => { node.checked = node.value === "mab"; });
    $("radiusNasEnabled").checked = false;
    $("radiusNasCancelEdit").classList.add("hidden");
    syncNasDevice();
  }

  function renderNasProfiles() {
    $("radiusNasProfilesList").innerHTML = nasProfiles.map((item) => `
      <div class="radius-profile-row">
        <div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.vendor)} · <span class="ltr mono">${escapeHtml(item.nasIp)}</span> · ${escapeHtml((item.services || []).join(", "))}</small></div>
        <span class="status-pill">${escapeHtml(t(item.enabled ? "common.enabled" : "common.disabled"))}</span>
        <div class="row-actions"><button class="btn sm radius-nas-edit" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.edit"))}</button><button class="btn sm danger radius-nas-delete" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.delete"))}</button></div>
      </div>`).join("") || `<div class="empty-state compact-empty">${escapeHtml(t("radius.nas.empty"))}</div>`;
    page.querySelectorAll(".radius-nas-edit").forEach((node) => node.addEventListener("click", () => {
      const item = nasProfiles.find((entry) => entry.id === node.dataset.id);
      if (!item) return;
      nasEditId = item.id;
      $("radiusNasId").value = item.id; $("radiusNasId").disabled = true;
      $("radiusNasDevice").value = item.deviceId; $("radiusNasName").value = item.name;
      $("radiusNasVendor").value = item.vendor; $("radiusNasEnabled").checked = item.enabled;
      document.querySelectorAll('[name="radiusNasService"]').forEach((input) => { input.checked = (item.services || []).includes(input.value); });
      $("radiusNasCancelEdit").classList.remove("hidden"); syncNasDevice();
      $("radiusNasForm").scrollIntoView({ block: "nearest" });
    }));
    page.querySelectorAll(".radius-nas-delete").forEach((node) => node.addEventListener("click", async () => {
      const item = nasProfiles.find((entry) => entry.id === node.dataset.id);
      if (!item || !confirm(t("radius.nas.confirmDelete", { name: item.name }))) return;
      try { await request(`/api/radius/nas-profiles/${encodeURIComponent(item.id)}`, { method: "DELETE" }); await refreshProfiles(); }
      catch (error) { setResult("radiusNasResult", { status: "error", reason: error.message }); }
    }));
  }

  function resetAdminEditor() {
    adminEditId = null;
    $("radiusSavedAdminForm").reset();
    $("radiusSavedAdminId").disabled = false;
    $("radiusSavedCiscoPrivilege").value = "1";
    $("radiusSavedMikrotikGroup").value = "read";
    $("radiusSavedAdminEnabled").checked = false;
    $("radiusAdminCancelEdit").classList.add("hidden");
  }

  function renderAdminProfiles() {
    $("radiusAdminProfilesList").innerHTML = adminProfiles.map((item) => `
      <div class="radius-profile-row">
        <div><b>${escapeHtml(item.name)}</b><small>Cisco privilege: ${escapeHtml(item.ciscoPrivilege)} · MikroTik: ${escapeHtml(item.mikrotikGroup)}</small></div>
        <span class="status-pill">${escapeHtml(t(item.enabled ? "common.enabled" : "common.disabled"))}</span>
        <div class="row-actions"><button class="btn sm radius-admin-edit" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.edit"))}</button><button class="btn sm danger radius-admin-delete" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.delete"))}</button></div>
      </div>`).join("") || `<div class="empty-state compact-empty">${escapeHtml(t("radius.admin.empty"))}</div>`;
    page.querySelectorAll(".radius-admin-edit").forEach((node) => node.addEventListener("click", () => {
      const item = adminProfiles.find((entry) => entry.id === node.dataset.id);
      if (!item) return;
      adminEditId = item.id;
      $("radiusSavedAdminId").value = item.id; $("radiusSavedAdminId").disabled = true;
      $("radiusSavedAdminName").value = item.name; $("radiusSavedAdminDescription").value = item.description || "";
      $("radiusSavedCiscoPrivilege").value = String(item.ciscoPrivilege);
      $("radiusSavedMikrotikGroup").value = item.mikrotikGroup;
      $("radiusSavedAdminEnabled").checked = item.enabled;
      $("radiusAdminCancelEdit").classList.remove("hidden");
      $("radiusSavedAdminForm").scrollIntoView({ block: "nearest" });
    }));
    page.querySelectorAll(".radius-admin-delete").forEach((node) => node.addEventListener("click", async () => {
      const item = adminProfiles.find((entry) => entry.id === node.dataset.id);
      if (!item || !confirm(t("radius.admin.confirmDelete", { name: item.name }))) return;
      try { await request(`/api/radius/admin-profiles/${encodeURIComponent(item.id)}`, { method: "DELETE" }); await refreshProfiles(); }
      catch (error) { setResult("radiusSavedAdminResult", { status: "error", reason: error.message }); }
    }));
  }

  async function refreshProfiles() {
    const [nas, admins] = await Promise.all([request("/api/radius/nas-profiles"), request("/api/radius/admin-profiles")]);
    nasProfiles = nas.items || [];
    adminProfiles = admins.items || [];
    renderNasProfiles();
    renderAdminProfiles();
  }

  async function saveNasProfile() {
    const profile = currentNasProfile();
    if (!profile) return setResult("radiusNasResult", { status: "invalid", issues: ["device-required"] });
    try {
      const result = await request(nasEditId ? `/api/radius/nas-profiles/${encodeURIComponent(nasEditId)}` : "/api/radius/nas-profiles", {
        method: nasEditId ? "PUT" : "POST", body: profile,
      });
      setResult("radiusNasResult", { status: "saved", id: result.item.id });
      resetNasEditor();
      await refreshProfiles();
    } catch (error) { setResult("radiusNasResult", { status: "error", reason: error.message }); }
  }

  async function saveAdminProfile(event) {
    event.preventDefault();
    const profile = {
      id: $("radiusSavedAdminId").value.trim(),
      name: $("radiusSavedAdminName").value.trim(),
      description: $("radiusSavedAdminDescription").value.trim(),
      ciscoPrivilege: Number($("radiusSavedCiscoPrivilege").value),
      mikrotikGroup: $("radiusSavedMikrotikGroup").value.trim(),
      enabled: $("radiusSavedAdminEnabled").checked,
    };
    try {
      const result = await request(adminEditId ? `/api/radius/admin-profiles/${encodeURIComponent(adminEditId)}` : "/api/radius/admin-profiles", {
        method: adminEditId ? "PUT" : "POST", body: profile,
      });
      setResult("radiusSavedAdminResult", { status: "saved", id: result.item.id });
      resetAdminEditor();
      await refreshProfiles();
    } catch (error) { setResult("radiusSavedAdminResult", { status: "error", reason: error.message }); }
  }

  async function runMatrixDemo() {
    const inventory = [{ mac: "02:00:00:00:00:50", enabled: true, vlan: 20 }];
    const policy = { enabled: true, known: { mode: "accept-dynamic" }, unknown: { mode: "reject" } };
    try {
      const response = await request("/api/radius/preview/mab-matrix", {
        method: "POST",
        body: { cases: [
          { label: "known-device", input: { mac: inventory[0].mac, knownMacs: inventory, policy, switchId: "lab-switch" }, expectedDecision: "accept", expectedReason: "known-dynamic-vlan" },
          { label: "unknown-device", input: { mac: "02:00:00:00:00:51", knownMacs: inventory, policy, switchId: "lab-switch" }, expectedDecision: "reject", expectedReason: "unknown-mac" },
        ] },
      });
      setResult("radiusMatrixResult", response.result);
    } catch (error) {
      setResult("radiusMatrixResult", { status: "error", reason: error.message });
    }
  }

  async function openPage() {
    state.view = "module";
    navActive("radius");
    await ensureInventory(true);
    const nasDevices = (state.inventory || []).filter((item) => item.id && item.ip && item.companyId);
    page.innerHTML = `
      <div class="headline radius-head">
        <div>
          <div class="crumb">${escapeHtml(t("radius.crumb"))}</div>
          <h2 id="radiusTitle">${escapeHtml(t("radius.title"))}</h2>
          <p class="subtitle">${escapeHtml(t("radius.subtitle"))}</p>
        </div>
        <span class="status-pill">${escapeHtml(t("radius.previewOnly"))}</span>
      </div>

      <div class="radius-grid">
        <section class="panel radius-card">
          <h3>${escapeHtml(t("radius.mab.title"))}</h3>
          <p class="subtitle">${escapeHtml(t("radius.mab.subtitle"))}</p>
          <form id="radiusMabForm" class="radius-form">
            <label>${escapeHtml(t("radius.mab.mac"))}<input id="radiusMabMac" class="ltr mono" required value="02:00:00:00:00:50"></label>
            <label>${escapeHtml(t("radius.mab.switchId"))}<input id="radiusMabSwitch" class="ltr" value="lab-switch"></label>
            <label class="check-row"><input id="radiusMabKnown" type="checkbox" checked> ${escapeHtml(t("radius.mab.known"))}</label>
            <label>${escapeHtml(t("radius.mab.knownMode"))}
              <select id="radiusMabKnownMode">
                <option value="accept-static">${escapeHtml(t("radius.mode.acceptStatic"))}</option>
                <option value="accept-dynamic" selected>${escapeHtml(t("radius.mode.acceptDynamic"))}</option>
                <option value="reject">${escapeHtml(t("radius.mode.reject"))}</option>
              </select>
            </label>
            <label>${escapeHtml(t("radius.mab.knownVlan"))}<input id="radiusMabKnownVlan" type="number" min="1" max="4094" value="20"></label>
            <label>${escapeHtml(t("radius.mab.unknownMode"))}
              <select id="radiusMabUnknownMode">
                <option value="reject" selected>${escapeHtml(t("radius.mode.reject"))}</option>
                <option value="guest-vlan">${escapeHtml(t("radius.mode.guestVlan"))}</option>
              </select>
            </label>
            <label>${escapeHtml(t("radius.mab.guestVlan"))}<input id="radiusMabGuestVlan" type="number" min="1" max="4094" value="30"></label>
            <button class="btn primary" type="submit">${escapeHtml(t("radius.action.preview"))}</button>
          </form>
          <pre id="radiusMabResult" class="radius-result" aria-live="polite"></pre>
        </section>

        <section class="panel radius-card">
          <h3>${escapeHtml(t("radius.admin.title"))}</h3>
          <p class="subtitle">${escapeHtml(t("radius.admin.subtitle"))}</p>
          <form id="radiusAdminForm" class="radius-form">
            <label>${escapeHtml(t("radius.admin.vendor"))}
              <select id="radiusAdminVendor">
                <option value="cisco">Cisco</option>
                <option value="mikrotik">MikroTik</option>
              </select>
            </label>
            <div id="radiusCiscoFields">
              <label>${escapeHtml(t("radius.admin.ciscoPrivilege"))}<input id="radiusCiscoPrivilege" type="number" min="0" max="15" value="15"></label>
            </div>
            <div id="radiusMikrotikFields" class="hidden">
              <label>${escapeHtml(t("radius.admin.mikrotikGroup"))}<input id="radiusMikrotikGroup" class="ltr" value="full"></label>
            </div>
            <button class="btn primary" type="submit">${escapeHtml(t("radius.action.preview"))}</button>
          </form>
          <pre id="radiusAdminResult" class="radius-result" aria-live="polite"></pre>
        </section>

        <section class="panel radius-card">
          <h3>${escapeHtml(t("radius.nas.title"))}</h3>
          <p class="subtitle">${escapeHtml(t("radius.nas.subtitle"))}</p>
          <form id="radiusNasForm" class="radius-form">
            <label>${escapeHtml(t("radius.nas.device"))}
              <select id="radiusNasDevice" required>
                <option value="">${escapeHtml(t("radius.nas.selectDevice"))}</option>
                ${nasDevices.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.ip)} — ${escapeHtml(item.ip)}</option>`).join("")}
              </select>
            </label>
            <label>${escapeHtml(t("radius.nas.id"))}<input id="radiusNasId" class="ltr" required value=""></label>
            <label>${escapeHtml(t("radius.nas.name"))}<input id="radiusNasName" required value="Lab NAS"></label>
            <label>${escapeHtml(t("radius.nas.ip"))}<input id="radiusNasIp" class="ltr mono" readonly></label>
            <label>${escapeHtml(t("radius.admin.vendor"))}
              <select id="radiusNasVendor">
                <option value="cisco">Cisco</option>
                <option value="mikrotik">MikroTik</option>
                <option value="other">${escapeHtml(t("radius.nas.otherVendor"))}</option>
              </select>
            </label>
            <div class="radius-service-grid">
              <label class="check-row"><input type="checkbox" name="radiusNasService" value="mab" checked> MAB</label>
              <label class="check-row"><input type="checkbox" name="radiusNasService" value="dot1x"> 802.1X</label>
              <label class="check-row"><input type="checkbox" name="radiusNasService" value="device-admin"> AAA</label>
            </div>
            <label class="check-row"><input id="radiusNasEnabled" type="checkbox"> ${escapeHtml(t("radius.nas.enabled"))}</label>
            <div class="row-actions">
              <button class="btn primary" type="submit">${escapeHtml(t("radius.nas.generateDraft"))}</button>
              <button id="radiusNasSave" class="btn" type="button">${escapeHtml(t("radius.nas.save"))}</button>
              <button id="radiusNasCancelEdit" class="btn hidden" type="button">${escapeHtml(t("common.cancel"))}</button>
            </div>
          </form>
          <pre id="radiusNasResult" class="radius-result" aria-live="polite"></pre>
          <h4>${escapeHtml(t("radius.nas.savedTitle"))}</h4>
          <div id="radiusNasProfilesList" class="radius-profile-list"></div>
        </section>

        <section class="panel radius-card">
          <h3>${escapeHtml(t("radius.admin.savedTitle"))}</h3>
          <p class="subtitle">${escapeHtml(t("radius.admin.savedSubtitle"))}</p>
          <form id="radiusSavedAdminForm" class="radius-form">
            <label>${escapeHtml(t("radius.admin.profileId"))}<input id="radiusSavedAdminId" class="ltr" required value=""></label>
            <label>${escapeHtml(t("radius.admin.profileName"))}<input id="radiusSavedAdminName" required value=""></label>
            <label>${escapeHtml(t("radius.admin.description"))}<input id="radiusSavedAdminDescription" value=""></label>
            <label>${escapeHtml(t("radius.admin.ciscoPrivilege"))}<input id="radiusSavedCiscoPrivilege" type="number" min="0" max="15" value="1"></label>
            <label>${escapeHtml(t("radius.admin.mikrotikGroup"))}<input id="radiusSavedMikrotikGroup" class="ltr" value="read"></label>
            <label class="check-row"><input id="radiusSavedAdminEnabled" type="checkbox"> ${escapeHtml(t("radius.admin.enabled"))}</label>
            <div class="row-actions">
              <button class="btn primary" type="submit">${escapeHtml(t("radius.admin.save"))}</button>
              <button id="radiusAdminCancelEdit" class="btn hidden" type="button">${escapeHtml(t("common.cancel"))}</button>
            </div>
          </form>
          <pre id="radiusSavedAdminResult" class="radius-result" aria-live="polite"></pre>
          <div id="radiusAdminProfilesList" class="radius-profile-list"></div>
        </section>

        <section class="panel radius-card radius-wide">
          <div class="row-actions">
            <div>
              <h3>${escapeHtml(t("radius.matrix.title"))}</h3>
              <p class="subtitle">${escapeHtml(t("radius.matrix.subtitle"))}</p>
            </div>
            <button id="radiusMatrixDemo" class="btn" type="button">${escapeHtml(t("radius.matrix.runDemo"))}</button>
          </div>
          <pre id="radiusMatrixResult" class="radius-result" aria-live="polite"></pre>
        </section>
      </div>

      <section class="panel radius-warning">
        <b>${escapeHtml(t("radius.warning.title"))}</b>
        <p>${escapeHtml(t("radius.warning.body"))}</p>
      </section>
    `;

    $("radiusMabForm").addEventListener("submit", runMabPreview);
    $("radiusAdminForm").addEventListener("submit", runAdminPreview);
    $("radiusAdminVendor").addEventListener("change", syncAdminFields);
    $("radiusMatrixDemo").addEventListener("click", runMatrixDemo);
    $("radiusNasForm").addEventListener("submit", runNasPreview);
    $("radiusNasDevice").addEventListener("change", syncNasDevice);
    $("radiusNasSave").addEventListener("click", saveNasProfile);
    $("radiusNasCancelEdit").addEventListener("click", resetNasEditor);
    $("radiusSavedAdminForm").addEventListener("submit", saveAdminProfile);
    $("radiusAdminCancelEdit").addEventListener("click", resetAdminEditor);
    syncAdminFields();
    syncNasDevice();
    await refreshProfiles();
  }

  return { openPage };
}
