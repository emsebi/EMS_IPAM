import test from "node:test";
import assert from "node:assert/strict";
import { buildMikrotikScript, encodeApiSentence, saveMikrotikPoll } from "../server/mikrotik.mjs";

test("generated MikroTik setup is TLS-only, read-only and source restricted", () => {
  const script = buildMikrotikScript({
    serverIp: "10.10.10.5",
    username: "ems-ipam",
    password: "a-strong-password",
    certificateName: "ems-rest-cert",
    port: 443,
  });
  assert.match(script, /policy=read,rest-api/);
  assert.match(script, /www-ssl disabled=no/);
  assert.match(script, /tls-version=only-1\.2/);
  assert.match(script, /address=10\.10\.10\.5\/32/);
  assert.match(script, /src-address=10\.10\.10\.5/);
  assert.doesNotMatch(script, /8728|policy=.*write|sensitive/);

  const legacy = buildMikrotikScript({
    serverIp: "10.10.10.5",
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
    serverIp: "10.10.10.5",
    username: "ems-ipam",
    password: "a-strong-password",
    certificateName: "ems-api-cert",
    transport: "mikrotik-api-ssl",
  });
  assert.match(legacyDefaultPort, /api-ssl disabled=no port=8729/);
});

test("RouterOS API sentence encoder terminates words and supports long values", () => {
  const short = encodeApiSentence(["/login", "=name=admin"]);
  assert.equal(short[0], 6);
  assert.equal(short.at(-1), 0);
  const long = encodeApiSentence(["x".repeat(200)]);
  assert.equal(long[0] & 0xc0, 0x80);
  assert.equal(long.length, 203);
});

test("MikroTik polling marks a station from its MAC without inventing credentials", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id,mac FROM hosts")) return { rows: [{ id: "station-1", mac: "AA:BB:CC:DD:EE:FF" }] };
      return { rows: [] };
    },
  };
  await saveMikrotikPoll({
    pool,
    host: { id: "ap-1" },
    result: { online: true, checkedAt: "2026-09-03T00:00:00.000Z", version: "7.20", stations: [{ mac: "AA:BB:CC:DD:EE:FF", signal: "-55 dBm", ssid: "Branch" }] },
  });
  assert.equal(calls.length, 3);
  assert.match(calls[2].sql, /monitor_state/);
  assert.equal(calls[2].params[1], true);
  assert.equal(calls[2].params[2], "-55 dBm");
});
