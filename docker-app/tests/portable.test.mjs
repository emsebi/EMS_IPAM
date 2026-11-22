import test from "node:test";
import assert from "node:assert/strict";
import { buildSubnetPackage, importSubnetPackage, validateSubnetPackage, previewSubnetPackage } from "../server/portable.mjs";
import { contains, parseCidr } from "../server/ip.mjs";

test("portable subnet export stays scoped and excludes every secret", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM prefixes")) return { rows: [
        { id: "p1", cidr: "10.20.30.0/25", name: "کاربران", status: "active", color: "#3157d5" },
        { id: "p2", cidr: "10.20.31.0/24", name: "خارج", status: "active", color: "#3157d5" },
      ] };
      if (sql.includes("FROM hosts")) return { rows: [
        { id: "h1", ip: "10.20.30.10", name: "Router", radioMode: "ap", connectionMethods: [{ type: "SSH" }], secretCiphertext: "never-export" },
        { id: "h2", ip: "10.20.31.10", name: "Outside", secretCiphertext: "never-export" },
      ] };
      if (sql.includes("FROM device_ports")) return { rows: [{ hostId: "h1", name: "ether1", enabled: true }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const value = await buildSubnetPackage({
    pool,
    space: { id: "s1", cidr: "10.20.0.0/16", name: "مرکزی", companyName: "نمونه" },
    cidr: "10.20.30.0/24",
    appVersion: "0.5.1",
    parseCidr,
    contains,
  });
  assert.equal(value.format, "EMS-IPAM-SUBNET");
  assert.equal(value.passwordPolicy, "excluded");
  assert.deepEqual(value.prefixes.map((item) => item.cidr), ["10.20.30.0/25"]);
  assert.deepEqual(value.hosts.map((item) => item.ip), ["10.20.30.10"]);
  assert.equal(value.hosts[0].devicePorts[0].name, "ether1");
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /never-export|"secret(?:Ref|Ciphertext)?"|"password"|"monitorUsername"/i);
});

test("portable subnet import uses a transaction and valid SQL parameter counts", async () => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push(sql);
      const placeholders = [...String(sql).matchAll(/\$(\d+)/g)].map((item) => Number(item[1]));
      if (placeholders.length) assert.ok(Math.max(...placeholders) <= params.length, `missing SQL parameter in ${sql}`);
      if (sql.startsWith("SELECT id FROM prefixes") || sql.startsWith("SELECT id FROM hosts")) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const packageData = {
    format: "EMS-IPAM-SUBNET",
    formatVersion: 1,
    source: { cidr: "10.20.30.0/24" },
    prefixes: [{ cidr: "10.20.30.0/25", name: "کاربران", color: "#3157d5" }],
    hosts: [{ id: "source-ap", ip: "10.20.30.10", name: "AP", radioMode: "ap", devicePorts: [{ name: "ether1" }] }],
  };
  const result = await importSubnetPackage({
    pool,
    user: { id: "u1" },
    destinationSpace: { id: "s1", cidr: "10.20.0.0/16" },
    packageData,
    mode: "replace",
    parseCidr,
    contains,
  });
  assert.equal(result.prefixesCreated, 1);
  assert.equal(result.hostsCreated, 1);
  assert.equal(result.devicePorts, 1);
  assert.equal(queries[0], "BEGIN");
  assert.equal(queries.at(-1), "COMMIT");
});

test("portable package rejects addresses outside its declared scope", () => {
  assert.throws(() => validateSubnetPackage({
    format: "EMS-IPAM-SUBNET",
    formatVersion: 1,
    source: { cidr: "10.20.30.0/24" },
    prefixes: [],
    hosts: [{ id: "bad", ip: "10.20.31.1" }],
  }, { parseCidr, contains, destinationSpace: { cidr: "10.20.0.0/16" } }), /آدرس نامعتبر/);
});

test("portable packages accept legacy host IDs and reject ambiguous link identities", () => {
  const validate = hosts => validateSubnetPackage({
    format: "EMS-IPAM-SUBNET", formatVersion: 1, source: { cidr: "192.0.2.0/24" }, hosts,
  }, { parseCidr, contains, destinationSpace: { cidr: "192.0.2.0/24" } });
  const ap = { id: "ap", radioMode: "ap", ip: "192.0.2.4" };
  const station = { id: "st", radioMode: "station", radioParentHostId: "ap", ip: "192.0.2.5" };
  const legacy = validate([ap, station]).hosts;
  assert.deepEqual([legacy[0].sourceId, legacy[1].sourceId, legacy[1].sourceRadioParentHostId], ["ap", "st", "ap"]);
  assert.throws(() => validate([ap, { ...station, sourceId: "ap" }]), /تکراری/);
  assert.throws(() => validate([ap, { ...station, ip: ap.ip }]), /تکراری/);
});


test("portable preview uses a read-only snapshot and counts archived conflicts without exposing fields", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queries.push(sql);
      if (sql.startsWith("BEGIN") || sql === "COMMIT") return { rows: [] };
      assert.match(sql, /^SELECT (cidr|ip),deleted_at FROM (prefixes|hosts) WHERE space_id=\$1 AND/);
      assert.equal(params[0], "target");
      if (sql.includes("FROM prefixes")) return { rows: [{ cidr: "192.0.2.0/25", deleted_at: null }] };
      return { rows: [{ ip: "192.0.2.10", deleted_at: "2026-01-01", secret: "must-not-appear" }] };
    },
    release() { released = true; },
  };
  const preview = await previewSubnetPackage({ pool: { connect: async () => client },
    destinationSpace: { id: "target", cidr: "192.0.2.0/24" }, parseCidr, contains,
    packageData: { format: "EMS-IPAM-SUBNET", formatVersion: 1, source: { cidr: "192.0.2.0/24" },
      prefixes: [{ cidr: "192.0.2.0/25" }, { cidr: "192.0.2.128/25" }],
      hosts: [{ ip: "192.0.2.11", password: "must-not-appear" }, { ip: "192.0.2.10" }] } });
  assert.deepEqual(preview.summary, {
    prefixes: { total: 2, newRecords: 1, existing: 1, archived: 0 },
    hosts: { total: 2, newRecords: 1, existing: 1, archived: 1 },
  });
  assert.deepEqual(preview.sample.hosts[0], { ip: "192.0.2.10", name: "", existing: true, archived: true });
  assert.doesNotMatch(JSON.stringify(preview), /password|secret|must-not-appear/);
  assert.equal(queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(released, true);
});

test("portable validation rejects truncated, malformed and duplicate canonical records before querying", async () => {
  const pkg = { format: "EMS-IPAM-SUBNET", formatVersion: 1, source: { cidr: "192.0.2.0/24" }, prefixes: [], hosts: [] };
  const args = { pool: { connect() { throw new Error("validation must precede SQL"); } },
    destinationSpace: { id: "target", cidr: "192.0.2.0/24" }, parseCidr, contains };
  for (const change of [
    { hosts: new Array(200001).fill({}) }, { prefixes: new Array(20001).fill({}) },
    { hosts: [null] }, { prefixes: {} }, { hosts: "invalid" },
    { prefixes: [{ cidr: "192.0.2.1/25" }] },
    { prefixes: [{ cidr: "192.0.2.0/25" }, { cidr: "192.000.002.000/25" }] },
    { hosts: [{ ip: "192.0.2.10" }, { ip: "192.000.002.010" }] },
  ]) {
    await assert.rejects(previewSubnetPackage({ ...args, packageData: { ...pkg, ...change } }), /نامعتبر|تکراری/);
  }
});
