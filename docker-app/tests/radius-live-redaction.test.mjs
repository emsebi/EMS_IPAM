import test from 'node:test';
import assert from 'node:assert/strict';
import {safeLiveEvent, safeLiveDiagnostics} from '../../modules/radius-ops/backend/safe-live.mjs';

test('live event strips attempted credentials, raw messages and free-form reasons', () => {
  const e = safeLiveEvent({type:'authentication', result:'REJECT', seq:7, at:42,
    username:'ali', sourceIp:'127.0.0.1', attemptedPassword:'P@ss-SENTINEL',
    passwordAvailable:true, message:'raw P@ss-SENTINEL', reason:'raw P@ss-SENTINEL',
    raw:'P@ss-SENTINEL', authMethod:'PAP'});
  assert.equal(e.username, 'ali');
  assert.equal(e.authMethod, 'PAP');
  assert.equal(e.reason, 'authentication rejected');
  assert.ok(!JSON.stringify(e).includes('P@ss-SENTINEL'));
  assert.ok(!('attemptedPassword' in e));
  assert.ok(!('message' in e));
});

test('service event never passes raw daemon messages', () => {
  const e = safeLiveEvent({type:'service', result:'INFO', message:'secret = BAD'});
  assert.equal(e.type, 'service');
  assert.ok(!('message' in e));
});

test('transport reasons are an allowlist, not arbitrary daemon output', () => {
  assert.equal(safeLiveEvent({type:'transport', result:'DROP', reason:'unknown RADIUS client'}).reason,
    'unknown RADIUS client');
  assert.ok(!('reason' in safeLiveEvent({type:'transport', result:'DROP', reason:'password = BAD'})));
});

test('diagnostics never forwards serviceMessages or unknown fields', () => {
  const d = safeLiveDiagnostics({ok:true, running:true, auth1812Ready:true,
    serviceMessages:['password = BAD'], raw:'BAD', lastAuthAt:123});
  assert.deepEqual(d.serviceMessages, []);
  assert.ok(!('raw' in d));
  assert.equal(d.lastAuthAt, 123);
  assert.equal(d.auth1812Ready, true);
  assert.ok(!JSON.stringify(d).includes('BAD'));
});

test('invalid input is rejected without reflecting content', () => {
  assert.equal(safeLiveEvent(null), null);
  assert.equal(safeLiveEvent({type:'unknown', attemptedPassword:'BAD'}), null);
  assert.equal(safeLiveEvent({type:'authentication', result:'arbitrary'}).result, 'INFO');
});

test('RADIUS operator live view has no attempted-password rendering', async () => {
  const {readFileSync} = await import('node:fs');
  const {fileURLToPath} = await import('node:url');
  const {resolve, dirname} = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const ui = readFileSync(resolve(root, 'modules/radius/public/index.mjs'), 'utf8');
  assert.doesNotMatch(ui, /e\.attemptedPassword/);
  assert.doesNotMatch(ui, /<code>password=\$\{esc\(/);
});
