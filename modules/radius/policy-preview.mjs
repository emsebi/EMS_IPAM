/**
 * Offline MAB policy decision preview only. NOT an enforcement or RADIUS server.
 * Invalid or ambiguous input fails closed; no I/O, secrets or config pushes.
 */
export function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  let hex;
  if (/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(input)) hex = input.replaceAll(':', '');
  else if (/^(?:[0-9a-f]{2}-){5}[0-9a-f]{2}$/i.test(input)) hex = input.replaceAll('-', '');
  else if (/^[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}$/i.test(input)) hex = input.replaceAll('.', '');
  else if (/^[0-9a-f]{12}$/i.test(input)) hex = input;
  else return null;
  hex = hex.toUpperCase();
  if (hex === '000000000000' || (parseInt(hex.slice(0, 2), 16) & 1) !== 0) return null;
  return hex.match(/.{2}/g).join(':');
}
export function validVlan(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^[1-9][0-9]{0,3}$/.test(text)) return null;
  const vlan = Number(text);
  return vlan >= 1 && vlan <= 4094 ? vlan : null;
}
const deny = (reason, classification = 'invalid') => ({
  decision: 'reject', classification, reason, replyAttributes: {},
});
const vlanReply = (vlan) => ({
  'Tunnel-Type': 'VLAN',
  'Tunnel-Medium-Type': 'IEEE-802',
  'Tunnel-Private-Group-Id': String(vlan),
});
export function previewMabDecision({ mac, knownMacs = [], policy = {}, switchId = '' } = {}) {
  const normalized = normalizeMac(mac);
  if (!normalized) return deny('invalid-mac');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || policy.enabled !== true) return deny('policy-disabled');
  if (!Array.isArray(knownMacs)) return deny('invalid-inventory');
  if (typeof switchId !== 'string' || (switchId !== '' && !/^[A-Za-z0-9_.:-]{1,64}$/.test(switchId))) return deny('invalid-switch-id');
  const overrides = policy.switchOverrides;
  if (overrides !== undefined && (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))) return deny('invalid-policy');
  const hasOverride = Boolean(switchId) && Object.hasOwn(overrides || {}, switchId);
  const override = hasOverride ? overrides[switchId] : null;
  if (hasOverride && (!override || typeof override !== 'object' || Array.isArray(override))) return deny('invalid-policy');
  if (override && override.enabled !== undefined && typeof override.enabled !== 'boolean') return deny('invalid-policy');
  if (override?.enabled === false) return deny('switch-policy-disabled');
  const knownPolicy = override?.known ?? policy.known;
  const unknownPolicy = override?.unknown ?? policy.unknown;
  if (!knownPolicy || typeof knownPolicy !== 'object' || Array.isArray(knownPolicy) ||
      !['accept-static', 'accept-dynamic', 'reject'].includes(knownPolicy.mode)) return deny('invalid-policy');
  if (!unknownPolicy || typeof unknownPolicy !== 'object' || Array.isArray(unknownPolicy) ||
      !['reject', 'guest-vlan'].includes(unknownPolicy.mode)) return deny('invalid-policy');
  const matches = knownMacs.filter(record => record && normalizeMac(record.mac) === normalized);
  if (matches.length > 1) return deny('ambiguous-mac', 'known');
  if (matches.length === 1) {
    const record = matches[0];
    if (record.enabled !== true) return deny('mac-not-approved', 'known');
    if (knownPolicy.mode === 'reject') return deny('known-policy-reject', 'known');
    if (knownPolicy.mode === 'accept-static') return { decision: 'accept', classification: 'known', reason: 'known-static-vlan', replyAttributes: {} };
    const vlan = validVlan(record.vlan ?? knownPolicy.vlan);
    if (vlan === null) return deny('invalid-known-vlan', 'known');
    return { decision: 'accept', classification: 'known', reason: 'known-dynamic-vlan', replyAttributes: vlanReply(vlan) };
  }
  if (unknownPolicy.mode === 'reject') return deny('unknown-mac', 'unknown');
  const vlan = validVlan(unknownPolicy.vlan);
  if (vlan === null) return deny('invalid-guest-vlan', 'unknown');
  return { decision: 'accept', classification: 'unknown', reason: 'unknown-guest-vlan', replyAttributes: vlanReply(vlan) };
}
