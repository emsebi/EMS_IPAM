import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cli} from '../../modules/radius-ops/backend/model.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backend=readFileSync(resolve(root,'modules/radius-ops/backend/index.mjs'),'utf8');
const ui=readFileSync(resolve(root,'modules/radius/public/index.mjs'),'utf8');

test('legacy credential reveal endpoints are explicit 403 and never query secrets',()=>{
  const block=backend.split('Legacy reveal routes are intentionally retained as explicit denials.')[1]
    ?.split("if(m==='GET'&&p===base+'/macs')")[0];
  assert.ok(block,'missing write-only deny routes');
  assert.match(block,/secret-profiles.*reveal\$\/\.test\(p\)/);
  assert.match(block,/accounts.*reveal-password\$\/\.test\(p\)/);
  assert.equal((block.match(/Stored credentials are write-only',403/g)||[]).length,2);
  assert.doesNotMatch(block,/pool\.query|radcheck|SELECT|\.secret|\.password/);
});

test('NAS config generation does not select stored secret and uses a placeholder',()=>{
  const block=backend.split("if(m==='POST'&&p===base+'/config')")[1]
    ?.split('const match=p.match')[0];
  assert.ok(block,'missing config route');
  assert.match(block,/SELECT d\.nas_ip::text AS "nasIp" FROM radius_ops_devices/);
  assert.doesNotMatch(block,/COALESCE|p\.secret|d\.secret|secret_profile_id/);
  assert.match(block,/secret:'SET_SHARED_SECRET_HERE'/);
});

test('generated Cisco and MikroTik CLI never include a real stored credential',()=>{
  for(const vendor of ['cisco-ios','cisco-legacy','mikrotik']){
    const value=cli({vendor,secret:'SET_SHARED_SECRET_HERE'},'192.0.2.5');
    assert.match(value,/SET_SHARED_SECRET_HERE/);
    assert.doesNotMatch(value,/real-secret-sentinel/);
  }
});

test('RADIUS UI has no credential reveal or copy affordance',()=>{
  for(const term of ['rRevealSecret','rRevealPassword','credentialReveal',
    'rCredentialCopy','revealCredential('])assert.ok(!ui.includes(term),term);
  assert.match(ui,/rSecretForm/);
  assert.match(ui,/rUserForm/);
});
