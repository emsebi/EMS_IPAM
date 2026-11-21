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
 const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 const tileReferers=[];
 // Exercise real browser headers, without contacting or exhausting the community tile host.
 await page.route('https://tile.openstreetmap.org/**',route=>{
   tileReferers.push(route.request().headers()['referer']||'');
   return route.fulfill({status:200,contentType:'image/png',
     body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64')});
 });
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
 await page.waitForFunction(() => document.getElementById('lpMap')?.contentDocument?.getElementById('tiles')?.childElementCount>0);
 await page.waitForTimeout(100);
 assert.ok(tileReferers.length>0,'Expected OSM tiles to be requested');
 assert.ok(tileReferers.every(ref=>ref.startsWith(base+'/')),
   'OSM tile requests must include a real same-origin Referer: '+JSON.stringify(tileReferers));
 await page.locator('input[data-path="a.latitude"]').fill('35.600000');
 await page.locator('input[data-path="a.longitude"]').fill('51.300000');
 await page.locator('input[data-path="b.latitude"]').fill('35.650000');
 await page.locator('input[data-path="b.longitude"]').fill('51.350000');
 await page.waitForFunction(()=>document.querySelector('#lpResults')?.innerText.includes('FSPL'));
 assert.ok((await page.locator('#lpResults').innerText()).includes('FSPL'));
 assert.ok((await page.locator('#lpResults').innerText()).includes('EIRP'));
 // Center-click on a known eastern longitude must remain east, never jump 180° west.
 await page.getByRole('button',{name:/Go to site A|برو به سایت A/}).click();
 await page.locator('.lp-pick[data-site="a"]').click();
 const aMap=page.frameLocator('#lpMap').locator('#map');
 const mapSize=await aMap.boundingBox();
 await aMap.click({position:{x:Math.floor(mapSize.width/2)+35,y:Math.floor(mapSize.height/2)+35}});
 const longitude=Number(await page.locator('input[data-path="a.longitude"]').inputValue());
 assert.ok(Math.abs(longitude-51.3)<.005,'Map center click must preserve eastern longitude, got '+longitude);
 await page.locator('input[data-path="a.latitude"]').fill('35.600000');
 await page.locator('input[data-path="a.longitude"]').fill('51.300000');
 // Same-origin map click updates the *selected* site, no external geolocation permission.
 await page.locator('.lp-pick[data-site="b"]').click();
 const before=await page.locator('input[data-path="b.longitude"]').inputValue();
 const mapFrame=page.frameLocator('#lpMap');
 const tileState=()=>mapFrame.locator('#tiles img').evaluateAll(items=>items.map(img=>[img.src,img.style.left,img.style.top]));
 const tilesBeforePick=await tileState();
 await mapFrame.locator('#map').click({position:{x:200,y:210}});
 await page.waitForFunction(previous=>document.querySelector('input[data-path="b.longitude"]')?.value!==previous,before);
 await page.waitForTimeout(80);
 assert.deepEqual(await tileState(),tilesBeforePick,'A map click must not move map tiles or change zoom.');
 // Wheel zoom is available while preserving the clicked map position.
 await mapFrame.locator('#map').hover({position:{x:230,y:220}});
 await page.mouse.wheel(0,-170);
 await page.waitForTimeout(100);
 assert.notDeepEqual(await tileState(),tilesBeforePick,'Wheel must zoom at the cursor.');

 await page.locator('input[data-path="b.latitude"]').fill('35.650000');
 await page.locator('input[data-path="b.longitude"]').fill('51.350000');
 await page.getByRole('button',{name:/Go to site B|برو به سایت B/}).click();
 const bPin=mapFrame.locator('.planner-pin.b');
 await bPin.waitFor({state:'visible'});
 await page.waitForFunction(()=>{
  const frame=document.getElementById('lpMap');
  const map=frame?.contentDocument?.getElementById('map');
  const pin=frame?.contentDocument?.querySelector('.planner-pin.b');
  if(!map||!pin)return false;
  const p=pin.getBoundingClientRect(),m=map.getBoundingClientRect();
  return p.left+p.width/2>=m.left-20&&p.left+p.width/2<=m.right+20&&p.top+p.height/2>=m.top-20&&p.top+p.height/2<=m.bottom+20;
 },null,{timeout:6000});
 const pinPosition=await bPin.evaluate(pin=>{
   const box=pin.getBoundingClientRect(),map=document.getElementById('map').getBoundingClientRect();
   return {x:box.left+box.width/2-map.left,y:box.top+box.height/2-map.top,width:map.width,height:map.height};
 });
 assert.ok(pinPosition.x>=-20&&pinPosition.x<=pinPosition.width+20,'Focus B should bring B into visible map.');

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
 await page.locator('.lp-terrain-profile-header h4').waitFor({state:'visible'});
 assert.ok((await page.locator('.lp-terrain-metrics').innerText()).includes('Terrain relief'));
 const profileMetrics=await page.locator('.lp-terrain-metrics').innerText();
 assert.ok(profileMetrics.includes('100.0'),'Flat SRTM fixture should show ground elevation 100 m');
 await page.locator('.lp-chart svg').hover({position:{x:200,y:110}});
 assert.ok((await page.locator('.lp-terrain-probe').innerText()).includes('Ground 100.0 m'));


 // The engineer can fix a 20 m A tower and solve the minimum B tower.
 await page.locator('input[data-path="siteA.tower"]').fill('20');
 await page.locator('input[data-path="siteB.tower"]').fill('0');
 await page.locator('.lp-height-solver').waitFor({state:'visible'});
 assert.ok((await page.locator('.lp-height-solver').innerText()).includes('Required B tower'));
 await page.getByRole('button',{name:/Set B to minimum|ثبت ارتفاع حداقل B/}).click();
 const solvedB=Number(await page.locator('input[data-path="siteB.tower"]').inputValue());
 assert.ok(Number.isFinite(solvedB)&&solvedB>=0);
 // Change both ends to two specified MikroTik 802.11ac products and inspect the reference PHY result.
 await page.locator('#lpBrandA').selectOption('MikroTik');
 await page.locator('#lpBrandB').selectOption('MikroTik');
 await page.locator('#lpModelA').selectOption('mt-lhg5ac');
 await page.locator('#lpModelB').selectOption('mt-lhgxl5ac');
 await page.locator('#lpProtocol').selectOption('802.11ac');
 await page.locator('input[data-path="channelWidthMHz"]').fill('80');
 assert.equal(await page.locator('input[data-path="gainA"]').inputValue(),'24.5');
 assert.equal(await page.locator('input[data-path="gainB"]').inputValue(),'27');
 assert.ok((await page.locator('.lp-capacity-reference').innerText()).includes('866.6'));
 assert.ok((await page.locator('.lp-capacity-reference').innerText()).includes('Actual throughput'));

 const savedALatitude=Number(await page.locator('input[data-path="a.latitude"]').inputValue());
 await page.locator('#lpScenarioName').fill('Fixture hill path');
 const save=page.locator('.lp-card').last().getByRole('button',{name:/Save|ذخیره/}).first();
 await save.click();
 await page.waitForFunction(()=>document.querySelectorAll('#lpScenarioSelect option').length>1);
 const options=await page.locator('#lpScenarioSelect option').allTextContents();
 assert.ok(options.some(x=>x.includes('Fixture hill path')));
 const select=page.locator('#lpScenarioSelect');
 await select.selectOption({label:'Fixture hill path'});
 await page.locator('.lp-card').last().getByRole('button',{name:/Load|بازکردن/}).click();
 await page.locator('input[data-path="a.latitude"]').waitFor({state:'visible'});
 assert.ok(Math.abs(Number(await page.locator('input[data-path="a.latitude"]').inputValue())-savedALatitude)<1e-6,'Saved site A latitude must survive round-trip');
 const state=await context.request.get('/api/link-planner/scenarios',{headers:{'X-EMS-CSRF':'1'}});
 assert.equal(state.status(),200);
 const result=await state.json();assert.equal(result.items.length,1);
 await page.setViewportSize({width:390,height:940});
 await page.waitForTimeout(400);
 const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth,view:innerWidth}));
 assert.ok(overflow.document<=overflow.view+2,'Planner mobile overflow: '+JSON.stringify(overflow));
 // Light palette must remain unchanged; dark Link Planner cards and inputs must not stay white.
 const themeColors=async()=>page.evaluate(()=>{
   const card=document.querySelector('.lp-side .lp-card');
   const site=document.querySelector('.lp-site');
   const field=document.querySelector('.lp-site input');
   const color=el=>getComputedStyle(el).backgroundColor;
   return {card:color(card),site:color(site),field:color(field)};
 });
 const lightColors=await themeColors();
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 const darkColors=await themeColors();
 assert.equal(darkColors.card,'rgb(24, 35, 56)');
 assert.equal(darkColors.site,'rgb(16, 24, 39)');
 assert.equal(darkColors.field,'rgb(24, 35, 56)');
 assert.notDeepEqual(darkColors,lightColors);
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
 assert.deepEqual(await themeColors(),lightColors,'Theme round-trip must preserve light colors');
 assert.deepEqual(errors,[]);
 console.log('PASS Link Planner visible; A/B map picker, FSPL, terrain chart, scenario PostgreSQL save/reload, mobile width');
}finally{
 if(browser)await browser.close();
 runner.kill('SIGTERM');
}
