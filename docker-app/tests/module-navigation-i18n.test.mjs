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
  for(const path of ["../../modules/radius/module.json","../../modules/reports/module.json"]){
    const manifest=JSON.parse(await read(path));
    assert.equal(manifest.navigation.panel,true);
    assert.ok(manifest.navigation.labels.en);
    assert.ok(manifest.navigation.labels.fa);
  }
});

test("optional modules keep English-first catalogs and UI sources free of embedded Persian",async()=>{
  for(const moduleId of ["radius","reports"]){
    const root="../../modules/"+moduleId+"/public/";
    const [source,en,fa]=await Promise.all([
      read(root+"index.mjs"),
      read(root+"i18n/en.json").then(JSON.parse),
      read(root+"i18n/fa.json").then(JSON.parse),
    ]);
    assert.doesNotMatch(source,/[\u0600-\u06FF]/,moduleId+" UI must use translation keys");
    assert.deepEqual(Object.keys(fa).sort(),Object.keys(en).sort(),moduleId+" catalog key parity");
    for(const [key,value] of Object.entries(en)){
      assert.equal(typeof value,"string",moduleId+": "+key);
      assert.ok(value.trim(),moduleId+": missing English base for "+key);
      assert.ok(fa[key]?.trim(),moduleId+": missing Persian translation for "+key);
    }
  }
});
