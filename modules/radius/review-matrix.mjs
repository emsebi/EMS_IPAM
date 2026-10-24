/**
 * Offline MAB policy regression matrix for operator review.
 * No network I/O or authentication. Sensitive identifiers are never returned.
 */
import { previewMabDecision, validVlan } from './policy-preview.mjs';

const fail = (reason) => ({ status: 'invalid-input', reason, total: 0, mismatches: 0, items: [] });
const safeLabel = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Each case supplies a simulated request, policy, inventory, and optional expected result.
 * Only safe labels, decision/reason and validated VLAN are included in the report.
 */
export function reviewMabPolicyMatrix({ cases = [] } = {}) {
  if (!Array.isArray(cases) || cases.length > 128) return fail('invalid-cases');
  const seen = new Set();
  for (const item of cases) {
    if (!plain(item) || !safeLabel(item.label) || seen.has(item.label) || !plain(item.input) ||
        (item.expectedDecision !== undefined && !['accept', 'reject'].includes(item.expectedDecision)) ||
        (item.expectedReason !== undefined && !safeLabel(item.expectedReason))) return fail('invalid-case');
    seen.add(item.label);
  }
  const items = [];
  let mismatches = 0;
  for (const item of cases) {
    const result = previewMabDecision(item.input);
    const expected = item.expectedDecision !== undefined || item.expectedReason !== undefined;
    const matches = (!item.expectedDecision || item.expectedDecision === result.decision) &&
      (!item.expectedReason || item.expectedReason === result.reason);
    if (expected && !matches) mismatches++;
    const vlan = validVlan(result.replyAttributes?.['Tunnel-Private-Group-Id']);
    items.push({ label: item.label, decision: result.decision, reason: result.reason,
      vlan, expectation: expected ? (matches ? 'pass' : 'mismatch') : 'not-set' });
  }
  return { status: 'preview-only', total: items.length, mismatches, items };
}
