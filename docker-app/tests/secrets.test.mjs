import test from "node:test";
import assert from "node:assert/strict";
import { createSecretBox } from "../server/secrets.mjs";

test("device passwords are encrypted with authenticated encryption", () => {
  const box = createSecretBox("0123456789abcdef0123456789abcdef");
  const first = box.encrypt("Router-Password-123");
  const second = box.encrypt("Router-Password-123");
  assert.notEqual(first, second);
  assert.equal(box.decrypt(first), "Router-Password-123");
  assert.doesNotMatch(first, /Router-Password/);
});
