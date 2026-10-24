/**
 * Offline 802.1X authorization policy preview AFTER external EAP verification.
 * NOT an EAP verifier, RADIUS server, NAC enforcement, or a trusted auth source.
 * Never pass caller-provided `authentication` directly into a live access path.
 */
import { validVlan } from './policy-preview.mjs';
import { normalizeNasIp } from './nas-inventory.mjs';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const id = (value) => typeof value === 'string' && idPattern.test(value);
const deny = (reason, classification = 'invalid') => ({ decision: 'reject', classification, reason, replyAttributes: {} });
const vlanReply = (vlan) => ({ 'Tunnel-Type': 'VLAN', 'Tunnel-Medium-Type': 'IEEE-802', 'Tunnel-Private-Group-Id': String(vlan) });
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).every((key) =>
    typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
const onlyKeys = (obj, keys) => Object.keys(obj).every((key) => keys.includes(key));

export function previewDot1xDecision(input = {}) {
  if (!plain(input) || !onlyKeys(input, ['companyId', 'authentication', 'nasProfile', 'principals', 'policy'])) return deny('invalid-input');
  const { companyId, authentication, nasProfile, principals, policy } = input;
  if (!id(companyId)) return deny('invalid-company');
  if (!plain(nasProfile) || !onlyKeys(nasProfile, ['id', 'companyId', 'deviceId', 'name', 'vendor', 'nasIp', 'enabled', 'services', 'authPort', 'acctPort']) ||
    !id(nasProfile.id) || !id(nasProfile.deviceId) || nasProfile.companyId !== companyId ||
    !['cisco', 'mikrotik', 'other'].includes(nasProfile.vendor) ||
    !normalizeNasIp(nasProfile.nasIp) || nasProfile.enabled !== true ||
    !Array.isArray(nasProfile.services) || !nasProfile.services.includes('dot1x') ||
    nasProfile.services.some((service) => !['dot1x', 'mab', 'device-admin'].includes(service)) ||
    new Set(nasProfile.services).size !== nasProfile.services.length ||
    !Number.isInteger(nasProfile.authPort) || nasProfile.authPort < 1 || nasProfile.authPort > 65535 ||
    !Number.isInteger(nasProfile.acctPort) || nasProfile.acctPort < 1 || nasProfile.acctPort > 65535 ||
    nasProfile.authPort === nasProfile.acctPort) return deny('invalid-nas');
  if (!plain(policy) || !onlyKeys(policy, ['enabled', 'assignments']) || policy.enabled !== true) return deny('policy-disabled');
  if (!Array.isArray(policy.assignments) || policy.assignments.length > 128) return deny('invalid-policy');
  const assignments = new Map();
  for (const rule of policy.assignments) {
    if (!plain(rule) || !onlyKeys(rule, ['role', 'mode', 'vlan']) || !id(rule.role) ||
      !['accept-static', 'accept-dynamic', 'reject'].includes(rule.mode) || assignments.has(rule.role) ||
      (rule.mode === 'accept-dynamic' ? validVlan(rule.vlan) === null : rule.vlan !== undefined)) {
      return deny('invalid-policy');
    }
    assignments.set(rule.role, rule);
  }
  if (!plain(authentication) || !onlyKeys(authentication, ['status', 'principalId', 'source']) ||
    !['verified', 'failed'].includes(authentication.status) || authentication.source !== 'trusted-eap' ||
    !id(authentication.principalId)) return deny('invalid-authentication');
  if (authentication.status !== 'verified') return deny('eap-not-verified', 'unauthenticated');
  if (!Array.isArray(principals) || principals.length > 5000 || principals.some((p) =>
    !plain(p) || !onlyKeys(p, ['id', 'companyId', 'enabled', 'roles']) || !id(p.id) || !id(p.companyId) ||
    typeof p.enabled !== 'boolean' || !Array.isArray(p.roles) || p.roles.length > 32 ||
    p.roles.some((role) => !id(role)) || new Set(p.roles).size !== p.roles.length)) return deny('invalid-principals');
  const matches = principals.filter((p) => p.id === authentication.principalId);
  if (matches.length !== 1) return deny(matches.length ? 'ambiguous-principal' : 'unknown-principal', 'principal');
  const principal = matches[0];
  if (principal.companyId !== companyId) return deny('cross-company-principal', 'principal');
  if (!principal.enabled) return deny('principal-disabled', 'principal');
  const matchedRules = principal.roles.filter((role) => assignments.has(role)).map((role) => assignments.get(role));
  if (matchedRules.length === 0) return deny('no-matching-role', 'principal');
  if (matchedRules.length !== 1) return deny('ambiguous-role', 'principal');
  const rule = matchedRules[0];
  if (rule.mode === 'reject') return deny('role-rejected', 'principal');
  return { decision: 'accept', classification: 'principal', reason: rule.mode === 'accept-static' ? 'role-static-vlan' : 'role-dynamic-vlan',
    replyAttributes: rule.mode === 'accept-static' ? {} : vlanReply(validVlan(rule.vlan)) };
}
