export function createUi(ctx) {
  const { state, $, page, request, escapeHtml, navActive, t } = ctx;

  const jsonText = (value) => JSON.stringify(value, null, 2);
  const setResult = (id, value) => {
    const node = $(id);
    if (!node) return;
    node.textContent = jsonText(value);
  };

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
    syncAdminFields();
  }

  return { openPage };
}
