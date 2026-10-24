import { validVlan } from "./policy-preview.mjs";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const onlyKeys = (obj, allowed) => Object.keys(obj).every((key) => allowed.has(key));
function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).every((key) =>
    typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
}

export function prepareMabPolicy(input, { forcedId = null } = {}) {
  const allowed = new Set(["id", "nasProfileId", "enabled", "knownMode", "knownVlan", "unknownMode", "guestVlan"]);
  if (!plain(input) || !onlyKeys(input, allowed)) return { ok: false, value: null, issues: ["invalid-policy"] };
  const id = forcedId || input.id;
  if (typeof id !== "string" || !idPattern.test(id) || (forcedId && input.id !== undefined && input.id !== forcedId)) {
    return { ok: false, value: null, issues: ["invalid-id"] };
  }
  if (typeof input.nasProfileId !== "string" || !idPattern.test(input.nasProfileId)) {
    return { ok: false, value: null, issues: ["invalid-nas-profile-id"] };
  }
  if (typeof input.enabled !== "boolean") return { ok: false, value: null, issues: ["invalid-enabled"] };
  if (!["reject", "accept-static", "accept-dynamic"].includes(input.knownMode)) {
    return { ok: false, value: null, issues: ["invalid-known-mode"] };
  }
  if (!["reject", "guest-vlan"].includes(input.unknownMode)) {
    return { ok: false, value: null, issues: ["invalid-unknown-mode"] };
  }
  let knownVlan = null;
  if (input.knownMode === "accept-dynamic") {
    knownVlan = validVlan(input.knownVlan);
    if (knownVlan === null) return { ok: false, value: null, issues: ["invalid-known-vlan"] };
  } else if (input.knownVlan !== undefined && input.knownVlan !== null) {
    return { ok: false, value: null, issues: ["unexpected-known-vlan"] };
  }
  let guestVlan = null;
  if (input.unknownMode === "guest-vlan") {
    guestVlan = validVlan(input.guestVlan);
    if (guestVlan === null) return { ok: false, value: null, issues: ["invalid-guest-vlan"] };
  } else if (input.guestVlan !== undefined && input.guestVlan !== null) {
    return { ok: false, value: null, issues: ["unexpected-guest-vlan"] };
  }
  return { ok: true, issues: [], value: {
    id, nasProfileId: input.nasProfileId, enabled: input.enabled,
    knownMode: input.knownMode, knownVlan, unknownMode: input.unknownMode, guestVlan,
  } };
}

export function storedPolicyToPreview(policy) {
  const prepared = prepareMabPolicy(policy);
  if (!prepared.ok) return null;
  const value = prepared.value;
  return {
    enabled: value.enabled,
    known: value.knownMode === "accept-dynamic"
      ? { mode: value.knownMode, vlan: value.knownVlan }
      : { mode: value.knownMode },
    unknown: value.unknownMode === "guest-vlan"
      ? { mode: value.unknownMode, vlan: value.guestVlan }
      : { mode: value.unknownMode },
  };
}
