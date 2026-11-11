import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {distanceMeters,formatDistance,fitGeoPoints,geoProject,validGeoPoint} from '../../modules/radio/public/geo-math.mjs';

test('straight-line AP to Station distance uses WGS84 spherical approximation without radios',()=>{
  const ap={latitude:0,longitude:0},oneDegree={latitude:0,longitude:1};
  assert.ok(Math.abs(distanceMeters(ap,oneDegree)-111195)<2);
  assert.equal(formatDistance(distanceMeters(ap,ap)),'0 m');
  assert.equal(formatDistance(1250),'1.25 km');
  assert.equal(formatDistance(748),'748 m');
  assert.ok(Math.abs(distanceMeters({latitude:0,longitude:179.9},{latitude:0,longitude:-179.9})-22239)<10);
  assert.equal(distanceMeters({latitude:null,longitude:50},oneDegree),null);
  assert.equal(distanceMeters({latitude:91,longitude:50},oneDegree),null);
  assert.equal(validGeoPoint({latitude:0,longitude:0}),true);
  assert.equal(validGeoPoint({latitude:'',longitude:0}),false);
});

test('initial map fit places AP and all documented station coordinates in viewport',()=>{
  const markers=[
    {latitude:35.6892,longitude:51.3890},
    {latitude:35.6901,longitude:51.3902},
    {latitude:35.8,longitude:51.6},
  ];
  const bounds=fitGeoPoints(markers,960,360);
  assert.ok(bounds.zoom>=2&&bounds.zoom<=18);
  const center=geoProject(bounds.latitude,bounds.longitude,bounds.zoom);
  for(const marker of markers){
    const px=geoProject(marker.latitude,marker.longitude,bounds.zoom);
    assert.ok(Math.abs(px.x-center.x)<=960/2-60,'marker fits horizontal bounds');
    assert.ok(Math.abs(px.y-center.y)<=360/2-60,'marker fits vertical bounds');
  }
  const single=fitGeoPoints([markers[0]],960,360);
  assert.equal(single.zoom,14);
  assert.equal(fitGeoPoints([],960,360),null);
  const dateline=fitGeoPoints([{latitude:0,longitude:179.9},{latitude:0,longitude:-179.9}],960,360);
  assert.ok(Math.abs(Math.abs(dateline.longitude)-180)<.2);
  assert.ok(dateline.zoom>2,'dateline stations are near each other, not across the globe');
});

test('Radio map overlay distinguishes AP/Station colors and labels distances without new monitoring',async()=>{
  const [js,html,geo,ui]=await Promise.all([
    fs.readFile(new URL('../../modules/radio/public/map-frame.mjs',import.meta.url),'utf8'),
    fs.readFile(new URL('../../modules/radio/public/map-frame.html',import.meta.url),'utf8'),
    fs.readFile(new URL('../../modules/radio/public/geo-ui.mjs',import.meta.url),'utf8'),
    fs.readFile(new URL('../../modules/radio/public/index.mjs',import.meta.url),'utf8'),
  ]);
  assert.match(js,/radio-link-distance/);
  assert.match(js,/distanceMeters\(ap,station\)/);
  assert.match(js,/fitGeoPoints\(markers/);
  assert.match(js,/marker.role==='ap'/);
  assert.match(html,/id="radioLinks"/);
  assert.match(html,/id="fitRadio"/);
  assert.match(html,/radio-pin\.ap/);
  assert.match(html,/radio-pin\.station/);
  assert.match(geo,/radioGeoDistances/);
  assert.match(geo,/distanceMeters\(source,destination\)/);
  assert.match(ui,/geo\.attach/);
  assert.doesNotMatch(js,/ssh|snmp|monitor|password/i);
});
