import test from "node:test";
import assert from "node:assert/strict";
import { contains, intToIpv4, ipv4ToInt, parseCidr, validateChildCidr, validatePort, validateRootCidr } from "../server/ip.mjs";

test("IPv4 conversion is stable", () => {
  const value = ipv4ToInt("192.168.20.10");
  assert.equal(intToIpv4(value), "192.168.20.10");
});

test("CIDR is normalized and alignment is reported", () => {
  const parsed = parseCidr("192.168.21.0/21");
  assert.equal(parsed.cidr, "192.168.16.0/21");
  assert.equal(parsed.canonical, false);
  assert.equal(parsed.size, 2048);
});

test("parent child containment works", () => {
  assert.equal(contains("192.168.0.0/16", "192.168.20.0/24"), true);
  assert.equal(contains("192.168.0.0/16", "10.200.0.0/16"), false);
  assert.equal(validateChildCidr("192.168.20.0/24", "192.168.0.0/16").cidr, "192.168.20.0/24");
});

test("root ranges and ports are validated", () => {
  assert.equal(validateRootCidr("10.200.0.0/16").prefix, 16);
  assert.equal(validatePort(0), 0);
  assert.equal(validatePort("9191"), 9191);
  assert.throws(() => validatePort(70000));
  assert.throws(() => validateRootCidr("10.0.0.0/8"));
});
