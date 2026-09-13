import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildMikrotikScript } from "../server/mikrotik.mjs";

test("generated MikroTik setup defaults to simple read-only API without a certificate", () => {
  const script = buildMikrotikScript({
    username: "ems-ipam",
    password: "1",
  });
  assert.match(script, /policy=read,api/);
  assert.match(script, /api disabled=no port=8728/);
  assert.match(script, /password="1"/);
  assert.doesNotMatch(script, /certificate=|firewall|policy=.*write|sensitive/);

  const legacy = buildMikrotikScript({
    username: "ems-ipam",
    password: "a-strong-password",
    certificateName: "ems-api-cert",
    transport: "mikrotik-api-ssl",
    port: 8729,
  });
  assert.match(legacy, /policy=read,api/);
  assert.match(legacy, /api-ssl disabled=no port=8729/);
  assert.doesNotMatch(legacy, /rest-api/);

  const legacyDefaultPort = buildMikrotikScript({
    username: "ems-ipam",
    password: "a-strong-password",
    certificateName: "ems-api-cert",
    transport: "mikrotik-api-ssl",
  });
  assert.match(legacyDefaultPort, /api-ssl disabled=no port=8729/);

  const rest = buildMikrotikScript({ username: "ems-ipam", password: "", certificateName: "ems-rest-cert", transport: "mikrotik-rest" });
  assert.match(rest, /policy=read,rest-api/);
  assert.match(rest, /www-ssl disabled=no port=443 certificate=ems-rest-cert/);
});

test("MikroTik helper has no device connection or polling implementation", async () => {
  const source = await fs.readFile(new URL("../server/mikrotik.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:https|node:net|node:tls|pollMikrotik|saveMikrotikPoll|Authorization:/);
  assert.match(source, /never opens a connection to equipment/);
});
