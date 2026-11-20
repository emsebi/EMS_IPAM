import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/link-planner/backend/index.mjs';
import {coordinate,greatCircleMeters,normalizeInput,radioBudget,assessTerrain,interpolateGreatCircle,fitGeoPoints} from '../../modules/link-planner/public/model.mjs';

const coords={a:{latitude:35.6,longitude:51.3},b:{latitude:35.65,longitude:51.35}};
const valid=()=>normalizeInput({...coords,siteA:{building:0,tower:15,mount:2},siteB:{building:5,tower:12,mount:1},frequencyGHz:5.8,txDbm:22,gainA:27,gainB:27,lossA:1,lossB:1,sensitivityDbm:-80});

test('Link Planner is a separate admin-only panel using module contract v1',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../../modules/link-planner/module.json',import.meta.url),'utf8'));
  assert.equal(manifest.navigation.panel,true);assert.deepEqual(manifest.roles,['admin']);
  assert.equal(manifest.backend,'backend/index.mjs');
  const text=await fs.readFile(new URL('../../modules/link-planner/public/index.mjs',import.meta.url),'utf8');
  assert.match(text,/createUi/);assert.match(text,/openPage/);
  assert.doesNotMatch(text,/ssh2|radius-ops|pingMany/);
});
test('WGS84 distance and location validation preserve missing instead of pretending zero',()=>{
  assert.ok(Math.abs(greatCircleMeters({latitude:0,longitude:0},{latitude:0,longitude:1})-111195)<2);
  assert.ok(Math.abs(greatCircleMeters({latitude:0,longitude:179.9},{latitude:0,longitude:-179.9})-22239)<10);
  assert.throws(()=>coordinate('',-90,90,'latitude'),/required/);
  assert.throws(()=>normalizeInput({a:{latitude:0,longitude:0},b:{latitude:0,longitude:0}}),/between 10 m/);
  assert.throws(()=>normalizeInput({a:{latitude:0,longitude:0},b:{latitude:0,longitude:10}}),/300 km/);
  assert.throws(()=>normalizeInput({...coords,frequencyGHz:105}),/Frequency/);
  const points=interpolateGreatCircle({latitude:0,longitude:179.95},{latitude:0,longitude:-179.95},81);
  assert.equal(points.length,81);assert.ok(Math.abs(points[40].longitude)>179.9);
  assert.ok(fitGeoPoints(points,900,540).zoom>3);
});
test('budget formula FSPL, EIRP, RX and margin are mathematical estimates not throughput',()=>{
  const p=normalizeInput({a:{latitude:0,longitude:0},b:{latitude:0,longitude:0.089932},frequencyGHz:5.8,txDbm:20,gainA:27,gainB:27,lossA:1,lossB:1,otherLoss:0,sensitivityDbm:-80});
  const result=radioBudget(p);
  assert.ok(Math.abs(result.distanceKm-10)<.01);
  assert.ok(Math.abs(result.fsplDb-127.72)<.2);
  assert.ok(Math.abs(result.eirpDbm-46)<.001);
  assert.ok(Math.abs(result.rxDbm-(-55.72))<.2);
  assert.ok(Math.abs(result.marginDb-24.28)<.2);
  assert.equal('throughput' in result,false);
});
test('terrain clearance requires every sample; Earth bulge and 60% Fresnel may block long spans',()=>{
  const near=normalizeInput({a:{latitude:0,longitude:0},b:{latitude:0,longitude:0.09},siteA:{tower:12},siteB:{tower:12},frequencyGHz:5.8});
  const clear=assessTerrain(near,Array(81).fill(100));
  assert.equal(clear.status,'clear');
  assert.ok(clear.samples[40].fresnelM>10);
  assert.ok(clear.maxEarthBulgeM>0);
  const low=normalizeInput({a:{latitude:0,longitude:0},b:{latitude:0,longitude:0.9},siteA:{tower:12},siteB:{tower:12},frequencyGHz:5.8});
  const blocked=assessTerrain(low,Array(81).fill(100));
  assert.equal(blocked.status,'obstructed');
  assert.ok(blocked.recommendedRaiseBothM>100);
  const missing=Array(81).fill(100);missing[37]=null;
  assert.equal(assessTerrain(near,missing).status,'unavailable');
  assert.equal(assessTerrain(near,[]).status,'unavailable');
});
test('module-only DB migration, validation, user scoping, scenario CRUD and terrain service bounded to fixed provider',async()=>{
 const db=new PGlite();
 const q=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0};};
 const pool={query:q,connect:async()=>({query:q,release(){}})};
 const calls=[],audit=[],admin={id:'1',role:'admin'},viewer={id:'2',role:'viewer'};
 const mockFetch=async(url,options)=>{
   calls.push({url,method:options.method});
   assert.ok(url.startsWith('https://api.opentopodata.org/v1/srtm90m?'));
   assert.equal(new URL(url).searchParams.get('samples'),'81');
   return {ok:true,json:async()=>({status:'OK',results:Array.from({length:81},(_,i)=>({elevation:100+i*.25}))})};
 };
 const ctx={pool,terrainFetch:mockFetch,json:(_res,code,data)=>({...data,httpCode:code}),readBody:async req=>req.body,
   requireAdmin:u=>{if(u.role!=='admin')throw Object.assign(new Error('Forbidden'),{status:403});},
   requireModuleAccess:async()=>{},audit:async(...args)=>audit.push(args)};
 try{
   await migrateDatabase(pool);
   const root=fileURLToPath(new URL('../../modules/link-planner/',import.meta.url));
   let m=await migrateModuleSchemas(pool,[{id:'link-planner',dir:root}]);assert.deepEqual(m.failed,[]);assert.equal(m.applied.length,1);
   m=await migrateModuleSchemas(pool,[{id:'link-planner',dir:root}]);assert.deepEqual(m.applied,[]);
   const api=createModule(ctx);
   const invoke=(method,path,body,user=admin,res={})=>api.handle({method,body},res,new URL('http://local'+path),user);
   assert.equal(api.match({},new URL('http://local/api/link-planner/terrain')),true);
   await assert.rejects(invoke('GET','/api/link-planner/scenarios',undefined,viewer),{status:403});
   await assert.rejects(invoke('POST','/api/link-planner/scenarios',{name:'',config:valid()}),{status:400});
   await assert.rejects(invoke('POST','/api/link-planner/scenarios',{name:'Bad',config:{a:{latitude:0},b:{latitude:2}}}),{status:400});
   const created=await invoke('POST','/api/link-planner/scenarios',{name:'Roof to tower',config:valid()});
   assert.equal(created.httpCode,201);
   const id=created.item.id;
   assert.ok(id);
   assert.equal((await invoke('GET','/api/link-planner/scenarios')).items.length,1);
   assert.equal((await invoke('GET','/api/link-planner/scenarios/'+id)).item.name,'Roof to tower');
   const qs=new URLSearchParams({latA:'35.6',lonA:'51.3',latB:'35.65',lonB:'51.35'});
   const one=await invoke('GET','/api/link-planner/terrain?'+qs);
   assert.equal(one.elevations.length,81);assert.equal(one.dataset,'srtm90m');
   assert.equal(calls.length,1);
   assert.equal((await invoke('GET','/api/link-planner/terrain?'+qs)).cached,true);
   assert.equal(calls.length,1);
   await assert.rejects(invoke('GET','/api/link-planner/terrain?latA=80&lonA=1&latB=80.2&lonB=1.2'),{status:422});
   await assert.rejects(invoke('GET','/api/link-planner/terrain?latA=35.6&lonA=51.3&latB=35.7&lonB=51.3'),{status:429});
   const frame={writeHead(code,headers){this.code=code;this.headers=headers;},end(body){this.body=body.toString();}};
   await invoke('GET','/api/link-planner/map',undefined,admin,frame);
   assert.equal(frame.code,200);assert.match(frame.body,/map-frame.mjs/);
   assert.match(frame.headers['Content-Security-Policy'],/frame-ancestors 'self'/);
   assert.match(frame.headers['Content-Security-Policy'],/tile.openstreetmap.org/);
   await assert.rejects(invoke('GET','/api/link-planner/map',undefined,viewer),{status:403});
   await invoke('DELETE','/api/link-planner/scenarios/'+id);
   assert.equal((await invoke('GET','/api/link-planner/scenarios')).items.length,0);
   assert.equal(audit.length,2);
 }finally{await db.close();}
});
