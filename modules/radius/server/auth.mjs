import crypto from "node:crypto";

export function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function parseCookies(header = "") {
  const result = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    result[part.slice(0,index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}
