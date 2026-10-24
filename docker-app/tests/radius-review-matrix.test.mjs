import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMabPolicyMatrix } from '../../modules/radius/review-matrix.mjs';

const inventory = [{ mac: '02:00:00:00:00:50', enabled: true, vlan: 20 }];
const policy = { enabled: true, known: { mode: 'accept-dynamic' }, unknown: { mode: 'reject' } };
const input = (mac) => ({ mac, knownMacs: inventory, policy, switchId: 'sw-1' });

test('offline matrix evaluates expectations without returning MAC, switch or inventory', () => {
  const report = reviewMabPolicyMatrix({ cases: [
    { label: 'known-device', input: input(inventory[0].mac), expectedDecision: 'accept', expectedReason: 'known-dynamic-vlan' },
    { label: 'unknown-device', input: input('02:00:00:00:00:51'), expectedDecision: 'reject', expectedReason: 'unknown-mac' },
  ] });
  assert.equal(report.status, 'preview-only');
  assert.equal(report.total, 2);
  assert.equal(report.mismatches, 0);
  assert.equal(report.items[0].vlan, 20);
  const text = JSON.stringify(report);
  assert.equal(text.includes(inventory[0].mac), false);
  assert.equal(text.includes('sw-1'), false);
  assert.equal(text.includes('knownMacs'), false);
});

test('policy regressions are counted without granting access', () => {
  const report = reviewMabPolicyMatrix({ cases: [
    { label: 'guest-misconfigured', input: input('02:00:00:00:00:51'), expectedDecision: 'accept' },
    { label: 'missing-policy', input: { mac: inventory[0].mac, knownMacs: inventory, policy: {} }, expectedDecision: 'reject' },
  ] });
  assert.equal(report.mismatches, 1);
  assert.equal(report.items[0].expectation, 'mismatch');
  assert.equal(report.items[1].expectation, 'pass');
});

test('malformed and duplicate cases fail atomically', () => {
  for (const cases of [{}, Array(129).fill({}), [{ label: 'bad label', input: {} }],
    [{ label: 'x', input: {} }, { label: 'x', input: {} }],
    [{ label: 'x', input: {}, expectedDecision: 'grant' }],
    [{ label: 'x', input: {}, expectedReason: 'evil\nvalue' }]]) {
    assert.equal(reviewMabPolicyMatrix({ cases }).status, 'invalid-input');
  }
});

test('no mutation of frozen input', () => {
  const frozen = Object.freeze({ label: 'frozen', input: Object.freeze(input(inventory[0].mac)), expectedDecision: 'accept' });
  assert.equal(reviewMabPolicyMatrix({ cases: Object.freeze([frozen]) }).mismatches, 0);
});

test('empty matrix is safe and explicit', () => {
  assert.deepEqual(reviewMabPolicyMatrix(), { status: 'preview-only', total: 0, mismatches: 0, items: [] });
});
