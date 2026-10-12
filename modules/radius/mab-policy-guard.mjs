/** Guard persisted MAB policy NAS bindings. No RADIUS enforcement or equipment writes. */
export function checkMabNasBinding(policy, nas, { existingNasProfileId = null } = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || typeof policy.enabled !== "boolean") return { ok: false, reason: "invalid-policy" };
  if (!nas || typeof nas !== "object" || Array.isArray(nas) || nas.id !== policy.nasProfileId) return { ok: false, reason: "nas-not-found" };
  if (existingNasProfileId !== null && existingNasProfileId !== policy.nasProfileId) return { ok: false, reason: "nas-binding-immutable" };
  if (policy.enabled && (nas.enabled !== true || !Array.isArray(nas.services) || !nas.services.includes("mab"))) return { ok: false, reason: "nas-mab-disabled" };
  return { ok: true, reason: null };
}
