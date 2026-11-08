import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createRadioGeo} from '../../modules/radio/backend/geo.mjs';

const adapter=(db)=>{
  const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0};};
  return {query,connect:async()=>({query,release(){}})};
};
test('radio coordinates write to PostgreSQL even with unwritable backup directory; preserve scoping, clears and map CSP',async()=>{
  const db=new PGlite(),pool=adapter(db);
  const moduleDir=fileURLToPath(new URL('../../modules/radio/',import.meta.url));
  const backups='/proc/ems-ipam-radio-unwritable';
  const audits=[];
  try{
    await migrateDatabase(pool);
    const migration=await migrateModuleSchemas(pool,[{id:'radio',dir:moduleDir}]);
    assert.deepEqual(migration.failed,[]);
    assert.equal(migration.applied.length,1);
    assert.deepEqual((await migrateModuleSchemas(pool,[{id:'radio',dir:moduleDir}])).applied,[]);
    await pool.query("INSERT INTO companies(id,name) VALUES('co','Company'),('another','Another')");
    await pool.query("INSERT INTO address_spaces(id,company_id,name,cidr) VALUES('a','co','A','192.0.2.0/24'),('b','another','B','198.51.100.0/24')");
    await pool.query("INSERT INTO hosts(id,space_id,ip,name,radio_mode,radio_parent_host_id) VALUES('ap','a','192.0.2.10','AP','ap',null),('st','a','192.0.2.11','Station','station','ap'),('other','b','198.51.100.1','Other','ap',null)");
    const ctx={pool,backupDir:backups,json:(_r,code,value)=>value,readBody:async req=>req.body,
      requireModuleAccess:async(user)=>{if(user.blocked)throw Object.assign(new Error('Denied'),{status:403});},
      requireAdmin:user=>{if(user.role!=='admin')throw Object.assign(new Error('Denied'),{status:403});},
      canAccessSpace:async(user,space)=>!(user.denied||[]).includes(space),
      audit:async(...args)=>audits.push(args)};
    const api=createRadioGeo(ctx),admin={role:'admin'},viewer={role:'viewer'};
    const call=(method,route,body,user=admin,res={})=>api.handle({method,body},res,new URL('http://local'+route),user);
    assert.equal(api.match({},new URL('http://test/api/radio/map')),true);
    assert.deepEqual((await call('GET','/api/radio/locations?apId=ap')).items,[]);
    await assert.rejects(call('PUT','/api/radio/location',{hostId:'ap',latitude:35,longitude:51},viewer),{status:403});
    await assert.rejects(call('PUT','/api/radio/location',{hostId:'ap',latitude:91,longitude:51}),{status:400});
    await assert.rejects(call('PUT','/api/radio/location',{hostId:'ap',latitude:'',longitude:51}),{status:400});
    await assert.rejects(call('PUT','/api/radio/location',{hostId:'ap',latitude:30,longitude:51},{role:'admin',denied:['a']}),{status:404});
    const saved=await call('PUT','/api/radio/location',{hostId:'ap',latitude:35.68921712,longitude:51.38905098});
    assert.equal(saved.item.latitude,35.689217);assert.equal(saved.item.longitude,51.389051);
    await call('PUT','/api/radio/location',{hostId:'st',latitude:0,longitude:0});
    const dbRow=(await pool.query('SELECT latitude,longitude FROM radio_doc_locations WHERE host_id=$1',['ap'])).rows[0];
    assert.equal(dbRow.latitude,35.689217);assert.equal(dbRow.longitude,51.389051);
    const readAfterRestart=createRadioGeo(ctx);
    const results=await readAfterRestart.handle({method:'GET'},{},new URL('http://local/api/radio/locations?apId=ap'),viewer);
    assert.equal(results.items.length,2);
    assert.ok(results.items.some(x=>x.hostId==='ap'&&x.latitude===35.689217));
    await assert.rejects(call('GET','/api/radio/locations?apId=ap',undefined,{role:'viewer',denied:['a']}),{status:404});
    await assert.rejects(call('GET','/api/radio/locations?apId=other',undefined,{role:'viewer',denied:['b']}),{status:404});
    assert.equal(JSON.stringify(results).includes('password'),false);
    const response={writeHead(code,headers){this.code=code;this.headers=headers;},end(html){this.html=html.toString('utf8');}};
    await call('GET','/api/radio/map',undefined,viewer,response);
    assert.equal(response.code,200);
    assert.match(response.headers['Content-Security-Policy'],/img-src 'self' data: https:\/\/tile.openstreetmap.org/);
    assert.match(response.headers['Content-Security-Policy'],/frame-ancestors 'self'/);
    assert.doesNotMatch(response.headers['Content-Security-Policy'],/unsafe-eval/);
    assert.match(response.html,/OpenStreetMap contributors/);
    await assert.rejects(call('GET','/api/radio/map',undefined,{blocked:true}),{status:403});
    await call('PUT','/api/radio/location',{hostId:'ap',latitude:null,longitude:null});
    assert.equal((await call('GET','/api/radio/locations?apId=ap')).items.some(x=>x.hostId==='ap'),false);
    assert.equal((await pool.query('SELECT count(*)::int n FROM radio_doc_locations')).rows[0].n,2);
    assert.equal(audits.length,3);
  }finally{await db.close();}
});
test('radio UI documents coordinates and launches existing connection action rather than SSH auto-login',async()=>{
 const [ui,frame,script,geo,topology]=await Promise.all([
  fs.readFile(new URL('../../modules/radio/public/index.mjs',import.meta.url),'utf8'),
  fs.readFile(new URL('../../modules/radio/public/map-frame.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../../modules/radio/public/map-frame.mjs',import.meta.url),'utf8'),
  fs.readFile(new URL('../../modules/radio/public/geo-ui.mjs',import.meta.url),'utf8'),
  fs.readFile(new URL('../../modules/radio/public/topology.mjs',import.meta.url),'utf8')
 ]);
 for(const pattern of [/createGeoUi/,/geo.attach/,/radio-connect/,/openToolMenu/,/radioDocSave/,/ping-radio/])assert.match(ui,pattern);
 for(const pattern of [/radioGeoTarget/,/radioGeoLatitude/,/radioGeoLongitude/,/radioGeoSave/,/radioGeoClear/,/radioGeoFrame/])assert.match(geo,pattern);
 assert.match(frame,/OpenStreetMap contributors/);assert.match(script,/tile.openstreetmap.org/);
 assert.match(script,/ems:radio:geo:pick/);assert.match(script,/event.origin!==location.origin/);
 assert.match(topology,/radio-doc-connect|radio-connect/);
 assert.doesNotMatch(ui,/ssh2|radcheck|alter table/i);
});
