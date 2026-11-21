import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const paths=[
 ['radio',['.radio-doc-node','.radio-map-aside','.radio-map-ap-group','.radio-doc-controls input']],
 ['network-map',['.nm-app','.nm-stats article','.nm-app .panel']],
 ['reports',['.reports-metrics .report-metric']]
];
for(const [moduleName,selectors] of paths){
 test('Dark Mode restores '+moduleName+' module cards without changing Light Mode',async()=>{
  const css=await readFile(new URL('../../modules/'+moduleName+'/public/style.css',import.meta.url),'utf8');
  assert.ok(css.includes('html[data-theme="dark"]'),'Missing dark theme scope');
  for(const selector of selectors)assert.ok(css.includes(selector),'Missing '+selector);
  const appended=css.slice(css.lastIndexOf('/* Restore the established dark palette.'),css.length);
  if(moduleName==='radio')assert.ok(appended.includes('background:#182338'));
  if(moduleName==='reports')assert.match(css,/html\[data-theme="dark"\] \.reports-metrics \.report-metric\{[\s\S]*?background:#182338/);
  assert.ok(!css.includes('html[data-theme="light"] .reports-metrics .report-metric{background:#182338'),'Dark colors must not leak into light theme');
 });
}
