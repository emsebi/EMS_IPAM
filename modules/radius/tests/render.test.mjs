import test from "node:test";
import assert from "node:assert/strict";
process.env.EMS_SECRET_KEY = "11".repeat(32);
const { encryptSecret } = await import("../server/crypto.mjs");
const { normalizeMac, macVariants, buildClientsConfig, buildAuthorizeConfig } = await import("../server/render.mjs");

test("normalizes common MAC formats", () => {
  assert.equal(normalizeMac("AA:BB:CC:DD:EE:FF"), "aabbccddeeff");
  assert.equal(normalizeMac("aabb.ccdd.eeff"), "aabbccddeeff");
  assert.equal(normalizeMac("bad"), "");
  assert.ok(macVariants("AA-BB-CC-DD-EE-FF").includes("aabb.ccdd.eeff"));
});

test("renders CIDR clients and equipment permissions", () => {
  const clients = buildClientsConfig([{ id:"n1", cidr:"192.168.0.0/16", enabled:true, secret_ciphertext:encryptSecret("radius-secret") }]);
  assert.match(clients, /192\.168\.0\.0\/16/);
  assert.match(clients, /secret = "radius-secret"/);
  const auth = buildAuthorizeConfig({
    users:[{ username:"netadmin", enabled:true, password_ciphertext:encryptSecret("Test-Radius-Password-123!"), mikrotik_access:"full", cisco_privilege:15, nexus_role:"network-admin" }],
    macs:[{ mac:"AA:BB:CC:DD:EE:FF", enabled:true, access_mode:"allow_vlan", vlan:120 }, { mac:"11:22:33:44:55:66", enabled:false, access_mode:"allow", vlan:null }],
    settings:{ unknown_mac_policy:"quarantine", quarantine_vlan:999 },
  });
  assert.match(auth,/netadmin Cleartext-Password/);
  assert.match(auth,/shell:priv-lvl=15/);
  assert.match(auth,/Mikrotik-Group/);
  assert.match(auth,/Tunnel-Private-Group-Id := "120"/);
  assert.match(auth,/Tunnel-Private-Group-Id := "999"/);
  assert.match(auth,/112233445566 Auth-Type := Reject/);
});
