import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Personnel API errors are English-first without changing authorization logic', () => {
  const source = readFileSync(new URL('../server/main.mjs', import.meta.url), 'utf8');
  const messages = [
    ['Personnel list must be an array.', 1],
    ['Only administrators may view the full personnel list.', 1],
    ['Full name is required.', 2],
    ['Personnel record was not found.', 2],
  ];
  for (const [message, count] of messages) {
    assert.equal(source.split('new Error("' + message + '")').length - 1, count, message);
  }
});
