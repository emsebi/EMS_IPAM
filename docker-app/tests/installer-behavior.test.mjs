import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const installer = path.join(root, 'install.sh');
const shell = (script, args=[]) => {
  const r=spawnSync('bash',['-c',script,'ems-test',...args],{encoding:'utf8',cwd:root});
  assert.ifError(r.error); assert.equal(r.status,0,`${r.stdout}\n${r.stderr}`); return r.stdout;
};

test('installer file and stdin entry both support help without installing', () => {
  for(const args of [[installer,'--help'],['-s','--','--help']]){
    const r=spawnSync('bash',args,{encoding:'utf8',input:args[0]==='-s'?fs.readFileSync(installer,'utf8'):undefined});
    assert.ifError(r.error); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/Docker prerequisites/);
  }
});
test('installer can be sourced for diagnostics without opening the menu',()=>{
  assert.equal(shell('source "$1"; printf "loaded"',[installer]),'loaded');
});
test('prerequisites call bundled official installer without optional Portainer',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ems-prereq-'));
  try{
    fs.writeFileSync(path.join(tmp,'install-prerequisites.sh'),'printf "%s" "$1" > "$EMS_TEST_MARKER"\n');
    shell(`source "$1"
SCRIPT_DIR="$2"
export EMS_TEST_MARKER="$2/called"
id(){ printf '0'; }
have(){ [[ "$1" != docker && "$1" != systemctl ]]; }
docker(){ return 0; }
install_prerequisites`,[installer,tmp]);
    assert.equal(fs.readFileSync(path.join(tmp,'called'),'utf8'),'--without-portainer');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('download validates an archive, selects project root and rejects an invalid archive',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ems-source-'));
  try{
    const tree=path.join(tmp,'project-main');
    for(const file of ['compose.yml','docker-app/Dockerfile','docker-app/package.json','docker-app/server/main.mjs','docker-app/server/schema.sql']){
      const dest=path.join(tree,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,file);
    }
    const archive=path.join(tmp,'source.tar.gz');
    assert.equal(spawnSync('tar',['-czf',archive,'-C',tmp,'project-main']).status,0);
    const out=shell(`source "$1"
SCRIPT_DIR=""
FIXTURE="$2"
curl(){ cp "$FIXTURE" "$TMP_ROOT/source.tar.gz"; }
download_source
cat "$SOURCE_DIR/compose.yml"`,[installer,archive]);
    assert.match(out,/compose.yml/);
    fs.writeFileSync(archive,'not an archive');
    const bad=spawnSync('bash',['-c','source "$1"; SCRIPT_DIR=""; FIXTURE="$2"; curl(){ cp "$FIXTURE" "$TMP_ROOT/source.tar.gz"; }; download_source','ems-test',installer,archive],{encoding:'utf8'});
    assert.notEqual(bad.status,0);assert.match(bad.stderr,/archive is invalid/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
