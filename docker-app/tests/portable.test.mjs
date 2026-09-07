import test from "node:test";
import assert from "node:assert/strict";
import { buildSubnetPackage, importSubnetPackage, validateSubnetPackage } from "../server/portable.mjs";
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
