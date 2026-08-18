export function ipv4ToInt(value) {
  const parts = String(value).trim().split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    out = (out * 256 + octet) >>> 0;
  }
  return out >>> 0;
}

export function intToIpv4(value) {
  const n = Number(value) >>> 0;
  return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

export function parseCidr(value) {
  const match = String(value).trim().match(/^(.+)\/(\d|[12]\d|3[0-2])$/);
  if (!match) return null;
  const address = ipv4ToInt(match[1]);
  const prefix = Number(match[2]);
  if (address === null) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (address & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  const end = start + size - 1;
  return {
    input: String(value).trim(),
    cidr: `${intToIpv4(start)}/${prefix}`,
    prefix,
    start,
    end,
    size,
    canonical: address === start,
  };
}

export function contains(container, candidate) {
  const a = typeof container === "string" ? parseCidr(container) : container;
  const b = candidate && typeof candidate === "object"
    ? candidate
    : typeof candidate === "string" && candidate.includes("/")
      ? parseCidr(candidate)
      : { start: typeof candidate === "number" ? candidate : ipv4ToInt(candidate), end: typeof candidate === "number" ? candidate : ipv4ToInt(candidate) };
  return Boolean(a && b && b.start !== null && b.start >= a.start && b.end <= a.end);
}

export function validateRootCidr(value) {
  const parsed = parseCidr(value);
  if (!parsed || !parsed.canonical) throw new Error("رنج اصلی معتبر و هم‌تراز نیست.");
  if (parsed.prefix < 16 || parsed.prefix > 24) throw new Error("در نسخهٔ فعلی، رنج اصلی باید بین /16 تا /24 باشد.");
  return parsed;
}

export function validateChildCidr(value, rootCidr) {
  const parsed = parseCidr(value);
  const root = parseCidr(rootCidr);
  if (!parsed || !parsed.canonical) throw new Error("CIDR معتبر و هم‌تراز نیست.");
  if (!root || !contains(root, parsed)) throw new Error("رنج خارج از فضای آدرس انتخاب‌شده است.");
  if (parsed.prefix < root.prefix || parsed.prefix > 30) throw new Error("اندازهٔ رنج باید بین رنج اصلی و /30 باشد.");
  return parsed;
}

export function validateHostIp(value, rootCidr) {
  const parsed = ipv4ToInt(value);
  const root = parseCidr(rootCidr);
  if (parsed === null || !root || !contains(root, parsed)) throw new Error("IP خارج از فضای آدرس انتخاب‌شده است.");
  return intToIpv4(parsed);
}

export function validatePort(value, { allowZero = true } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < minimum || port > 65535) throw new Error("پورت باید عددی بین ۰ تا ۶۵۵۳۵ باشد.");
  return port;
}
