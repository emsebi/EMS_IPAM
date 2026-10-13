import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKeyTranslator } from '../public/i18n-core.mjs';

test('IPAM Device Types English catalog has usable fallback', () => {
  const en = JSON.parse(readFileSync(new URL('../../modules/ipam/public/i18n/en.json', import.meta.url), 'utf8'));
  const t = createKeyTranslator({ english: en, translations: {}, language: 'fa' });
  for (const key of ['ipam.deviceTypes.title', 'ipam.deviceTypes.name', 'ipam.deviceTypes.save']) {
    assert.equal(t(key), en[key]);
    assert.ok(t(key) !== key);
  }
});
