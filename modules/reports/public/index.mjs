export function createUi(ctx) {
  const { state, $, page, request, escapeHtml, formatNumber, formatDateTime, navActive, t } = ctx;
  const metrics = [
    ["companies", "reports.metric.companies"], ["branches", "reports.metric.branches"],
    ["hosts", "reports.metric.hosts"], ["activePersonnel", "reports.metric.personnel"],
    ["accessPoints", "reports.metric.aps"], ["stations", "reports.metric.stations"],
    ["radiusNas", "reports.metric.radiusNas"], ["radiusPolicies", "reports.metric.radiusPolicies"],
  ];

  async function refresh() {
    const [summaryResult, auditResult] = await Promise.all([
      request("/api/reports/summary"), request("/api/reports/audit?limit=50"),
    ]);
    const summary = summaryResult.summary || {};
    $("reportsMetrics").innerHTML = metrics.map(([key, label]) => `<article class="report-metric"><strong>${escapeHtml(formatNumber(summary[key] || 0))}</strong><span>${escapeHtml(t(label))}</span></article>`).join("");
    const rows = auditResult.items || [];
    $("reportsAuditBody").innerHTML = rows.map((item) => `<tr><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.username || "—")}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entityType)}</td><td>${escapeHtml(item.companyName || "—")}</td></tr>`).join("") ||
      `<tr><td colspan="5">${escapeHtml(t("reports.audit.empty"))}</td></tr>`;
  }

  async function openPage() {
    state.view = "module";
    navActive("reports");
    page.innerHTML = `<div class="headline"><div><div class="crumb">${escapeHtml(t("reports.crumb"))}</div><h2>${escapeHtml(t("reports.title"))}</h2><p class="subtitle">${escapeHtml(t("reports.subtitle"))}</p></div><button id="reportsRefresh" class="btn" type="button">${escapeHtml(t("reports.refresh"))}</button></div>
      <section id="reportsMetrics" class="reports-metrics" aria-label="${escapeHtml(t("reports.summary"))}"></section>
      <section class="panel"><h3>${escapeHtml(t("reports.audit.title"))}</h3><p class="subtitle">${escapeHtml(t("reports.audit.subtitle"))}</p>
        <div class="inventory-table-wrap"><table class="inventory-table"><thead><tr>
          <th>${escapeHtml(t("reports.audit.time"))}</th><th>${escapeHtml(t("reports.audit.user"))}</th><th>${escapeHtml(t("reports.audit.action"))}</th><th>${escapeHtml(t("reports.audit.entity"))}</th><th>${escapeHtml(t("reports.audit.company"))}</th>
        </tr></thead><tbody id="reportsAuditBody"></tbody></table></div>
      </section>`;
    $("reportsRefresh").addEventListener("click", () => refresh().catch((error) => { $("reportsAuditBody").innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`; }));
    await refresh();
  }
  return { openPage };
}
