import fs from 'node:fs';
import {chromium} from 'playwright';

const baseURL=process.env.EMS_RADIUS_BASE_URL;
const cookieFile=process.env.EMS_RADIUS_COOKIE_FILE;
if(!baseURL || !cookieFile) throw new Error('Missing real-backend browser inputs');
const cookies=JSON.parse(fs.readFileSync(cookieFile,'utf8'));
let browser;
let stage='connect';
try{
 browser=process.env.EMS_RADIUS_BROWSER_CDP_URL
  ? await chromium.connectOverCDP(process.env.EMS_RADIUS_BROWSER_CDP_URL)
  : await chromium.launch({headless:true});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  stage='new-context';
  const context=await browser.newContext({viewport});
  await context.addCookies(cookies);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  stage='navigate';
  // The EMS panel is a hash-routed SPA. A pathname such as /module/radius
  // serves the shell but leaves the app on its default company page.
  await page.goto(baseURL+'/#/module/radius',{waitUntil:'domcontentloaded'});
  stage='wait-for-radius-ui';
  await page.locator('.r-tabs button[data-tab="clients"]').waitFor({timeout:15000});
  stage='verify-live-data';
  const text=await page.locator('main').innerText();
  if(!text.includes('Lab NAS A') || !text.includes('Lab NAS B Range'))
   throw new Error('Live RADIUS data did not render');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+5);
  if(overflow) throw new Error('RADIUS page has horizontal overflow');
  if(errors.length) throw new Error('Uncaught browser error');
  await context.close();
 }
}catch(error){
 const type=String(error?.name||'Error').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,80);
 console.error(`BROWSER_CHECK_FAILED stage=${stage} type=${type}`);
 process.exitCode=1;
}finally{
 if(browser) await browser.close();
}
