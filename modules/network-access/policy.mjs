// NAC planning/preview engine. Never call from a live RADIUS authorize path.
const error = message => Object.assign(new Error(message), { status: 400 });
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = value => typeof value === 'string' && uuidRe.test(value);
export function normalizeMac(value) {
  if (typeof value !== 'string') throw error('MAC must be text');
  const compact = value.replace(/[.:-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact) || compact === '000000000000' ||
      (parseInt(compact.slice(0, 2), 16) & 1)) throw error('Invalid unicast MAC');
  return compact.match(/.{2}/g).join(':');
}
export function vlan(value) {
  if (!/^[1-9][0-9]{0,3}$/.test(String(value)) || Number(value) > 4094)
    throw error('VLAN must be between 1 and 4094');
  return Number(value);
}
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(k => !keys.includes(k))) throw error('Invalid fields');
}
export function prepareProfile(input) {
  object(input, ['name','description','enabled','knownMode','knownVlan','unknownMode','guestVlan']);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw error('Invalid profile name');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 500 || /[\x00-\x1f\x7f]/.test(description)) throw error('Invalid description');
  if (typeof input.enabled !== 'boolean') throw error('Enabled must be boolean');
  if (!['accept-static','accept-vlan','reject'].includes(input.knownMode)) throw error('Invalid known-MAC action');
  if (!['reject','guest-vlan'].includes(input.unknownMode)) throw error('Invalid unknown-MAC action');
  const knownVlan = input.knownMode === 'accept-vlan' ? vlan(input.knownVlan) : null;
  const guestVlan = input.unknownMode === 'guest-vlan' ? vlan(input.guestVlan) : null;
  if (input.knownMode !== 'accept-vlan' && input.knownVlan != null && input.knownVlan !== '') throw error('Unexpected known VLAN');
  if (input.unknownMode !== 'guest-vlan' && input.guestVlan != null && input.guestVlan !== '') throw error('Unexpected guest VLAN');
  if (knownVlan !== null && guestVlan === knownVlan) throw error('Known VLAN and guest VLAN must be different');
  return {name, description, enabled: input.enabled, knownMode: input.knownMode, knownVlan, unknownMode: input.unknownMode, guestVlan};
}
export function prepareRule(input) {
  object(input, ['mode','vlan','enabled','note']);
  if (!['reject','accept-static','accept-vlan'].includes(input.mode)) throw error('Invalid MAC rule');
  if (typeof input.enabled !== 'boolean') throw error('Enabled must be boolean');
  const assignedVlan = input.mode === 'accept-vlan' ? vlan(input.vlan) : null;
  if (input.mode !== 'accept-vlan' && input.vlan != null && input.vlan !== '') throw error('Unexpected VLAN');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 500 || /[\x00-\x1f\x7f]/.test(note)) throw error('Invalid note');
  return {mode:input.mode, vlan:assignedVlan, enabled:input.enabled, note};
}
export function simulate({nas, profile, binding, registry, rule}) {
  const reject = reason => ({decision:'reject', radiusOutcome:'Access-Reject', portOutcome:'blocked', vlan:null, reason, simulationOnly:true});
  if (!nas || nas.enabled !== true) return reject('nas-unavailable');
  if (!binding || binding.enabled !== true || !profile || profile.enabled !== true) return reject('unassigned-or-disabled-profile');
  if (registry && !registry.enabled) return reject('mac-explicitly-disabled');
  if (registry && nas.companyId !== registry.companyId) return reject('mac-not-in-nas-registry-scope');
  const known = !!registry;
  // An explicit deny must also block an otherwise unknown MAC from the guest VLAN.
  if (rule?.enabled && rule.mode === 'reject') return {...reject('switch-mac-deny'), source:'switch-mac-override'};
  const chosen = known && rule?.enabled
    ? {mode:rule.mode, vlan:rule.vlan, source:'switch-mac-override'}
    : known
      ? {mode:profile.knownMode, vlan:profile.knownVlan, source:'profile-known'}
      : {mode:profile.unknownMode, vlan:profile.guestVlan, source:'profile-unknown'};
  if (chosen.mode === 'reject') return {...reject('policy-reject'), source:chosen.source};
  if (chosen.mode === 'guest-vlan') return {
    decision:'reject', radiusOutcome:'Access-Reject', portOutcome:'guest-vlan-if-switch-configured',
    vlan:chosen.vlan, reason:'unknown-mac-guest-policy', source:chosen.source, simulationOnly:true
  };
  if (!known) return reject('unregistered-mac');
  return {decision:'accept', radiusOutcome:'Access-Accept-if-provisioned',
    portOutcome:chosen.mode === 'accept-vlan'?'assigned-vlan':'configured-access-vlan',
    vlan:chosen.vlan, reason:'registered-mac', source:chosen.source, simulationOnly:true};
}
export function configDraft({vendor, interfaceName, radiusIp, profile}) {
  if (!profile || typeof profile !== 'object') throw error('Select a profile');
  if (typeof radiusIp !== 'string' || !/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(radiusIp))
    throw error('Valid RADIUS IPv4 required');
  const header = [
    '# REVIEW ONLY — not applied; confirm switch model, OS, AAA reachability, VLAN existence and recovery console.',
    '# Do not apply on trunk, switch uplink, management or untested voice/AP ports.',
    '# Access-Reject is NOT a RADIUS Access-Accept for guests. Switch handles guest/reject VLAN.',
    '# RADIUS unavailable is a DIFFERENT condition; this draft keeps fail-closed defaults.'
  ];
  if (vendor === 'mikrotik') {
    if (!/^ether[1-9][0-9]{0,2}$/.test(interfaceName)) throw error('Invalid RouterOS physical interface');
    return [...header,
      '# Requires RouterOS 7.2+ and bridge vlan-filtering=yes. Validate bridge and interface VLAN membership.',
      '/radius add address=' + radiusIp + ' service=dot1x secret="REPLACE_SHARED_SECRET"',
      '/interface dot1x server add interface=' + interfaceName + ' auth-types=dot1x,mac-auth' +
        (profile.unknownMode === 'guest-vlan' ? ' reject-vlan-id=' + vlan(profile.guestVlan) : ''),
      '# reject-vlan-id requires a RADIUS Access-Reject; it does NOT apply to server timeout.',
      '/interface dot1x server active print detail',
      '/interface dot1x server state print detail'].join('\n');
  }
  if (vendor === 'cisco-legacy' || vendor === 'cisco-ios') {
    if (!/^(?:Gi|Fa|Te|GigabitEthernet|FastEthernet|TenGigabitEthernet)[0-9/]{1,24}$/.test(interfaceName))
      throw error('Invalid Cisco access interface');
    const radius = vendor === 'cisco-legacy'
      ? ['radius-server host ' + radiusIp + ' auth-port 1812 acct-port 1813 key REPLACE_SHARED_SECRET']
      : ['radius server EMS-NAC', ' address ipv4 ' + radiusIp + ' auth-port 1812 acct-port 1813', ' key REPLACE_SHARED_SECRET'];
    return [...header, '# Use an isolated ACCESS port; verify syntax on this IOS/IBNS release before pasting.',
      'aaa new-model', ...radius, 'aaa authentication dot1x default group radius',
      'aaa authorization network default group radius', 'dot1x system-auth-control',
      'interface ' + interfaceName, ' switchport mode access', ' authentication port-control auto',
      ' authentication order dot1x mab', ' authentication priority dot1x mab',
      ' authentication host-mode single-host', ' mab',
      ...(profile.unknownMode === 'guest-vlan' ? [' dot1x guest-vlan ' + vlan(profile.guestVlan)] : []),
      '# On Catalyst 3750, guest/auth-fail VLAN does NOT operate with multi-auth host mode.',
      '# Configure all VLANs and RADIUS reply attributes; test reauthentication and failure paths.',
      'show authentication sessions interface ' + interfaceName + ' details',
      'show dot1x interface ' + interfaceName + ' details'].join('\n');
  }
  throw error('Model-specific CLI not supported for this vendor');
}
