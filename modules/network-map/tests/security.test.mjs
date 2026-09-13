import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { sanitizeConfiguration } from "../server/sanitize.mjs";

test("stored configuration redacts common Cisco secrets", () => {
  const safe = sanitizeConfiguration(`hostname SW1
enable secret 9 abcdef
username admin privilege 15 secret 9 value
snmp-server community private RO
interface Gi1/0/1`);
  assert.equal(safe.redactionCount, 3);
  assert.doesNotMatch(safe.text, /abcdef|\bvalue\b|\bprivate\b/);
  assert.match(safe.text, /\[REDACTED\]/);
});

test("stored configuration aggressively removes vendor-specific credentials and private keys", () => {
  const safe = sanitizeConfiguration(`username ops role network-admin password 5 abc
snmp-server user monitor admins v3 auth sha authpass priv aes 128 privpass
snmp-server host 10.0.0.5 version 2c private
ip ospf message-digest-key 1 md5 ospfpass
-----BEGIN RSA PRIVATE KEY-----
very-secret-material
-----END RSA PRIVATE KEY-----
interface Gi1/0/1`);
  assert.doesNotMatch(safe.text, /abc|authpass|privpass|private|ospfpass|very-secret-material/);
  assert.match(safe.text, /interface Gi1\/0\/1/);
  assert.ok(safe.redactionCount >= 5);
});

test("module schema never defines credential columns", async () => {
  const schema = await fs.readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  assert.doesNotMatch(schema, /password|enable_password|credential|secret_ciphertext/i);
});

test("runtime jobs have heartbeat cancellation and no scheduler", async () => {
  const server = await fs.readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  assert.match(server, /lastHeartbeat/);
  assert.match(server, /45_000/);
  assert.match(server, /scrubConnection/);
  assert.doesNotMatch(server, /cron|scheduledScan|automaticMonitor/i);
});
