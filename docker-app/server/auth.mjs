import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) throw new Error("رمز عبور باید حداقل ۸ کاراکتر باشد.");
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [kind, salt, encoded] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = Buffer.from(await scrypt(String(password), salt, expected.length, { N: 16384, r: 8, p: 1 }));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function parseCookies(header) {
  const result = {};
  for (const item of String(header || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 1) continue;
    result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return result;
}

export function sessionCookie(token, secure = false) {
  const flags = [`ems_session=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=43200"];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export function clearSessionCookie(secure = false) {
  const flags = ["ems_session=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}
