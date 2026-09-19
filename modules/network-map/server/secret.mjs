import crypto from "node:crypto";
function key() {
  const raw = String(process.env.EMS_SECRET_KEY || "");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("EMS_SECRET_KEY must be a 64-character hex value.");
  return Buffer.from(raw, "hex");
}
export function decryptSecret(value) {
  const [version, ivText, tagText, dataText] = String(value || "").split(":");
  if (version !== "v1") throw new Error("Stored system account secret is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64")), decipher.final()]).toString("utf8");
}
