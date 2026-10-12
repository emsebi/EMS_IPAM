import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read=(path)=>fs.readFile(new URL(path,import.meta.url),"utf8");

test("module navigation supports manifest-owned localized labels with English fallback",async()=>{
  const app=await read("../public/app.js");
  assert.match(app,/item\.navigation\?\.labels/);
  assert.match(app,/labels\[state\.language\] \|\| labels\.en \|\| item\.navigation\?\.label/);
});

test("bundled panel modules own their navigation translations",async()=>{
  for(const path of ["../../modules/radius/module.json","../../modules/branches/module.json"]){
    const manifest=JSON.parse(await read(path));
    assert.equal(manifest.navigation.panel,true);
    assert.ok(manifest.navigation.labels.en);
    assert.ok(manifest.navigation.labels.fa);
  }
});
