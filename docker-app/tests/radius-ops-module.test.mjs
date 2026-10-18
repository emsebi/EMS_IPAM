import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nasSource, secret, cli } from '../../modules/radius-ops/backend/model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('RADIUS operations module is hidden service backing the main RADIUS panel', () => {
  const manifest = JSON.parse(read('modules/radius-ops/module.json'));
  assert.equal(manifest.id, 'radius-ops');
  assert.equal(manifest.navigation, null);
  assert.equal(manifest.backend, 'backend/index.mjs');
  assert.deepEqual(manifest.roles, ['admin']);
});

test('direct NAS source supports one IPv4 or canonical CIDR', () => {
  assert.equal(nasSource('192.0.2.10'), '192.0.2.10');
  assert.equal(nasSource('192.0.2.99/24'), '192.0.2.0/24');
  assert.throws(() => nasSource('192.0.2.1/7'));
  assert.throws(() => nasSource('239.0.0.0/24'));
});

test('shared secrets allow weak values with validation and 802.1X stays fail-closed', () => {
  const strong = 'aabbccddeeff00112233445566778899';
  assert.equal(secret(strong), strong);
  assert.equal(secret('short'), 'short');
  assert.throws(() => secret(''));
  assert.throws(() => secret('bad secret'));
  assert.throws(() => cli({ vendor: 'cisco-ios', secret: strong }, '192.0.2.5', 'dot1x'), /disabled/i);
});

test('simple AAA migration adds groups, optional inventory link and CIDR policy', () => {
  const sql = read('modules/radius-ops/migrations/005-simple-aaa-groups.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS radius_ops_groups/);
  assert.match(sql, /ALTER COLUMN host_id DROP NOT NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS group_id/);
  assert.match(sql, /source_ip <<= d\.nas_ip/);
});

test('FreeRADIUS SQL config reads group replies and device updates can unlink inventory', () => {
  const supervisor = read('modules/radius-ops/freeradius/supervisor.py');
  const backend = read('modules/radius-ops/backend/index.mjs');
  assert.match(supervisor, /read_groups = yes/);
  assert.match(backend, /hasOwnProperty\.call\(b,'hostId'\)\?f\.hostId:old\.host_id/);
});
