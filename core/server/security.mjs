import crypto from 'node:crypto';

const ITERATIONS = 210000;
const KEYLEN = 32;
const DIGEST = 'sha256';

export function id(prefix = '') {
  const value = crypto.randomUUID();
  return prefix ? `${prefix}_${value}` : value;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const [kind, iter, salt, expected] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !expected) return false;
  const derived = crypto.pbkdf2Sync(password, salt, Number(iter), KEYLEN, DIGEST).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
