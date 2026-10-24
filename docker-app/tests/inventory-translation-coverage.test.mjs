import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async (language) => JSON.parse(await readFile(new URL(`../public/i18n/${language}.json`, import.meta.url), 'utf8'));

test('Inventory creation errors have complete English and Persian translations', async () => {
  const en = await load('en');
  const fa = await load('fa');
  for (const key of ['inventory.error.noSpaces', 'inventory.error.ipAlreadyRegistered', 'inventory.error.ipOutsideNetwork']) {
    assert.ok(en[key]?.trim(), `English missing: ${key}`);
    assert.ok(fa[key]?.trim(), `Persian missing: ${key}`);
    assert.notEqual(en[key], fa[key], `Untranslated: ${key}`);
  }
});
