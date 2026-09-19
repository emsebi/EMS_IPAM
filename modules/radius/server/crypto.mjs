import crypto from "node:crypto";

function key() {
  const raw = String(process.env.EMS_SECRET_KEY || "");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("EMS_SECRET_KEY must be a 64-character hex value.");
  return Buffer.from(raw, "hex");
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(value) {
  const [version, ivText, tagText, dataText] = String(value || "").split(":");
  if (version !== "v1" || !ivText || !tagText || dataText === undefined) throw new Error("Encrypted secret is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64")), decipher.final()]).toString("utf8");
}
