const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MAX_RECORDS = 10000;
function validRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && typeof value.id === 'string' && idPattern.test(value.id)
    && typeof value.companyId === 'string' && idPattern.test(value.companyId);
}
export function auditBranchRouterLinks({ branches = [], routers = [], hosts = [] } = {}) {
  const inputs = { branch: branches, router: routers, host: hosts };
  for (const [kind, records] of Object.entries(inputs)) {
    if (!Array.isArray(records) || records.length > MAX_RECORDS || records.some((record) => !validRecord(record))) {
      return { ok: false, issues: [{ code: 'invalid-inventory', kind, id: null }] };
    }
  }
  const issues = [], maps = {};
  for (const [kind, records] of Object.entries(inputs)) {
    const index = new Map();
    for (const record of records) {
      if (index.has(record.id)) issues.push({ code: `duplicate-${kind}-id`, kind, id: record.id });
      else index.set(record.id, record);
    }
    maps[kind] = index;
  }
  for (const router of routers) {
    if (router.branchId != null && router.branchId !== '') {
      if (typeof router.branchId !== 'string' || !idPattern.test(router.branchId)) issues.push({ code: 'invalid-branch-reference', kind: 'router', id: router.id });
      else {
        const branch = maps.branch.get(router.branchId);
        if (!branch) issues.push({ code: 'missing-branch', kind: 'router', id: router.id });
        else if (branch.companyId !== router.companyId) issues.push({ code: 'cross-company-branch', kind: 'router', id: router.id });
      }
    }
    if (router.inventoryHostId != null && router.inventoryHostId !== '') {
      if (typeof router.inventoryHostId !== 'string' || !idPattern.test(router.inventoryHostId)) issues.push({ code: 'invalid-host-reference', kind: 'router', id: router.id });
      else {
        const host = maps.host.get(router.inventoryHostId);
        if (!host) issues.push({ code: 'missing-host', kind: 'router', id: router.id });
        else if (host.companyId !== router.companyId) issues.push({ code: 'cross-company-host', kind: 'router', id: router.id });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
