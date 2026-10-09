import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("live server never stores or encrypts equipment credentials", async () => {
  const [server, schema] = await Promise.all([
    fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
  ]);
  // A legacy secrets.mjs utility may still exist in the repository; the
  // security boundary is that the running server never imports or uses it.
  assert.doesNotMatch(server, /from\s*["']\.\/secrets\.mjs["']/);
  assert.doesNotMatch(server, /createSecretBox|EMS_SECRET_KEY|decrypt\(/);
  assert.match(server, /const secretCiphertext = ""/);
  assert.match(server, /const monitorSecretCiphertext = ""/);
  assert.match(schema, /secret_ciphertext='',/);
  assert.match(schema, /monitor_secret_ciphertext='',/);
  assert.match(schema, /DELETE FROM app_settings WHERE key='monitoring'/);
});
