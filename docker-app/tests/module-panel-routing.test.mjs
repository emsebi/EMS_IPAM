import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("panel modules route through the generic module loader", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /async function openGenericModulePage\(id, routeParts = \[\]/);
  assert.match(app, /parts\[0\] === "module" && parts\[1\]/);
  assert.match(app, /item\.navigation\?\.panel === true/);
  assert.match(app, /data-module-id=/);
  assert.match(app, /typeof ui\.openPage !== "function"/);
});

test("modules can own translations with English fallback to core", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /async function createModuleTranslator\(info\)/);
  assert.match(app, /\/m\/\$\{encodeURIComponent\(id\)\}\/i18n\/en\.json/);
  assert.match(app, /createKeyTranslator\(\{ english, translations: localized, language: state\.language \}\)/);
  assert.match(app, /Object\.prototype\.hasOwnProperty\.call\(english, key\)/);
  assert.match(app, /coreT:t,module:info/);
});

test("module SDK documents panel contract instead of requiring per-module core routes", async () => {
  const sdk = await read("../../docs/MODULE-SDK-FA.md");
  assert.match(sdk, /"panel": true/);
  assert.match(sdk, /openPage\(\{ routeParts, fromRoute \}\)/);
  assert.match(sdk, /public\/i18n\/en\.json/);
});
