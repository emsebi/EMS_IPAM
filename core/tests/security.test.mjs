import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../server/security.mjs';

test('password hashing round-trip', () => {
  const hash = hashPassword('Correct-Horse-42');
  assert.equal(verifyPassword('Correct-Horse-42', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
});

test('tokens and hashes are usable', () => {
  const token = randomToken();
  assert.ok(token.length > 30);
  assert.equal(sha256(token).length, 64);
});
