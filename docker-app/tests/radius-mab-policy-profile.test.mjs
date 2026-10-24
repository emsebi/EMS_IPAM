import test from "node:test";
import assert from "node:assert/strict";
import { prepareMabPolicy, storedPolicyToPreview } from "../../modules/radius/mab-policy-profile.mjs";

const base = { id: "policy-1", nasProfileId: "nas-1", enabled: true,
  knownMode: "accept-dynamic", knownVlan: 20, unknownMode: "guest-vlan", guestVlan: 30 };

test("stored MAB policy validates the four requested policy modes", () => {
  assert.equal(prepareMabPolicy(base).ok, true);
  assert.equal(prepareMabPolicy({ ...base, knownMode: "accept-static", knownVlan: null, unknownMode: "reject", guestVlan: null }).ok, true);
  assert.equal(prepareMabPolicy({ ...base, knownMode: "reject", knownVlan: null }).ok, true);
});

test("dynamic and guest VLAN modes require valid VLANs", () => {
  for (const knownVlan of [null, 0, 4095, "020"]) assert.equal(prepareMabPolicy({ ...base, knownVlan }).ok, false);
  for (const guestVlan of [null, 0, 4095, "020"]) assert.equal(prepareMabPolicy({ ...base, guestVlan }).ok, false);
});

test("static/reject modes reject stray VLAN values and implicit enabled state", () => {
  assert.equal(prepareMabPolicy({ ...base, knownMode: "accept-static", knownVlan: 20 }).ok, false);
  assert.equal(prepareMabPolicy({ ...base, unknownMode: "reject", guestVlan: 30 }).ok, false);
  assert.equal(prepareMabPolicy({ ...base, enabled: "true" }).ok, false);
});

test("stored policy maps deterministically into preview engine policy", () => {
  assert.deepEqual(storedPolicyToPreview(base), {
    enabled: true,
    known: { mode: "accept-dynamic", vlan: 20 },
    unknown: { mode: "guest-vlan", vlan: 30 },
  });
  assert.equal(storedPolicyToPreview({ ...base, id: "bad!" }), null);
});

test("injected fields and mismatched forced IDs fail closed", () => {
  assert.equal(prepareMabPolicy({ ...base, secret: "x" }).ok, false);
  assert.equal(prepareMabPolicy(base, { forcedId: "different" }).ok, false);
});
