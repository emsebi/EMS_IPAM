import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRadioGeo} from '../../modules/radio/backend/geo.mjs';

test('radio coordinates are scoped and persisted without device collection; authenticated map has strict scoped CSP',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radio-geo-'));
  const hosts={
    ap:{id:'ap',radioMode:'ap',spaceId:'a',companyId:'co'},
    st:{id:'st',radioMode:'station',spaceId:'a',companyId:'co'},
    other:{id:'other',radioMode:'ap',spaceId:'b',companyId:'different'}
  };
  const queries={count:0},audits=[];
  const ctx={
    backupDir:dir,
    pool:{query:async(sql,parameters)=>{
      queries.count++;
      if(sql.includes('radio_parent_host_id'))return {rows:[{id:'ap',spaceId:'a'},{id:'st',spaceId:'a'},{id:'other',spaceId:'b'}]};
      return {rows:hosts[parameters[0]]?[hosts[parameters[0]]]:[]};
    }},
    json:(_res,_status,payload)=>payload,
    readBody:async req=>req.body,
    requireModuleAccess:async(user)=>{if(user.blocked)throw Object.assign(new Error('Denied'),{status:403});},
    requireAdmin:user=>{if(user.role!=='admin')throw Object.assign(new Error('Denied'),{status:403});},
    canAccessSpace:async(user,space)=>!(user.denied||[]).includes(space),
    audit:async(...args)=>audits.push(args)
  };
  const api=createRadioGeo(ctx);
  const admin={role:'admin'},viewer={role:'viewer'};
  const handle=(method,route,body,user=admin,res={})=>api.handle({method,body},res,new URL('http://internal'+route),user);
  try{
    assert.equal(api.match({},new URL('http://test/api/radio/map')),true);
    assert.deepEqual((await handle('GET','/api/radio/locations?apId=ap')).items,[]);
    await assert.rejects(handle('PUT','/api/radio/location',{hostId:'ap',latitude:35,longitude:51},viewer),{status:403});
    await assert.rejects(handle('PUT','/api/radio/location',{hostId:'ap',latitude:91,longitude:51}),{status:400});
    await assert.rejects(handle('PUT','/api/radio/location',{hostId:'ap',latitude:'',longitude:51}),{status:400});
    await assert.rejects(handle('PUT','/api/radio/location',{hostId:'ap',latitude:30,longitude:51},{role:'admin',denied:['a']}),{status:404});
    const result=await handle('PUT','/api/radio/location',{hostId:'ap',latitude:35.68921712,longitude:51.38905098});
    assert.equal(result.item.latitude,35.689217);assert.equal(result.item.longitude,51.389051);
    const second=await handle('PUT','/api/radio/location',{hostId:'st',latitude:0,longitude:0});
    assert.equal(second.item.latitude,0);assert.equal(second.item.longitude,0);
    const locations=await handle('GET','/api/radio/locations?apId=ap',undefined,viewer);
    assert.equal(locations.items.length,2);
    assert.ok(locations.items.some(x=>x.hostId==='ap'&&x.latitude===35.689217));
    await assert.rejects(handle('GET','/api/radio/locations?apId=ap',undefined,{role:'viewer',denied:['a']}),{status:404});
    const stored=JSON.parse(await fs.readFile(path.join(dir,'radio-documentation','locations.json'),'utf8'));
    assert.equal(stored.items.length,2);
    assert.equal(JSON.stringify(stored).includes('password'),false);
    const response={writeHead(code,headers){this.code=code;this.headers=headers;},end(html){this.html=html.toString('utf8');}};
    await handle('GET','/api/radio/map',undefined,viewer,response);
    assert.equal(response.code,200);
    assert.match(response.headers['Content-Security-Policy'],/img-src 'self' data: https:\/\/tile.openstreetmap.org/);
    assert.match(response.headers['Content-Security-Policy'],/frame-ancestors 'self'/);
    assert.doesNotMatch(response.headers['Content-Security-Policy'],/unsafe-eval/);
    assert.match(response.html,/OpenStreetMap contributors/);
    assert.match(response.html,/map-frame.mjs/);
    await assert.rejects(handle('GET','/api/radio/map',undefined,{blocked:true}),{status:403});
    await handle('PUT','/api/radio/location',{hostId:'ap',latitude:null,longitude:null});
    assert.equal((await handle('GET','/api/radio/locations?apId=ap')).items.some(x=>x.hostId==='ap'),false);
    assert.equal(audits.length,3);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
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
