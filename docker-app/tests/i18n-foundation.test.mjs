import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTranslator } from "../public/i18n-core.mjs";
const read = async (name) => JSON.parse(await fs.readFile(new URL(`../public/i18n/${name}.json`, import.meta.url), "utf8"));

test("English catalog provides stable canonical keys and Persian covers them", async () => {
  const [en, fa, legacy] = await Promise.all(["en", "fa", "legacy-fa"].map(read));
  assert.ok(Object.keys(en).length >= 200);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fa).sort());
  for (const [key, value] of Object.entries(en)) assert.equal(key, value);
  for (const key of Object.values(legacy)) assert.ok(key in en, `Missing canonical key: ${key}`);
});

test("English and Persian translate both legacy and canonical UI strings", async () => {
  const [english, translations, legacy] = await Promise.all(["en", "fa", "legacy-fa"].map(read));
  const en = createTranslator({ english, translations, legacy, language: "en" });
  const fa = createTranslator({ english, translations, legacy, language: "fa" });
  assert.equal(en("رادیوها و ارتباط AP / Station"), "Radio AP / Station Map");
  assert.equal(fa("Radio AP / Station Map"), "رادیوها و ارتباط AP / Station");
  assert.equal(en("پرسنل"), "Personnel");
  assert.equal(fa("Personnel"), "پرسنل");
  assert.equal(en("داشبورد و شرکت‌ها"), "Dashboard & Companies");
  assert.equal(fa("Dashboard & Companies"), "داشبورد و شرکت‌ها");
  assert.equal(fa("Export CSV"), "خروجی CSV");
  assert.equal(en("کد: 100"), "Code: 100");
  assert.equal(fa("کد: 100"), "کد: 100");
  assert.equal(en("شرکت Company"), "Company Company");
  assert.equal(fa("شرکت Company"), "شرکت شرکت");
});

test("missing translations fall back to English, not Persian or empty text", () => {
  const en = { "English only": "English only" };
  const translator = createTranslator({ english: en, translations: {}, legacy: { "فقط فارسی": "English only" }, language: "fa" });
  assert.equal(translator("فقط فارسی"), "English only");
  assert.equal(translator("English only"), "English only");
  assert.equal(translator("Unknown"), "Unknown");
  assert.equal(createTranslator()("Unknown"), "Unknown");
});
