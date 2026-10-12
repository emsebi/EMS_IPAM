/**
 * Offline, storage-agnostic branch/router inventory normalization.
 * This is NOT a router connector or credentials store.
 */
import { isIP } from 'node:net';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const hostnamePattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const forbidden = /(?:password|passwd|secret|token|credential|private.?key|community)/i;
const vendors = new Set(['mikrotik', 'cisco', 'ubiquiti', 'other']);
const protocols = new Set(['ssh', 'https', 'http', 'winbox', 'api', 'api-ssl', 'snmp']);

function plainRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
function noSecrets(input, issues) {
  for (const key of Object.keys(input)) if (forbidden.test(key)) issues.push(`forbidden-field:${key}`);
}
function id(value, field, issues, { optional = false } = {}) {
  if (optional && (value === '' || value == null)) return null;
  if (typeof value !== 'string' || !idPattern.test(value)) { issues.push(`invalid-${field}`); return null; }
  return value;
}
function text(value, field, issues, { max = 160, required = false } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') { issues.push(`invalid-${field}`); return ''; }
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    issues.push(`invalid-${field}`); return '';
  }
  return trimmed;
}

export function normalizeEndpoint(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || /[\s/@?#\\]/.test(input)) return null;
  if (isIP(input)) return input.toLowerCase();
  if (/^\d+(?:\.\d+){3}$/.test(input)) return null;
  if (!hostnamePattern.test(input)) return null;
  return input.toLowerCase();
}

export function prepareBranch(input) {
  const issues = [];
  if (!plainRecord(input)) return { ok: false, value: null, issues: ['invalid-branch'] };
  noSecrets(input, issues);
  const value = {
    id: id(input.id, 'id', issues),
    companyId: id(input.companyId, 'company-id', issues),
    name: text(input.name, 'name', issues, { required: true }),
    code: text(input.code, 'code', issues, { max: 64 }),
    address: text(input.address, 'address', issues, { max: 500 }),
    notes: text(input.notes, 'notes', issues, { max: 2000 }),
  };
  return { ok: issues.length === 0, value: issues.length ? null : value, issues };
}

export function prepareRouter(input, branches = []) {
  const issues = [];
  if (!plainRecord(input)) return { ok: false, value: null, issues: ['invalid-router'] };
  noSecrets(input, issues);
  if (!Array.isArray(branches) || branches.some((branch) => !plainRecord(branch))) {
    return { ok: false, value: null, issues: ['invalid-branches'] };
  }
  const routerId = id(input.id, 'id', issues);
  const companyId = id(input.companyId, 'company-id', issues);
  const branchId = id(input.branchId, 'branch-id', issues, { optional: true });
  const inventoryHostId = id(input.inventoryHostId, 'inventory-host-id', issues, { optional: true });
  const name = text(input.name, 'name', issues, { required: true });
  const managementAddress = normalizeEndpoint(input.managementAddress);
  if (!managementAddress) issues.push('invalid-management-address');
  const publicAddress = input.publicAddress == null || input.publicAddress === '' ? null : normalizeEndpoint(input.publicAddress);
  if (input.publicAddress != null && input.publicAddress !== '' && (!publicAddress || !isIP(publicAddress))) issues.push('invalid-public-address');
  const vendor = input.vendor == null || input.vendor === '' ? 'other' : input.vendor;
  if (!vendors.has(vendor)) issues.push('invalid-vendor');
  const model = text(input.model, 'model', issues, { max: 120 });
  const notes = text(input.notes, 'notes', issues, { max: 2000 });
  let accessMethods = [];
  if (input.accessMethods != null) {
    if (!Array.isArray(input.accessMethods) || input.accessMethods.length > 12) issues.push('invalid-access-methods');
    else {
      const seen = new Set();
      for (const entry of input.accessMethods) {
        if (!plainRecord(entry) || !protocols.has(entry.protocol) || !Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535 || Object.keys(entry).some((key) => forbidden.test(key))) {
          issues.push('invalid-access-method'); continue;
        }
        const key = `${entry.protocol}:${entry.port}`;
        if (seen.has(key)) { issues.push('duplicate-access-method'); continue; }
        seen.add(key);
        accessMethods.push({ protocol: entry.protocol, port: entry.port });
      }
    }
  }
  if (branchId) {
    const matches = branches.filter((branch) => branch.id === branchId);
    if (matches.length !== 1) issues.push('invalid-branch-reference');
    else if (matches[0].companyId !== companyId) issues.push('cross-company-branch');
  }
  const value = { id: routerId, companyId, branchId, inventoryHostId, name, managementAddress, publicAddress, vendor, model, notes, accessMethods };
  return { ok: issues.length === 0, value: issues.length ? null : value, issues };
}

export function groupRoutersByBranch({ branches = [], routers = [], companyId } = {}) {
  if (!Array.isArray(branches) || !Array.isArray(routers) || typeof companyId !== 'string' || !idPattern.test(companyId)) {
    return { ok: false, groups: [], unassigned: [], issues: ['invalid-inventory'] };
  }
  if ([...branches, ...routers].some((record) => !plainRecord(record))) return { ok: false, groups: [], unassigned: [], issues: ['invalid-inventory'] };
  const ownBranches = branches.filter((branch) => branch.companyId === companyId);
  const ownRouters = routers.filter((router) => router.companyId === companyId);
  const byId = new Map(ownBranches.map((branch) => [branch.id, { branch, routers: [] }]));
  if (byId.size !== ownBranches.length || ownBranches.some((branch) => typeof branch.id !== 'string')) {
    return { ok: false, groups: [], unassigned: [], issues: ['duplicate-or-invalid-branch-id'] };
  }
  const unassigned = [];
  for (const router of ownRouters) {
    const group = router.branchId && byId.get(router.branchId);
    if (group) group.routers.push(router); else unassigned.push(router);
  }
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en');
  const groups = [...byId.values()].sort((a, b) => byName(a.branch, b.branch))
    .map(({ branch, routers }) => ({ branch, routers: [...routers].sort(byName) }));
  return { ok: true, groups, unassigned: [...unassigned].sort(byName), issues: [] };
}
