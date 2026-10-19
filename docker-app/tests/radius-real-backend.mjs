import fs from 'node:fs';
import {chromium} from 'playwright';

const baseURL=process.env.EMS_RADIUS_BASE_URL;
const cookieFile=process.env.EMS_RADIUS_COOKIE_FILE;
if(!baseURL || !cookieFile) throw new Error('Missing real-backend browser inputs');
const cookies=JSON.parse(fs.readFileSync(cookieFile,'utf8'));
const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport});
  await context.addCookies(cookies);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseURL+'/module/radius',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Clients / NAS'}).waitFor({timeout:15000});
  const text=await page.locator('main').innerText();
  if(!text.includes('Lab NAS A') || !text.includes('Lab NAS B Range'))
   throw new Error('Live RADIUS data did not render');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+5);
  if(overflow) throw new Error('RADIUS page has horizontal overflow');
  if(errors.length) throw new Error('Uncaught browser error');
  await context.close();
 }
}finally{
 await browser.close();
}
