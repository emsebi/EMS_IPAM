import test from "node:test";
import assert from "node:assert/strict";
import { checkMabNasBinding } from "../../modules/radius/mab-policy-guard.mjs";
const policy = { id: "p1", nasProfileId: "nas-1", enabled: true };
const nas = { id: "nas-1", enabled: true, services: ["mab", "dot1x"] };
test("enabled MAB policy requires enabled NAS and MAB service", () => {
  assert.deepEqual(checkMabNasBinding(policy, nas), { ok: true, reason: null });
  for (const invalid of [null, {}, { ...nas, id: "other" }, { ...nas, enabled: false }, { ...nas, enabled: "true" }, { ...nas, services: ["dot1x"] }, { ...nas, services: "mab" }]) assert.equal(checkMabNasBinding(policy, invalid).ok, false);
});
test("disabled policies may be staged but NAS binding is immutable", () => {
  assert.equal(checkMabNasBinding({ ...policy, enabled: false }, { ...nas, enabled: false }).ok, true);
  assert.deepEqual(checkMabNasBinding(policy, nas, { existingNasProfileId: "other" }), { ok: false, reason: "nas-binding-immutable" });
});
test("malformed policies fail closed", () => {
  for (const p of [null, [], "mab", { ...policy, enabled: "true" }]) assert.deepEqual(checkMabNasBinding(p, nas), { ok: false, reason: "invalid-policy" });
});
