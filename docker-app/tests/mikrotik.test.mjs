import test from "node:test";
import assert from "node:assert/strict";
import { buildMikrotikScript, encodeApiSentence, saveMikrotikPoll } from "../server/mikrotik.mjs";

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
