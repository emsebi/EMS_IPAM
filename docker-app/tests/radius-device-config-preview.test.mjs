import test from "node:test";
import assert from "node:assert/strict";
import { previewDeviceRadiusConfig } from "../../modules/radius/device-config-preview.mjs";

test("Cisco device-admin preview contains placeholders but no supplied secret", () => {
  const result = previewDeviceRadiusConfig({ vendor: "cisco", purpose: "device-admin", radiusServerIp: "192.0.2.5" });
  assert.equal(result.status, "manual-review");
  assert.match(result.text, /aaa new-model/);
  assert.match(result.text, /Cisco IOS\/IOS-XE/);
  assert.match(result.text, /<RADIUS_SHARED_SECRET>/);
  assert.match(result.text, /local emergency account/);
});

test("Cisco MAB preview requires a validated interface", () => {
  assert.equal(previewDeviceRadiusConfig({ vendor: "cisco", purpose: "mab", radiusServerIp: "192.0.2.5" }).status, "invalid");
  const result = previewDeviceRadiusConfig({ vendor: "cisco", purpose: "mab", radiusServerIp: "192.0.2.5", interfaceName: "GigabitEthernet1/0/12" });
  assert.equal(result.reason, "cisco-mab");
  assert.match(result.text, /interface GigabitEthernet1\/0\/12/);
  assert.match(result.text, /mab/);
  assert.match(result.text, /verify before applying/);
});

test("MikroTik device-admin preview is manual and MAB stays model/version gated", () => {
  const admin = previewDeviceRadiusConfig({ vendor: "mikrotik", purpose: "device-admin", radiusServerIp: "192.0.2.5" });
  assert.equal(admin.status, "manual-review");
  assert.match(admin.text, /\/radius add service=login/);
  assert.match(admin.text, /\/user aaa set use-radius=yes/);
  const mab = previewDeviceRadiusConfig({ vendor: "mikrotik", purpose: "mab", radiusServerIp: "192.0.2.5", interfaceName: "ether2" });
  assert.deepEqual(mab, { status: "unsupported-preview", reason: "model-version-required", text: "" });
});

test("invalid server IPs and command injection tokens fail closed", () => {
  for (const ip of ["127.0.0.1", "server.example", "192.0.2.5\nreload"]) {
    assert.equal(previewDeviceRadiusConfig({ vendor: "cisco", purpose: "device-admin", radiusServerIp: ip }).status, "invalid");
  }
  assert.equal(previewDeviceRadiusConfig({ vendor: "cisco", purpose: "mab", radiusServerIp: "192.0.2.5", interfaceName: "Gi1/0/1\nshutdown" }).status, "invalid");
  assert.equal(previewDeviceRadiusConfig({ vendor: "cisco", purpose: "device-admin", radiusServerIp: "192.0.2.5", serverName: "BAD NAME" }).status, "invalid");
});
