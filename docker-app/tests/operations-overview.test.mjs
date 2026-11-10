import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { scopedInventory, radioGroups, distanceKm, recordedStatus, snapshotStatus, validTopology } from "../../modules/operations-overview/public/model.mjs";
import { createUi } from "../../modules/operations-overview/public/index.mjs";

const sample = [
  {id:"a",companyId:"north",radioMode:"ap",name:"North AP"},
  {id:"s1",companyId:"north",radioMode:"station",radioParentHostId:"a",pingOnline:true},
  {id:"s2",companyId:"south",radioMode:"station",radioParentHostId:"a",pingOnline:false},
  {id:"orphan",companyId:"north",radioMode:"station",radioParentHostId:"unknown"}
];

test("overview is a real registered read-only panel module", async () => {
  const manifest=JSON.parse(await fs.readFile(new URL("../../modules/operations-overview/module.json",import.meta.url),"utf8"));
  assert.equal(manifest.navigation.panel,true);
  assert.deepEqual(manifest.roles,["admin"]);
  assert.equal(typeof createUi,"function");
});

test("cross-branch radio relationships never leak into displayed station membership", () => {
  const groups=radioGroups(sample,"north");
  assert.equal(groups.aps.length,1);
  assert.deepEqual(groups.aps[0].stations.map(x=>x.id),["s1"]);
  assert.deepEqual(groups.orphanStations.map(x=>x.id),["orphan"]);
  assert.deepEqual(scopedInventory(sample,"south").map(x=>x.id),["s2"]);
});

test("unknown manual ping is not silently reported online", () => {
  assert.equal(recordedStatus({}),"unknown");
  assert.equal(recordedStatus({pingOnline:true}),"up");
  assert.equal(recordedStatus({pingOnline:false}),"down");
});

test("geographic distance requires genuine valid coordinates", () => {
  assert.equal(distanceKm({},{}),null);
  assert.equal(distanceKm({latitude:"",longitude:""},{latitude:0,longitude:0}),null);
  assert.equal(distanceKm({latitude:100,longitude:0},{latitude:0,longitude:0}),null);
  assert.equal(distanceKm({latitude:0,longitude:0},{latitude:0,longitude:0}),0);
  assert.ok(Math.abs(distanceKm({latitude:0,longitude:0},{latitude:0,longitude:1})-111.195)<0.05);
});

test("network map preview distinguishes stored status and bounds the input", () => {
  assert.equal(snapshotStatus({status:"online"}),"up");
  assert.equal(snapshotStatus({status:"online",reachability:"unreachable"}),"down");
  assert.equal(snapshotStatus({}),"unknown");
  const m=validTopology({nodes:Array.from({length:510},(_,i)=>({id:i})),links:Array.from({length:1600},(_,i)=>({id:i}))});
  assert.equal(m.nodes.length,500);assert.equal(m.links.length,1500);
  assert.deepEqual(validTopology({}),{nodes:[],links:[]});
});

test("dashboard sources do not use synthetic counts, credential reveal or scan on open",async()=>{
  const source=await fs.readFile(new URL("../../modules/operations-overview/public/index.mjs",import.meta.url),"utf8");
  assert.match(source,/request\("\/api\/inventory"\)/);
  assert.match(source,/\/api\/companies\//);
  assert.match(source,/\/api\/radius-ops\//);
  assert.match(source,/\/api\/network-map\/state/);
  assert.doesNotMatch(source,/\/reveal-password|\/live\/start|\/scan["']/);
});
