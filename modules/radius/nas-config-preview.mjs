/**
 * Human-reviewed FreeRADIUS clients.conf DRAFT only. Every emitted line is
 * commented out, so it cannot accidentally authorize a NAS if pasted as-is.
 * No shared secret values, device commands, network I/O, or file writes.
 */
import { prepareNasProfile } from './nas-inventory.mjs';

const invalid = (issues) => ({ status: 'invalid', text: '', issues });

export function previewNasClientConfig(input, { devices } = {}) {
  const result = prepareNasProfile(input, { devices });
  if (!result.ok) return invalid(result.issues);
  const profile = result.value;
  const label = `ems_${Buffer.from(profile.id, 'utf8').toString('hex')}`;
  const lines = [
    '# EMS-IPAM — REVIEW-ONLY FreeRADIUS clients.conf DRAFT',
    '# All lines are comments. Nothing is installed or enabled.',
    '# Validate NAS source IP, firmware, UDP reachability and vendor support.',
    '# Replace placeholder with a unique strong secret stored outside EMS-IPAM.',
    '# Check Message-Authenticator support before deployment (BlastRADIUS mitigation).',
    `# Profile enabled in inventory: ${profile.enabled ? 'yes' : 'no'}`,
    `# client ${label} {`,
    `#   ipaddr = ${profile.nasIp}`,
    '#   secret = REPLACE_WITH_UNIQUE_SECRET_FROM_SECURE_STORE',
    '#   require_message_authenticator = yes',
    '# }',
    '# No RADIUS policies, VLAN decisions, AAA permissions or NAS device changes are applied.',
  ];
  return { status: 'draft-only', text: `${lines.join('\n')}\n`, issues: [] };
}
