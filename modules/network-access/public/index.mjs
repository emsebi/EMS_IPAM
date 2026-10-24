export function createUi(ctx) {
  const { state, $, page, request, isAdmin, ensureInventory, escapeHtml, formatNumber, navActive, setRoute, t, openPersonnelDialog, editPersonnel, toast } = ctx;

  async function openNetworkAccessPage(tab = "mac") {
    if (!isAdmin()) return toast(t("networkAccess.auth.adminOnly"));
    tab = tab === "personnel" ? "personnel" : "mac";
    state.view = "network-access";
    state.networkAccessTab = tab;
    state.currentSpaceId = null;
    state.data = null;
    navActive("networkAccess");
    setRoute(`/network-access/${tab}`);

    let rows = [];
    let total = 0;
    if (tab === "mac") {
      await ensureInventory(true);
      rows = state.inventory.filter((host) => host.mac && (!state.currentCompanyId || host.companyId === state.currentCompanyId));
      total = rows.length;
    } else {
      const result = await request(`/api/personnel?offset=${(state.personnelPage || 0) * 50}&limit=50`);
      rows = result.items || [];
      total = result.total || rows.length;
    }

    const columns = tab === "mac"
      ? ["mac", "ip", "device", "owner", "vlan"]
      : ["name", "employeeCode", "department", "company", "actions"];

    const body = rows.map((item) => tab === "mac"
      ? `<tr><td class="ltr mono">${escapeHtml(item.mac)}</td><td class="ltr mono">${escapeHtml(item.ip)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.vlan)}</td></tr>`
      : `<tr><td>${escapeHtml(item.fullName)}</td><td>${escapeHtml(item.employeeCode || "—")}</td><td>${escapeHtml(item.department)}</td><td>${escapeHtml(item.companyName || "—")}</td><td><button class="btn sm person-edit" data-id="${escapeHtml(item.id)}">${escapeHtml(t("common.edit"))}</button></td></tr>`
    ).join("");

    page.innerHTML = `<div class="headline"><div><div class="crumb">${escapeHtml(t("networkAccess.crumb"))}</div><h2>${escapeHtml(t("networkAccess.title"))}</h2></div></div>
      <div class="access-tabs" role="tablist"><button id="macTab" class="btn ${tab === "mac" ? "primary" : ""}" role="tab" aria-selected="${tab === "mac"}">${escapeHtml(t("networkAccess.tab.mac"))}</button><button id="personnelTab" class="btn ${tab === "personnel" ? "primary" : ""}" role="tab" aria-selected="${tab === "personnel"}">${escapeHtml(t("networkAccess.tab.personnel"))}</button></div>
      <section class="panel access-records"><div class="subtitle">${escapeHtml(t(tab === "mac" ? "networkAccess.mac.subtitle" : "networkAccess.personnel.subtitle"))}</div>
      <div class="row-actions"><b>${escapeHtml(t("networkAccess.count", { count: formatNumber(total) }))}</b>${tab === "personnel" ? `<button id="managePersonnel" class="btn primary">${escapeHtml(t("networkAccess.action.managePersonnel"))}</button>` : ""}</div>
      <div class="inventory-table-wrap"><table class="inventory-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(t(`networkAccess.column.${column}`))}</th>`).join("")}</tr></thead>
      <tbody>${body || `<tr><td colspan="5">${escapeHtml(t("networkAccess.empty"))}</td></tr>`}</tbody></table></div>
      ${tab === "personnel" ? `<div class="row-actions"><button id="personsPrevious" class="btn" ${(state.personnelPage || 0) === 0 ? "disabled" : ""}>${escapeHtml(t("common.previous"))}</button><button id="personsNext" class="btn" ${((state.personnelPage || 0) + 1) * 50 >= total ? "disabled" : ""}>${escapeHtml(t("common.next"))}</button></div>` : ""}</section>`;

    $("macTab").addEventListener("click", () => openNetworkAccessPage("mac"));
    $("personnelTab").addEventListener("click", () => openNetworkAccessPage("personnel"));
    $("managePersonnel")?.addEventListener("click", () => openPersonnelDialog());
    page.querySelectorAll(".person-edit").forEach((button) => button.addEventListener("click", async () => {
      await openPersonnelDialog();
      editPersonnel(rows.find((person) => person.id === button.dataset.id));
    }));
    $("personsPrevious")?.addEventListener("click", () => {
      state.personnelPage--;
      openNetworkAccessPage("personnel");
    });
    $("personsNext")?.addEventListener("click", () => {
      state.personnelPage = (state.personnelPage || 0) + 1;
      openNetworkAccessPage("personnel");
    });
  }

  return { openNetworkAccessPage };
}
