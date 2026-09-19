import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverModules } from '../server/modules.mjs';

test('legacy module folders without module.json are ignored', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-mod-'));
  await fs.mkdir(path.join(root, 'network-map'));
  await fs.writeFile(path.join(root, 'network-map', 'old.txt'), 'legacy');
  await fs.mkdir(path.join(root, 'valid'));
  await fs.writeFile(path.join(root, 'valid', 'module.json'), JSON.stringify({id:'valid',name:'Valid',version:'1.0.0'}));
  const warnings = [];
  const mods = await discoverModules({root, logger:{warn:m=>warnings.push(m)}});
  assert.equal(mods.length, 1);
  assert.equal(mods[0].id, 'valid');
  assert.equal(warnings.length, 0);
  await fs.rm(root, {recursive:true, force:true});
});
