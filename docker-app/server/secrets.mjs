import crypto from "node:crypto";

export function createSecretBox(secret) {
  const source = String(secret || "");
  if (source.length < 32) throw new Error("EMS_SECRET_KEY must contain at least 32 characters.");
  const key = crypto.createHash("sha256").update(source, "utf8").digest();

  return {
    encrypt(value) {
      const plaintext = String(value || "");
      if (!plaintext) return "";
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
    },
    decrypt(value) {
      const encoded = String(value || "");
      if (!encoded) return "";
      const [version, ivText, tagText, encryptedText] = encoded.split(":");
      if (version !== "v1" || !ivText || !tagText || !encryptedText) throw new Error("Stored device password is invalid.");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
      decipher.setAuthTag(Buffer.from(tagText, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
