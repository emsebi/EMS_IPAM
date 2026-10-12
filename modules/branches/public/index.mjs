export function createUi(ctx) {
  const { state, $, page, request, ensureInventory, escapeHtml, navActive, t } = ctx;
  let routers = [];
  let selectedCompanyId = "";
  let routerEditId = null;
  let branchEditId = null;
  let branchEditDetails = null;

  const companies = () => (state.bootstrap?.companies || []).filter((item) => item.kind !== "branch");
  const branches = () => (state.bootstrap?.companies || []).filter((item) => item.kind === "branch");
  const branchesFor = (companyId) => branches().filter((item) => item.parentCompanyId === companyId);
  const currentCompany = () => companies().find((item) => item.id === selectedCompanyId) || companies()[0] || null;
  const selectedBranchId = () => $("branchesRouterBranch")?.value || "";

  function syncCompanySelection() {
    const company = currentCompany();
    selectedCompanyId = company?.id || "";
    if ($("branchesCompanyFilter")) $("branchesCompanyFilter").value = selectedCompanyId;
    if ($("branchParentCompany")) $("branchParentCompany").value = selectedCompanyId;
    if ($("branchesRouterCompany")) $("branchesRouterCompany").value = selectedCompanyId;
  }

  function routerMethodsFromForm() {
    const methods = [];
    for (const [protocol, checkboxId, portId] of [
      ["ssh", "branchesRouterSsh", "branchesRouterSshPort"],
      ["https", "branchesRouterHttps", "branchesRouterHttpsPort"],
      ["winbox", "branchesRouterWinbox", "branchesRouterWinboxPort"],
    ]) {
      if ($(checkboxId).checked) methods.push({ protocol, port: Number($(portId).value) });
    }
    return methods;
  }

  function setRouterMethods(methods = []) {
    const byProtocol = new Map(methods.map((item) => [item.protocol, item.port]));
    for (const [protocol, checkboxId, portId, defaultPort] of [
      ["ssh", "branchesRouterSsh", "branchesRouterSshPort", 22],
      ["https", "branchesRouterHttps", "branchesRouterHttpsPort", 443],
      ["winbox", "branchesRouterWinbox", "branchesRouterWinboxPort", 8291],
    ]) {
      $(checkboxId).checked = byProtocol.has(protocol);
      $(portId).value = String(byProtocol.get(protocol) || defaultPort);
    }
  }

  function renderBranchOptions() {
    const companyId = $("branchesRouterCompany")?.value || selectedCompanyId;
    const branchOptions = branchesFor(companyId);
    const select = $("branchesRouterBranch");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(t("branches.router.noBranch"))}</option>` +
      branchOptions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    if (branchOptions.some((item) => item.id === current)) select.value = current;
    renderHostOptions();
  }

  function renderHostOptions() {
    const companyId = $("branchesRouterCompany")?.value || selectedCompanyId;
    const branchId = selectedBranchId();
    const allowed = new Set([companyId, branchId].filter(Boolean));
    const select = $("branchesRouterHost");
    if (!select) return;
    const current = select.value;
    const hosts = (state.inventory || []).filter((item) => allowed.has(item.companyId));
    select.innerHTML = `<option value="">${escapeHtml(t("branches.router.noHost"))}</option>` +
      hosts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.ip)} — ${escapeHtml(item.ip)}</option>`).join("");
    if (hosts.some((item) => item.id === current)) select.value = current;
  }

  function renderGroups() {
    const company = currentCompany();
    const host = $("branchesGroups");
    if (!host) return;
    if (!company) {
      host.innerHTML = `<div class="empty-state">${escapeHtml(t("branches.emptyCompanies"))}</div>`;
      return;
    }
    const companyBranches = branchesFor(company.id);
    const routerRows = routers.filter((item) => item.companyId === company.id);
    const cards = companyBranches.map((branch) => {
      const items = routerRows.filter((router) => router.branchId === branch.id);
      return `<section class="panel branch-card" data-branch-id="${escapeHtml(branch.id)}">
        <div class="branch-card-head">
          <div><h3>${escapeHtml(branch.name)}</h3><small>${escapeHtml(branch.code || "")}${branch.address ? ` · ${escapeHtml(branch.address)}` : ""}</small></div>
          <div class="row-actions"><button class="btn sm branch-edit" data-id="${escapeHtml(branch.id)}">${escapeHtml(t("common.edit"))}</button><button class="btn sm danger branch-delete" data-id="${escapeHtml(branch.id)}">${escapeHtml(t("common.delete"))}</button></div>
        </div>
        <div class="branch-router-list">${routerList(items)}</div>
      </section>`;
    }).join("");
    const unassigned = routerRows.filter((router) => !router.branchId || !companyBranches.some((branch) => branch.id === router.branchId));
    host.innerHTML = cards + `<section class="panel branch-card branch-unassigned">
      <div class="branch-card-head"><div><h3>${escapeHtml(t("branches.unassigned.title"))}</h3><small>${escapeHtml(t("branches.unassigned.subtitle"))}</small></div></div>
      <div class="branch-router-list">${routerList(unassigned)}</div>
    </section>`;
    bindListActions();
  }

  function routerList(items) {
    return items.map((item) => `<div class="branch-router-row" data-router-id="${escapeHtml(item.id)}">
      <div><b>${escapeHtml(item.name)}</b><small><span class="ltr mono">${escapeHtml(item.managementAddress)}</span>${item.publicAddress ? ` · ${escapeHtml(t("branches.router.publicIp"))}: <span class="ltr mono">${escapeHtml(item.publicAddress)}</span>` : ""}</small><small>${escapeHtml(item.vendor)}${item.model ? ` · ${escapeHtml(item.model)}` : ""}${item.inventoryIp ? ` · IPAM: ${escapeHtml(item.inventoryIp)}` : ""}</small></div>
      <div class="branch-methods">${(item.accessMethods || []).map((method) => `<span class="status-pill">${escapeHtml(method.protocol.toUpperCase())}:${escapeHtml(method.port)}</span>`).join("")}</div>
      <div class="row-actions"><button class="btn sm router-edit" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.edit"))}</button><button class="btn sm danger router-delete" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.delete"))}</button></div>
    </div>`).join("") || `<div class="empty-state compact-empty">${escapeHtml(t("branches.router.empty"))}</div>`;
  }

  function bindListActions() {
    page.querySelectorAll(".router-edit").forEach((node) => node.addEventListener("click", () => editRouter(node.dataset.id)));
    page.querySelectorAll(".router-delete").forEach((node) => node.addEventListener("click", () => deleteRouter(node.dataset.id)));
    page.querySelectorAll(".branch-edit").forEach((node) => node.addEventListener("click", () => editBranch(node.dataset.id)));
    page.querySelectorAll(".branch-delete").forEach((node) => node.addEventListener("click", () => deleteBranch(node.dataset.id)));
  }

  function resetRouterForm() {
    routerEditId = null;
    $("branchesRouterForm").reset();
    $("branchesRouterTitle").textContent = t("branches.router.new");
    $("branchesRouterCancel").classList.add("hidden");
    $("branchesRouterCompany").disabled = false;
    $("branchesRouterCompany").value = selectedCompanyId;
    setRouterMethods([]);
    renderBranchOptions();
  }

  function editRouter(id) {
    const item = routers.find((router) => router.id === id);
    if (!item) return;
    routerEditId = item.id;
    $("branchesRouterTitle").textContent = t("branches.router.edit");
    $("branchesRouterCompany").value = item.companyId;
    $("branchesRouterCompany").disabled = true;
    renderBranchOptions();
    $("branchesRouterBranch").value = item.branchId || "";
    renderHostOptions();
    $("branchesRouterHost").value = item.inventoryHostId || "";
    $("branchesRouterName").value = item.name;
    $("branchesRouterManagement").value = item.managementAddress;
    $("branchesRouterPublic").value = item.publicAddress || "";
    $("branchesRouterVendor").value = item.vendor;
    $("branchesRouterModel").value = item.model || "";
    $("branchesRouterNotes").value = item.notes || "";
    setRouterMethods(item.accessMethods || []);
    $("branchesRouterCancel").classList.remove("hidden");
    $("branchesRouterForm").scrollIntoView({ block: "nearest" });
  }

  async function saveRouter(event) {
    event.preventDefault();
    const body = {
      ...(routerEditId ? { id: routerEditId } : { id: crypto.randomUUID() }),
      companyId: $("branchesRouterCompany").value,
      branchId: $("branchesRouterBranch").value || null,
      inventoryHostId: $("branchesRouterHost").value || null,
      name: $("branchesRouterName").value.trim(),
      managementAddress: $("branchesRouterManagement").value.trim(),
      publicAddress: $("branchesRouterPublic").value.trim() || null,
      vendor: $("branchesRouterVendor").value,
      model: $("branchesRouterModel").value.trim(),
      notes: $("branchesRouterNotes").value.trim(),
      accessMethods: routerMethodsFromForm(),
    };
    try {
      await request(routerEditId ? `/api/branches/routers/${encodeURIComponent(routerEditId)}` : "/api/branches/routers", {
        method: routerEditId ? "PUT" : "POST", body,
      });
      resetRouterForm();
      await refreshData();
    } catch (error) {
      $("branchesRouterError").textContent = error.message;
    }
  }

  async function deleteRouter(id) {
    const item = routers.find((router) => router.id === id);
    if (!item || !confirm(t("branches.router.confirmDelete", { name: item.name }))) return;
    try { await request(`/api/branches/routers/${encodeURIComponent(id)}`, { method: "DELETE" }); await refreshData(); }
    catch (error) { $("branchesRouterError").textContent = error.message; }
  }

  function resetBranchForm() {
    branchEditId = null;
    branchEditDetails = null;
    $("branchForm").reset();
    $("branchFormTitle").textContent = t("branches.branch.new");
    $("branchParentCompany").disabled = false;
    $("branchParentCompany").value = selectedCompanyId;
    $("branchCancelEdit").classList.add("hidden");
    $("branchFormError").textContent = "";
  }

  async function editBranch(id) {
    try {
      const details = await request(`/api/companies/${encodeURIComponent(id)}`);
      const item = details.company;
      if (!item || item.kind !== "branch") return;
      branchEditId = item.id;
      branchEditDetails = details;
      $("branchFormTitle").textContent = t("branches.branch.edit");
      $("branchParentCompany").value = item.parentCompanyId || "";
      $("branchParentCompany").disabled = true;
      $("branchName").value = item.name || "";
      $("branchCode").value = item.code || "";
      $("branchAddress").value = item.address || "";
      $("branchNotes").value = item.notes || "";
      $("branchCancelEdit").classList.remove("hidden");
      $("branchForm").scrollIntoView({ block: "nearest" });
    } catch (error) { $("branchFormError").textContent = error.message; }
  }

  async function saveBranch(event) {
    event.preventDefault();
    const parentCompanyId = $("branchParentCompany").value;
    const basic = {
      parentCompanyId, kind: "branch", name: $("branchName").value.trim(), code: $("branchCode").value.trim(),
      address: $("branchAddress").value.trim(), notes: $("branchNotes").value.trim(),
    };
    try {
      if (branchEditId && branchEditDetails) {
        const current = branchEditDetails.company;
        await request(`/api/companies/${encodeURIComponent(branchEditId)}`, { method: "PUT", body: {
          parentCompanyId, kind: "branch", name: basic.name, code: basic.code,
          description: current.description || "", address: basic.address, postalCode: current.postalCode || "",
          phone: current.phone || "", managerName: current.managerName || "", latitude: current.latitude,
          longitude: current.longitude, notes: basic.notes,
          contacts: branchEditDetails.contacts || [], connections: branchEditDetails.connections || [],
        } });
      } else {
        await request("/api/companies", { method: "POST", body: { ...basic, contacts: [], connections: [] } });
      }
      await refreshBootstrap();
      resetBranchForm();
      renderGroups();
      renderBranchOptions();
    } catch (error) { $("branchFormError").textContent = error.message; }
  }

  async function deleteBranch(id) {
    const item = branches().find((branch) => branch.id === id);
    if (!item) return;
    if (routers.some((router) => router.branchId === id)) {
      $("branchFormError").textContent = t("branches.branch.deleteBlocked");
      return;
    }
    if (!confirm(t("branches.branch.confirmDelete", { name: item.name }))) return;
    try {
      await request(`/api/companies/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshBootstrap();
      renderGroups();
      renderBranchOptions();
    } catch (error) { $("branchFormError").textContent = error.message; }
  }

  async function refreshBootstrap() {
    state.bootstrap = await request("/api/bootstrap");
    if (!companies().some((item) => item.id === selectedCompanyId)) selectedCompanyId = companies()[0]?.id || "";
    syncCompanySelection();
  }

  async function refreshData() {
    const result = await request("/api/branches/routers");
    routers = result.items || [];
    renderGroups();
  }

  async function openPage() {
    state.view = "module";
    navActive("branches");
    await ensureInventory(true);
    if (!selectedCompanyId || !companies().some((item) => item.id === selectedCompanyId)) selectedCompanyId = companies()[0]?.id || "";

    page.innerHTML = `<div class="headline"><div><div class="crumb">${escapeHtml(t("branches.crumb"))}</div><h2>${escapeHtml(t("branches.title"))}</h2><p class="subtitle">${escapeHtml(t("branches.subtitle"))}</p></div></div>
      <section class="panel branches-filter"><label>${escapeHtml(t("branches.company"))}<select id="branchesCompanyFilter">${companies().map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label></section>
      <div class="branches-layout">
        <div id="branchesGroups" class="branches-groups"></div>
        <aside class="branches-editors">
          <section class="panel"><h3 id="branchFormTitle">${escapeHtml(t("branches.branch.new"))}</h3>
            <form id="branchForm" class="branches-form">
              <label>${escapeHtml(t("branches.branch.parent"))}<select id="branchParentCompany" required>${companies().map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label>
              <label>${escapeHtml(t("branches.branch.name"))}<input id="branchName" required></label>
              <label>${escapeHtml(t("branches.branch.code"))}<input id="branchCode"></label>
              <label>${escapeHtml(t("branches.branch.address"))}<textarea id="branchAddress" rows="2"></textarea></label>
              <label>${escapeHtml(t("branches.branch.notes"))}<textarea id="branchNotes" rows="2"></textarea></label>
              <div id="branchFormError" class="form-error"></div>
              <div class="row-actions"><button class="btn primary" type="submit">${escapeHtml(t("common.save"))}</button><button id="branchCancelEdit" class="btn hidden" type="button">${escapeHtml(t("common.cancel"))}</button></div>
            </form>
          </section>
          <section class="panel"><h3 id="branchesRouterTitle">${escapeHtml(t("branches.router.new"))}</h3>
            <form id="branchesRouterForm" class="branches-form">
              <label>${escapeHtml(t("branches.company"))}<select id="branchesRouterCompany" required>${companies().map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label>
              <label>${escapeHtml(t("branches.branch.label"))}<select id="branchesRouterBranch"></select></label>
              <label>${escapeHtml(t("branches.router.host"))}<select id="branchesRouterHost"></select></label>
              <label>${escapeHtml(t("branches.router.name"))}<input id="branchesRouterName" required></label>
              <label>${escapeHtml(t("branches.router.management"))}<input id="branchesRouterManagement" class="ltr" required placeholder="10.0.0.1"></label>
              <label>${escapeHtml(t("branches.router.publicIp"))}<input id="branchesRouterPublic" class="ltr" placeholder="203.0.113.10"></label>
              <label>${escapeHtml(t("branches.router.vendor"))}<select id="branchesRouterVendor"><option value="mikrotik">MikroTik</option><option value="cisco">Cisco</option><option value="ubiquiti">Ubiquiti</option><option value="other">${escapeHtml(t("branches.router.other"))}</option></select></label>
              <label>${escapeHtml(t("branches.router.model"))}<input id="branchesRouterModel"></label>
              <fieldset class="branch-method-fieldset"><legend>${escapeHtml(t("branches.router.methods"))}</legend>
                <div class="branch-method-row"><label><input id="branchesRouterSsh" type="checkbox"> SSH</label><input id="branchesRouterSshPort" type="number" min="1" max="65535" value="22"></div>
                <div class="branch-method-row"><label><input id="branchesRouterHttps" type="checkbox"> HTTPS</label><input id="branchesRouterHttpsPort" type="number" min="1" max="65535" value="443"></div>
                <div class="branch-method-row"><label><input id="branchesRouterWinbox" type="checkbox"> WinBox</label><input id="branchesRouterWinboxPort" type="number" min="1" max="65535" value="8291"></div>
              </fieldset>
              <label>${escapeHtml(t("branches.router.notes"))}<textarea id="branchesRouterNotes" rows="2"></textarea></label>
              <div id="branchesRouterError" class="form-error"></div>
              <div class="row-actions"><button class="btn primary" type="submit">${escapeHtml(t("common.save"))}</button><button id="branchesRouterCancel" class="btn hidden" type="button">${escapeHtml(t("common.cancel"))}</button></div>
            </form>
          </section>
        </aside>
      </div>`;

    $("branchesCompanyFilter").addEventListener("change", () => {
      selectedCompanyId = $("branchesCompanyFilter").value;
      syncCompanySelection(); resetBranchForm(); resetRouterForm(); renderGroups();
    });
    $("branchesRouterCompany").addEventListener("change", renderBranchOptions);
    $("branchesRouterBranch").addEventListener("change", renderHostOptions);
    $("branchForm").addEventListener("submit", saveBranch);
    $("branchCancelEdit").addEventListener("click", resetBranchForm);
    $("branchesRouterForm").addEventListener("submit", saveRouter);
    $("branchesRouterCancel").addEventListener("click", resetRouterForm);

    syncCompanySelection();
    resetBranchForm();
    resetRouterForm();
    await refreshData();
  }

  return { openPage };
}
