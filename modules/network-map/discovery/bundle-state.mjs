// Case-sensitive IOS / NX-OS summary flags. An unknown flag is not forwarding proof.
const memberStates = {
  P: 'bundled', p: 'delay-lacp', D: 'down', s: 'suspended', H: 'standby',
  I: 'individual', r: 'removed', b: 'waiting', w: 'waiting', u: 'unsuitable',
  M: 'min-links', m: 'min-links', f: 'failed', d: 'default',
};
export const ciscoMemberState = flags => Object.hasOwn(memberStates, flags) ? memberStates[flags] : 'unknown';

export const ciscoBundleState = flags => /[DMN]/.test(flags || '') ? 'down'
  : /U/.test(flags || '') ? 'up' : 'unknown';

export const inactiveMember = state => ['down', 'inactive', 'suspended', 'standby', 'removed',
  'waiting', 'unsuitable', 'min-links', 'failed'].includes(state);
