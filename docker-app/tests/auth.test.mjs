import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../server/auth.mjs";

test("passwords are salted and verified", async () => {
  const first = await hashPassword("StrongPassword-123");
  const second = await hashPassword("StrongPassword-123");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("StrongPassword-123", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
});
