import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("equipment credentials have no persistence or encryption helper", async () => {
  const [server, schema] = await Promise.all([
    fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
  ]);
  await assert.rejects(fs.access(new URL("../server/secrets.mjs", import.meta.url)));
  assert.doesNotMatch(server, /createSecretBox|EMS_SECRET_KEY|decrypt\(/);
  assert.match(server, /const secretCiphertext = ""/);
  assert.match(server, /const monitorSecretCiphertext = ""/);
  assert.match(schema, /secret_ciphertext='',/);
  assert.match(schema, /monitor_secret_ciphertext='',/);
  assert.match(schema, /DELETE FROM app_settings WHERE key='monitoring'/);
});
