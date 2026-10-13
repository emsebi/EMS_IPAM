import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('radio UI has no hard-coded AP and station labels', () => {
  const source = readFileSync(new URL('../../modules/radio/public/index.mjs', import.meta.url), 'utf8');
  for (const key of ['radio.action.ping', 'radio.label.accessPoint', 'radio.label.station']) {
    assert.ok(source.includes(key));
  }
  assert.ok(!source.includes('aria-label="Access Points"'));
});
