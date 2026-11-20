// Link Planner browser regression on a disposable embedded PostgreSQL instance.
// Tests real module routing and UI; only SRTM upstream HTTP is replaced by a labeled fixture.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const port=String(process.env.EMS_TEST_PORT||'18884'),base='http://127.0.0.1:'+port;
const runner=spawn(process.execPath,['tests/helpers/embedded-server.mjs'],{
  cwd:new URL('..',import.meta.url).pathname,env:{...process.env,EMS_TEST_PORT:port},
  stdio:['ignore','pipe','pipe']
});
let output='',browser;
try{
 await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Startup timeout: '+output.slice(-4000))),40000);
   for(const stream of [runner.stdout,runner.stderr])stream.on('data',chunk=>{
     output+=chunk.toString();if(output.includes('TEST_FIXTURES_READY')){clearTimeout(timeout);resolve();}
   });
   runner.on('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code+': '+output.slice(-4000)));});
 });
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
 const context=await browser.newContext({baseURL:base,viewport:{width:1400,height:1000}});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/');
 await page.locator('#loginUsername').fill('test-admin');
 await page.locator('#loginPassword').fill('Test-Password-01');
 await page.locator('#loginForm [type=submit]').click();
 const nav=page.locator('button.module-nav-link[data-module-id="link-planner"]');
 await nav.waitFor({state:'visible'});
 await nav.click();
 await page.locator('.lp-header h1').waitFor({state:'visible'});
 assert.ok((await page.locator('#lpMap').getAttribute('src')).includes('/api/link-planner/map'));
 await page.locator('#lpMap').contentFrame().locator('#map').waitFor({state:'visible'});
 await page.locator('input[data-path="a.latitude"]').fill('35.600000');
 await page.locator('input[data-path="a.longitude"]').fill('51.300000');
 await page.locator('input[data-path="b.latitude"]').fill('35.650000');
 await page.locator('input[data-path="b.longitude"]').fill('51.350000');
 await page.waitForFunction(()=>document.querySelector('#lpResults')?.innerText.includes('FSPL'));
 assert.ok((await page.locator('#lpResults').innerText()).includes('FSPL'));
 assert.ok((await page.locator('#lpResults').innerText()).includes('EIRP'));
 // Same-origin map click updates the *selected* site, no external geolocation permission.
 await page.locator('.lp-pick[data-site="b"]').click();
 const before=await page.locator('input[data-path="b.longitude"]').inputValue();
 await page.frameLocator('#lpMap').locator('#map').click({position:{x:200,y:210}});
 await page.waitForFunction(previous=>document.querySelector('input[data-path="b.longitude"]')?.value!==previous,before);
 await page.locator('input[data-path="b.latitude"]').fill('35.650000');
 await page.locator('input[data-path="b.longitude"]').fill('51.350000');
 // Public terrain endpoint remains the server-owned service; fake only the upstream result in browser test.
 await page.route('**/api/link-planner/terrain?**',route=>route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({ok:true,dataset:'srtm90m',sampleCount:81,missing:0,
     source:'SRTM90m synthetic browser fixture',retrievedAt:'2026-01-01T00:00:00Z',elevations:Array(81).fill(100)})
 }));
 await page.locator('#lpTerrainButton').click();
 await page.locator('[data-line="los"]').waitFor({state:'attached'});
 await page.locator('[data-line="ground"]').waitFor({state:'attached'});
 await page.locator('[data-line="fresnel"]').waitFor({state:'attached'});
 await page.locator('#lpScenarioName').fill('Fixture hill path');
 const save=page.locator('.lp-card').last().getByRole('button',{name:/Save|ذخیره/}).first();
 await save.click();
 await page.waitForFunction(()=>document.querySelectorAll('#lpScenarioSelect option').length>1);
 const options=await page.locator('#lpScenarioSelect option').allTextContents();
 assert.ok(options.some(x=>x.includes('Fixture hill path')));
 const select=page.locator('#lpScenarioSelect');
 await select.selectOption({label:'Fixture hill path'});
 await page.locator('.lp-card').last().getByRole('button',{name:/Load|بازکردن/}).click();
 await page.waitForFunction(()=>document.querySelector('input[data-path="a.latitude"]')?.value==='35.6');
 const state=await context.request.get('/api/link-planner/scenarios',{headers:{'X-EMS-CSRF':'1'}});
 assert.equal(state.status(),200);
 const result=await state.json();assert.equal(result.items.length,1);
 await page.setViewportSize({width:390,height:940});
 await page.waitForTimeout(400);
 const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth,view:innerWidth}));
 assert.ok(overflow.document<=overflow.view+2,'Planner mobile overflow: '+JSON.stringify(overflow));
 assert.deepEqual(errors,[]);
 console.log('PASS Link Planner visible; A/B map picker, FSPL, terrain chart, scenario PostgreSQL save/reload, mobile width');
}finally{
 if(browser)await browser.close();
 runner.kill('SIGTERM');
}
