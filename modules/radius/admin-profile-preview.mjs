/**
 * Offline vendor RADIUS reply preview for network-device administrators.
 * Not a live AAA service. Nothing is sent to switches or routers.
 */
const reject = (reason) => ({ decision: 'reject', reason, replyAttributes: {} });

/**
 * Preview RADIUS attributes for a separately managed device-admin profile.
 * This function does not authenticate a user or decide whether the user owns
 * the profile; those checks belong to the future authenticated backend.
 */
export function previewDeviceAdminProfile({ vendor, profile } = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || profile.enabled !== true) return reject('profile-disabled');
  if (vendor === 'cisco') {
    const privilege = profile.ciscoPrivilege;
    if (!Number.isInteger(privilege) || privilege < 0 || privilege > 15) return reject('invalid-cisco-privilege');
    return {
      decision: 'preview', reason: 'cisco-privilege',
      replyAttributes: { 'Cisco-AVPair': `shell:priv-lvl=${privilege}` },
      effectivePrivilege: privilege,
    };
  }
  if (vendor === 'mikrotik') {
    const group = profile.mikrotikGroup;
    if (typeof group !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(group)) return reject('invalid-mikrotik-group');
    return {
      decision: 'preview', reason: 'mikrotik-group',
      replyAttributes: { 'Mikrotik-Group': group },
      effectiveGroup: group,
    };
  }
  return reject('unsupported-vendor');
}
