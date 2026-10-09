import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTranslator } from "../public/i18n-core.mjs";
const read = async (name) => JSON.parse(await fs.readFile(new URL(`../public/i18n/${name}.json`, import.meta.url), "utf8"));

test("English catalog provides stable canonical keys and Persian covers them", async () => {
  const [en, fa, legacy] = await Promise.all(["en", "fa", "legacy-fa"].map(read));
  assert.ok(Object.keys(en).length >= 200);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fa).sort());
  for (const [key, value] of Object.entries(en)) assert.ok(typeof value === "string" && value.trim(), `Empty English value: ${key}`);
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
  assert.equal(en("radio.title"), "Radio AP / Station Map");
  assert.equal(fa("radio.title"), "رادیوها و ارتباط AP / Station");
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


test("additional language packs work without translator code changes", () => {
  const english = { "common.cancel": "Cancel", "radio.title": "Radios" };
  const german = { "common.cancel": "Abbrechen", "radio.title": "Funkgeräte" };
  const de = createTranslator({ english, translations: german, language: "de" });
  assert.equal(de("common.cancel"), "Abbrechen");
  assert.equal(de("radio.title"), "Funkgeräte");
});

test("radio module has no hard-coded Persian UI strings and uses stable keys", async () => {
  const source = await fs.readFile(new URL("../../modules/radio/public/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /[\u0600-\u06FF]/);
  assert.match(source, /t\("radio\.title"\)/);
  assert.match(source, /t\("radio\.action\.addStation"\)/);
  assert.match(source, /t\("radio\.error\.moduleUnavailable"\)/);
});


test("personnel semantic keys preserve English base and Persian translations", async () => {
  const [english, translations, legacy] = await Promise.all(["en", "fa", "legacy-fa"].map(read));
  const en = createTranslator({ english, translations, legacy, language: "en" });
  const fa = createTranslator({ english, translations, legacy, language: "fa" });
  assert.equal(en("personnel.field.employeeCodeOptional"), "Employee Code (optional)");
  assert.equal(en("personnel.field.fullNameRequired"), "Full Name (required)");
  assert.equal(fa("personnel.field.employeeCodeOptional"), "کد پرسنلی (اختیاری)");
  assert.equal(fa("personnel.field.fullNameRequired"), "نام و نام خانوادگی (الزامی)");
});

test("personnel dialog is authored in English and bound to stable i18n keys", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('<dialog id="personnelDialog"');
  const end = html.indexOf("</dialog>", start);
  const block = html.slice(start, end);
  assert.match(block, /data-i18n="personnel\.field\.employeeCodeOptional"/);
  assert.match(block, /data-i18n="personnel\.field\.fullNameRequired"/);
  assert.match(block, />Employee Code \(optional\)</);
  assert.match(block, />Full Name \(required\)</);
  assert.doesNotMatch(block, /[\u0600-\u06FF]/);
});
