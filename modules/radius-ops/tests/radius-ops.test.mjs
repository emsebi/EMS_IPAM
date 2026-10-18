import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {mac,aliases,password,secret,cli,replies,vid,nasSource} from '../backend/model.mjs';import {createModule} from '../backend/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const shared='aabbccddeeff00112233445566778899';
test('MAC formats, multicast denial and aliases',()=>{assert.equal(mac('aa-bb-cc-dd-ee-f0'),'aa:bb:cc:dd:ee:f0');assert.ok(aliases('aa:bb:cc:dd:ee:f0').includes('aabb.ccdd.eef0'));assert.throws(()=>mac('ff:ff:ff:ff:ff:ff'));});
test('Cisco IOS 2960 and modern device commands',()=>{const d={vendor:'cisco-legacy',secret:shared};assert.match(cli(d,'10.0.0.2'),/radius-server host/);assert.match(cli({...d,vendor:'cisco-ios'},'10.0.0.2','mab','GigabitEthernet0/2'),/mab/);});
test('MikroTik AAA, safe secret and VLAN replies',()=>{assert.match(cli({vendor:'mikrotik',secret:shared},'10.0.0.2'),/use-radius=yes/);assert.throws(()=>secret('a\nconfigure terminal'));assert.deepEqual(replies({vlan:20})[2],['Tunnel-Private-Group-Id','20']);assert.throws(()=>vid(4095));});
test('API denies unauthorized access before database calls',async()=>{let touched=false;const h=createModule({pool:{query(){touched=true;}},json(){touched=true;},requireModuleAccess:async()=>{},requireAdmin:()=>{throw Object.assign(Error('forbidden'),{status:403});}});await assert.rejects(h.handle({method:'GET'},{},new URL('http://localhost/api/radius-ops/devices'),{role:'viewer'}),{status:403});assert.equal(touched,false);});
test('SQL tenant guard and default EAP disabled',()=>{const sql=fs.readFileSync(path.join(root,'migrations/001-radius-ops.sql'),'utf8');const site=fs.readFileSync(path.join(root,'freeradius/default-site'),'utf8');assert.match(sql,/d\.nas_ip=source_ip/);assert.match(sql,/m\.company_id=d\.company_id/);assert.match(site,/Packet-Src-IP-Address/);assert.match(site,/radius_ops_identity_allowed/);assert.doesNotMatch(site,/^\s*eap\s*$/m);});
test('GUI includes CRUD and manual copy flows',()=>{const ui=fs.readFileSync(path.join(root,'public/app.mjs'),'utf8');assert.match(ui,/id\?'PUT':'POST'/);assert.match(ui,/'DELETE'/);assert.match(ui,/navigator\.clipboard/);assert.match(ui,/localStorage\.setItem\('radius-lang'/);});
test('802.1X commands are blocked while EAP is not provisioned',()=>{
 assert.throws(()=>cli({vendor:'cisco-ios',secret:shared},'10.0.0.2','dot1x'),e=>e.status===409&&/EAP/.test(e.message));
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.match(html,/<option value="dot1x" disabled>/);
});
test('authentication reports include trusted packet source and device, without passwords',()=>{
 const migration=fs.readFileSync(path.join(root,'migrations/002-authentication-source.sql'),'utf8');
 const backend=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 const sanitizer=fs.readFileSync(path.join(root,'freeradius/sanitize-queries.py'),'utf8');
 assert.match(migration,/sourceipaddress/);
 assert.match(backend,/sourceIp/);
 assert.match(backend,/deviceLabel/);
 assert.match(sanitizer,/Packet-Src-IP-Address/);
 assert.match(sanitizer,/User-Password/);
});
test('English is the default UI language, with Persian and RTL switch available',()=>{
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'public/app.mjs'),'utf8');
 assert.match(html,/<html lang="en" dir="ltr">/);
 assert.match(ui,/localStorage\.getItem\('radius-lang'\)\|\|'en'/);
 assert.match(ui,/S\.lang==='fa'\?'rtl':'ltr'/);
});

test('legacy MAB command sets explicit order and priority for Cisco IOS',()=>{
 const out=cli({vendor:'cisco-legacy',secret:shared},'10.0.0.2','mab','FastEthernet0/1');
 assert.match(out,/authentication order mab/);
 assert.match(out,/authentication priority mab/);
 assert.match(out,/Preserve console and local recovery access/);
});


test('archived and transferred inventory cannot authorize previously registered NAS',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/004-active-inventory-tenant-guard.sql'),'utf8');
 for(const rule of ['h.deleted_at IS NULL','s.deleted_at IS NULL','c.deleted_at IS NULL','d.company_id=s.company_id','d.nas_ip=source_ip'])assert.ok(sql.includes(rule),rule);
});
test('live table filter is searchable without server-side permissions changes',()=>{
 const ui=fs.readFileSync(path.join(root,'public/app.mjs'),'utf8');
 assert.match(ui,/data-search/);assert.match(ui,/toLocaleLowerCase/);assert.match(ui,/S.search=''/);
});


test('SQL policy precheck returns allow and deny without receiving a password',async()=>{
 const calls=[];let sent;
 const pool={async query(query,params){calls.push({query,params});return {rows:[{
   nasRegistered:params[1]==='192.0.2.10',
   credentialsReady:params[0]==='admin1',
   policyAllowed:params[0]==='admin1'&&params[1]==='192.0.2.10',
 }]};}};
 const h=createModule({pool,json(_res,status,body){sent={status,body};return sent;},
  readBody:async req=>req.body,requireModuleAccess:async()=>{},requireAdmin:()=>{}});
 const route=new URL('http://localhost/api/radius-ops/precheck');
 await h.handle({method:'POST',body:{identity:'admin1',nasIp:'192.0.2.10'}},{},route,{role:'admin'});
 assert.equal(sent.status,200);assert.equal(sent.body.allowed,true);
 assert.equal(sent.body.udpTested,false);assert.equal(sent.body.scope,'sql-policy-only');
 await h.handle({method:'POST',body:{identity:'admin1',nasIp:'192.0.2.11'}},{},route,{role:'admin'});
 assert.equal(sent.body.allowed,false);assert.equal(sent.body.reason,'nas-not-registered');
 await h.handle({method:'POST',body:{identity:'unknown',nasIp:'192.0.2.10'}},{},route,{role:'admin'});
 assert.equal(sent.body.allowed,false);assert.equal(sent.body.reason,'identity-not-provisioned');
 assert.equal(calls.length,3);
 for(const call of calls){assert.deepEqual(call.params.length,2);assert.match(call.query,/radius_ops_identity_allowed\(\$1,\$2::inet\)/);}
});

test('policy precheck rejects malformed identities and NAS IP before SQL',async()=>{
 let queried=false;const h=createModule({pool:{query(){queried=true;}},json(){},
  readBody:async req=>req.body,requireModuleAccess:async()=>{},requireAdmin:()=>{}});
 const route=new URL('http://localhost/api/radius-ops/precheck');
 for(const body of [{identity:"x' OR 1=1",nasIp:'192.0.2.10'},
                    {identity:'admin1',nasIp:'not-an-ip'},
                    {identity:'admin1',nasIp:'239.1.1.1'}]){
  await assert.rejects(h.handle({method:'POST',body},{},route,{role:'admin'}),{status:400});
 }
 assert.equal(queried,false);
});

test('policy precheck is admin-only and cannot leak credentials',async()=>{
 let touched=false;
 const h=createModule({pool:{query(){touched=true;}},json(){touched=true;},
  readBody:async()=>{touched=true;},requireModuleAccess:async()=>{},
  requireAdmin:()=>{throw Object.assign(Error('forbidden'),{status:403});}});
 await assert.rejects(h.handle({method:'POST'},{},new URL('http://localhost/api/radius-ops/precheck'),{role:'viewer'}),{status:403});
 assert.equal(touched,false);
});

// Regression: hosts has a `type` column, not `vendor`. The old query made
// /inventory fail and the UI's Promise.all discarded every other response.
test('real IPAM schema matches RADIUS inventory endpoint',async()=>{
 const schema=fs.readFileSync(process.env.EMS_CORE_SCHEMA_PATH || path.join(root,'../../docker-app/server/schema.sql'),'utf8');
 const hostTable=schema.split('CREATE TABLE IF NOT EXISTS hosts (')[1].split(');')[0];
 assert.match(hostTable,/\btype text NOT NULL/);
 assert.doesNotMatch(hostTable,/\bvendor\s+text/);
 let sent;const pool={query:async sql=>{assert.match(sql,/h\.type AS vendor/);assert.doesNotMatch(sql,/h\.vendor/);return {rows:[{id:'host-1',name:'Lab Switch',ip:'192.0.2.10',vendor:'switch',companyId:'co-1',companyName:'Lab'}]};}};
 const handler=createModule({pool,json(_res,status,body){sent={status,body};return sent;},requireModuleAccess:async()=>{},requireAdmin:()=>{}});
 await handler.handle({method:'GET'},{},new URL('http://localhost/api/radius-ops/inventory'),{role:'admin'});
 assert.equal(sent.status,200);assert.equal(sent.body.items[0].vendor,'switch');
});
test('UI can render healthy endpoints even if inventory query fails',()=>{
 const ui=fs.readFileSync(path.join(root,'public/app.mjs'),'utf8');
 assert.match(ui,/Promise\.allSettled/);
 assert.match(ui,/S\.inventory=S\.data\.inventory\?\.items\|\|\[\]/);
 assert.match(ui,/if\(k==='health'\)S\.data\.health=\{ok:false,running:false,eap:false\}/);
});

test('NAS source accepts exact IPv4 and canonical CIDR only',()=>{
 assert.equal(nasSource('192.0.2.10'),'192.0.2.10');
 assert.equal(nasSource('192.0.2.99/24'),'192.0.2.0/24');
 assert.equal(nasSource('10.20.30.40/32'),'10.20.30.40');
 for(const bad of ['192.0.2.0/7','192.0.2.0/33','239.1.1.0/24','not-an-ip','0.0.0.0/8'])assert.throws(()=>nasSource(bad));
});

test('v23 simple AAA migration supports direct NAS ranges and group membership',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/005-simple-aaa-groups.sql'),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS radius_ops_groups/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS group_id/);
 assert.match(sql,/ALTER COLUMN host_id DROP NOT NULL/);
 assert.match(sql,/source_ip <<= d\.nas_ip/);
 assert.match(sql,/d\.host_id IS NULL/);
});


test('device update treats explicit null hostId as unlink from inventory', () => {
  const source = fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
  assert.match(source, /hasOwnProperty\.call\(b,'hostId'\)\?f\.hostId:old\.host_id/);
});

test('legacy v24 CIDR collections remain as upgrade history only',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/006-per-nas-permission-profiles.sql'),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS radius_ops_collections/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS radius_ops_collection_members/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS radius_ops_access_rules/);
});

test('v28 active collection model groups registered NAS objects, not raw CIDRs',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/010-nas-collection-membership.sql'),'utf8');
 const source=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 const ui=fs.readFileSync(path.join(root,'../radius/public/index.mjs'),'utf8');
 const site=fs.readFileSync(path.join(root,'freeradius/default-site'),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS radius_ops_collection_devices/);
 assert.match(sql,/JOIN radius_ops_collection_devices cd ON cd\.device_id=n\.id/);
 assert.doesNotMatch(sql,/prefix_len=\(SELECT max\(prefix_len\)/);
 assert.match(source,/collectionIds:collectionIds\(b\.collectionIds\)/);
 assert.match(source,/radius_ops_collection_devices/);
 assert.match(source,/Conflicting permission profiles for NAS/);
 assert.doesNotMatch(source,/collectionMembers\(b\.members\)/);
 assert.match(ui,/rClientCollection/);
 assert.doesNotMatch(ui,/name="members"/);
 assert.match(site,/radius_ops_resolve_access/);
 assert.match(site,/Cisco-AVPair/);
 assert.match(site,/Mikrotik-Group/);
});

test('v28 migrates legacy CIDR collection intent to matching registered NAS membership',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/010-nas-collection-membership.sql'),'utf8');
 assert.match(sql,/JOIN radius_ops_collection_members m/);
 assert.match(sql,/d\.nas_ip && m\.nas_source/);
 assert.match(sql,/ON CONFLICT\(collection_id,device_id\) DO NOTHING/);
});

test('live RADIUS operator feed uses native FreeRADIUS bad-password logging',()=>{
 const dockerfile=fs.readFileSync(path.join(root,'freeradius/Dockerfile'),'utf8');
 const site=fs.readFileSync(path.join(root,'freeradius/default-site'),'utf8');
 const supervisor=fs.readFileSync(path.join(root,'freeradius/supervisor.py'),'utf8');
 const backend=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 assert.match(dockerfile,/auth_badpass = yes/);
 assert.match(dockerfile,/auth_goodpass = no/);
 assert.match(dockerfile,/EMSLIVE\|REJECT/);
 assert.doesNotMatch(dockerfile,/ems-live-log/);
 assert.doesNotMatch(site,/ems_live_(?:accept|reject|accounting)/);
 assert.match(supervisor,/parse_native_auth_line/);
 assert.match(supervisor,/EMSLIVE\|REJECT/);
 assert.match(supervisor,/LIVE_EVENTS=collections\.deque\(maxlen=1000\)/);
 assert.match(supervisor,/if not LIVE_SUBSCRIBERS:return False/);
 assert.match(supervisor,/LIVE_EVENTS\.clear\(\)/);
 assert.match(supervisor,/stdout=subprocess\.PIPE/);
 assert.match(supervisor,/not copied to Docker logs|never forwarded to Docker logs/);
 assert.match(backend,/base\+'\/live\/events'/);
 assert.match(backend,/Cache-Control','no-store/);
});

test('operator UI exposes one volatile Live RADIUS Logs console',()=>{
 const ui=fs.readFileSync(path.join(root,'../radius/public/index.mjs'),'utf8');
 const en=JSON.parse(fs.readFileSync(path.join(root,'../radius/public/i18n/en.json'),'utf8'));
 assert.match(ui,/id="rLiveOpen"/);
 assert.match(ui,/api\('\/live\/start'/);
 assert.match(ui,/api\('\/live\/events'/);
 assert.match(ui,/liveItems\.length>1000/);
 assert.match(ui,/attemptedPassword/);
 assert.equal(en['radius.simple.liveLogs'],'Live RADIUS Logs');
});

test('v25 per-NAS resolver preserves Inventory fail-closed guards',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/007-per-nas-inventory-guard.sql'),'utf8');
 assert.match(sql,/LEFT JOIN hosts h ON h\.id=d\.host_id/);
 assert.match(sql,/h\.deleted_at IS NULL/);
 assert.match(sql,/s\.deleted_at IS NULL/);
 assert.match(sql,/s\.company_id=d\.company_id/);
 assert.match(sql,/d\.host_id IS NULL OR/);
});

test('v26 secret profiles allow deterministic NAS CIDR overlap',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/008-secret-profiles.sql'),'utf8');
 const backend=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS radius_ops_secret_profiles/);
 assert.match(sql,/secret_profile_id/);
 assert.match(backend,/checkNasDuplicate/);
 assert.doesNotMatch(backend,/checkNasOverlap/);
 assert.match(backend,/nas_ip=\$1::inet/);
 assert.match(backend,/radius_ops_secret_profiles/);
 assert.match(backend,/Secret profile is assigned to a NAS/);
});

test('NAS source explicitly supports dynamic /0 fallback without relaxing broad CIDRs',()=>{
 assert.equal(nasSource('0.0.0.0/0'),'0.0.0.0/0');
 assert.equal(nasSource('192.168.2.99/21'),'192.168.0.0/21');
 assert.throws(()=>nasSource('0.0.0.1'));
 assert.throws(()=>nasSource('10.0.0.0/7'));
});

test('RADIUS credentials allow short values but still reject empty/control characters',()=>{
 assert.equal(password('1234'),'1234');
 assert.equal(secret('abc123'),'abc123');
 assert.throws(()=>password(''));
 assert.throws(()=>password('ok\nno'));
 assert.throws(()=>secret(''));
 assert.throws(()=>secret('bad secret'));
});
test('RADIUS UI warns instead of blocking short password and shared secret',()=>{
 const ui=fs.readFileSync(path.join(root,'../radius/public/index.mjs'),'utf8');
 const en=JSON.parse(fs.readFileSync(path.join(root,'../radius/public/i18n/en.json'),'utf8'));
 assert.doesNotMatch(ui,/name="password"[^>]*minlength=/);
 assert.doesNotMatch(ui,/name="secret"[^>]*minlength=/);
 assert.match(en['radius.simple.passwordWeakWarning'],/allowed.*weak/i);
 assert.match(en['radius.simple.secretWeakWarning'],/allowed.*weak/i);
});

test('RADIUS diagnostics are available to the admin UI without shell access',()=>{
 const supervisor=fs.readFileSync(path.join(root,'freeradius/supervisor.py'),'utf8');
 const backend=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 const ui=fs.readFileSync(path.join(root,'../radius/public/index.mjs'),'utf8');
 assert.match(supervisor,/self\.path=='\/diagnostics'/);
 assert.match(supervisor,/auth1812Ready/);
 assert.match(supervisor,/accounting1813Ready/);
 assert.match(supervisor,/liveCollectorReady/);
 assert.match(backend,/base\+'\/diagnostics'/);
 assert.match(ui,/id="rDiagOpen"/);
});

test('v27 specific NAS definitions shadow broader fallback even when disabled',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/009-specific-nas-deny-shadow.sql'),'utf8');
 const backend=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 assert.match(sql,/CREATE OR REPLACE FUNCTION radius_ops_resolve_nas/);
 assert.match(sql,/ORDER BY masklen\(d\.nas_ip\) DESC/);
 assert.match(sql,/WHERE n\.active/);
 assert.match(sql,/sp\.enabled/);
 assert.match(backend,/Keep every registered NAS in the FreeRADIUS client radix tree/);
 assert.doesNotMatch(backend,/if\(!d\.enabled\)return/);
 assert.match(backend,/nas-disabled-or-inventory-denied/);
});

test('admin can reveal saved RADIUS credentials on explicit no-store endpoints',()=>{
 const backend=fs.readFileSync(path.join(root,'backend/index.mjs'),'utf8');
 const ui=fs.readFileSync(path.join(root,'../radius/public/index.mjs'),'utf8');
 assert.match(backend,/secret-profiles\\\/\(\[\^\/\]\+\)\\\/reveal/);
 assert.match(backend,/accounts\\\/\(\[\^\/\]\+\)\\\/reveal-password/);
 assert.match(backend,/Cleartext-Password/);
 assert.match(backend,/Cache-Control','no-store, private, max-age=0/);
 assert.match(backend,/radius-user-password/);
 assert.match(backend,/radius-secret-profile/);
 assert.match(ui,/rRevealSecret/);
 assert.match(ui,/rRevealPassword/);
 assert.match(ui,/rCredentialCopy/);
});
