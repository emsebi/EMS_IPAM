from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1] / 'public'
html=(root/'index.html').read_text().replace('<script type="module" src="/m/radius-ops/app.mjs"></script>','')
css=(root/'style.css').read_text()
js=(root/'app.mjs').read_text()
mock='''
Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem(k){return this[k]||null},setItem(k,v){this[k]=v}}});
window.fetch=async function(url,opts={}) {
 const kind=url.split('/').pop();let d;
 if(kind==='overview')d={ok:true,devices:{total:1,active:1},accounts:{total:1,active:1},macs:{total:0,active:0},events:{total:2,accepted:1}};
 else if(kind==='health')d={ok:true,running:false,eap:false};
 else if(kind==='inventory' && window.failInventory)return {ok:false,status:500,json:async()=>({ok:false,error:'Inventory endpoint unavailable'})};
 else if(kind==='inventory')d={ok:true,items:[{id:'switch1',companyId:'company1',companyName:'Lab HQ',name:'Core Switch',ip:'10.20.0.5'}]};
 else if(kind==='devices')d={ok:true,items:[{id:'e8888888-8888-4888-8888-888888888888',hostId:'switch1',companyId:'company1',nasIp:'10.20.0.5',label:'SW-CORE-01',vendor:'cisco-legacy',enabled:true,hostName:'Core Switch',companyName:'Lab HQ'}]};
 else if(kind==='accounts')d={ok:true,items:[{id:'a8888888-8888-4888-8888-888888888888',companyId:'company1',username:'netadmin',label:'Network admin',vendor:'cisco',privilege:15,mikrotikGroup:'read',enabled:true,companyName:'Lab HQ'}]};
 else if(kind==='macs')d={ok:true,items:[]};
 else if(kind==='events')d={ok:true,items:[{id:1,username:'netadmin',reply:'Access-Accept',at:'2026-10-14T00:00:00Z',sourceIp:'10.20.0.5',deviceLabel:'SW-CORE-01',companyName:'Lab HQ'}],sessions:[]};
 else if(kind==='config')d={ok:true,text:'aaa new-model\\nradius-server host 10.20.0.1 auth-port 1812 acct-port 1813 key EXAMPLE_SECRET'};
 else if(kind==='precheck')d={ok:true,allowed:opts.body.includes('netadmin'),reason:opts.body.includes('netadmin')?'ready':'identity-not-provisioned',scope:'sql-policy-only',udpTested:false};
 else d={ok:true,id:'new'};
 return {ok:true,status:200,json:async()=>d};
};
'''
errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for w,h,label in [(1440,900,'desktop'),(390,844,'mobile')]:
  pg=b.new_page(viewport={'width':w,'height':h})
  pg.on('pageerror',lambda e:errors.append(str(e)))
  pg.set_content(html)
  pg.add_style_tag(content=css)
  pg.evaluate('(()=>{'+mock+'})()')
  pg.evaluate('window.failInventory='+('true' if label=='mobile' else 'false'))
  pg.evaluate('(()=>{'+js+'})()')
  pg.wait_for_selector('.card strong')
  if label=='mobile':
   pg.wait_for_selector('#notice:not(.hidden)')
   assert 'inventory' in pg.locator('#notice').inner_text()
   pg.locator('nav button[data-tab="devices"]').click()
   assert 'SW-CORE-01' in pg.locator('#body').inner_text()
   pg.locator('nav button[data-tab="overview"]').click()
  print(label,'title',pg.locator('#title').inner_text(),'offline',pg.locator('#radiusIndicator').get_attribute('class'))
  pg.screenshot(path=str(Path(__file__).resolve().parents[1] / 'docs' / 'screenshots' / f'dashboard-mock-{label}.png'),full_page=True)
  pg.locator('#precheckForm input[name="identity"]').fill('netadmin')
  pg.locator('#precheckForm input[name="nasIp"]').fill('10.20.0.5')
  pg.locator('#precheckForm button[type="submit"]').click()
  pg.wait_for_function("document.querySelector('#precheckResult').textContent.includes('Policy permits')")
  assert 'Access-Accept' in pg.locator('#precheckResult').inner_text()
  pg.locator('#precheckForm input[name="identity"]').fill('unknown')
  pg.locator('#precheckForm button[type="submit"]').click()
  pg.wait_for_function("document.querySelector('#precheckResult').textContent.includes('Policy does not permit')")

  if label=='desktop':
   pg.locator('nav button[data-tab="devices"]').click()
   pg.locator('[data-search]').fill('no-such-switch')
   assert 'No records yet' in pg.locator('#body').inner_text()
   pg.locator('[data-search]').fill('SW-CORE-01')
   assert 'SW-CORE-01' in pg.locator('#body').inner_text()
   pg.locator('[data-action="config"]').click()
   pg.locator('#radiusIp').fill('10.20.0.1')
   pg.locator('#generate').click()
   pg.wait_for_function("document.querySelector('#commands').textContent.includes('aaa new-model')")
   pg.locator('#config .close').click()
   pg.locator('nav button[data-tab="events"]').click()
   assert 'SW-CORE-01' in pg.locator('table').first.inner_text()
   pg.locator('#language').click()
   assert pg.locator('#title').inner_text()=='گزارش احراز هویت'
   pg.locator('nav button[data-tab="accounts"]').click()
   pg.locator('#add').click()
   assert pg.locator('#editor').evaluate('(x)=>x.open')
   pg.locator('#editor .close').click()
  print(label,'scrollWidth',pg.evaluate('document.body.scrollWidth'))
  assert pg.evaluate('document.body.scrollWidth') <= w+5
  pg.close()
 b.close()
print('JS ERRORS:',errors)
assert not errors,errors
