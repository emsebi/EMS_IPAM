import {normalizeInput,radioBudget,assessTerrain,profileBounds} from './model.mjs';

const INITIAL=()=>({
 a:{latitude:'',longitude:''},b:{latitude:'',longitude:''},
 siteA:{building:0,tower:12,mount:0},siteB:{building:0,tower:12,mount:0},
 frequencyGHz:5.8,txDbm:20,gainA:27,gainB:27,lossA:1,lossB:1,otherLoss:0,
 sensitivityDbm:-80,kFactor:4/3,fresnelClearance:0.6,deviceA:'',deviceB:''
});
const DEM_NOTE='SRTM90m · approx. 90 m DEM, not a survey; no trees/buildings captured';
export function createUi(ctx){
 const {state,page,request,toast}=ctx;
 const L=(english,persian)=>state.language==='fa'?persian:english;
 let input=INITIAL(),active='a',profile=null,profileKey='',scenarioName='',scenarios=[],busy=false,notice='',profileError='';
 const ID='link-planner';
 const current=()=>state.view==='module'&&state.currentModuleId===ID;
 const doc=()=>document;
 const txt=value=>String(value??'');
 const E=(tag,attrs={},...children)=>{
  const n=['svg','path','line','text','rect','g','circle','polyline'].includes(tag)
    ?doc().createElementNS('http://www.w3.org/2000/svg',tag):doc().createElement(tag);
  for(const [key,value] of Object.entries(attrs)){
   if(value===undefined||value===null)continue;
   if(key==='text')n.textContent=txt(value);
   else if(key==='class')n.className=txt(value);
   else if(key==='value')n.value=txt(value);
   else if(key==='checked')n.checked=Boolean(value);
   else if(key==='onClick')n.addEventListener('click',value);
   else if(key==='onChange')n.addEventListener('change',value);
   else if(key==='onInput')n.addEventListener('input',value);
   else n.setAttribute(key,txt(value));
  }
  for(const child of children.flat())if(child!==null&&child!==undefined)n.append(child instanceof Node?child:doc().createTextNode(txt(child)));
  return n;
 };
 const button=(label,action,cls='')=>E('button',{type:'button',class:'btn '+cls,text:label,onClick:action});
 const text=(value,cls='')=>E('p',{class:cls,text:value});
 const row=(...children)=>E('div',{class:'lp-row'},...children);
 const card=(heading,...content)=>E('section',{class:'lp-card'},E('h3',{text:heading}),...content);
 const get=path=>path.split('.').reduce((v,k)=>v?.[k],input);
 const set=(path,value)=>{const keys=path.split('.');if(keys.length===2)input[keys[0]][keys[1]]=value;else input[path]=value;sync();};
 const coordKey=plan=>[plan.a.latitude,plan.a.longitude,plan.b.latitude,plan.b.longitude].map(v=>Number(v).toFixed(6)).join(',');
 const validPlan=()=>{try{return {value:normalizeInput(input),error:''};}catch(e){return {value:null,error:e.message};}};
 const number=(n,digits=1)=>Number.isFinite(n)?Number(n).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—';
 const metric=(label,value,small='')=>E('div',{class:'lp-metric'},E('small',{text:label}),E('strong',{text:value}),E('span',{text:small}));
 const siteRow=(label,path,min,max,step='1')=>E('label',{class:'lp-field'},E('span',{text:label}),E('input',{
   type:'number',step,min,max,'data-path':path,value:get(path),
   onInput:event=>set(path,event.target.value)
 }));
 const stringRow=(label,path,placeholder='')=>E('label',{class:'lp-field'},E('span',{text:label}),E('input',{
   type:'text',maxlength:90,placeholder,value:get(path),onInput:event=>set(path,event.target.value)
 }));
 function activeButton(which){
   active=which;
   for(const b of page.querySelectorAll('.lp-pick'))b.classList.toggle('selected',b.dataset.site===which);
   sendMap();
 }
 function sendMap(fit=false){
   const frame=doc().getElementById('lpMap');
   if(!frame)return;
   const a=input.a,b=input.b;
   const valid=p=>p&&p.latitude!==''&&p.longitude!==''&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180;
   frame.contentWindow?.postMessage({type:'ems:planner:data',
     a:valid(a)?{latitude:Number(a.latitude),longitude:Number(a.longitude)}:null,
     b:valid(b)?{latitude:Number(b.latitude),longitude:Number(b.longitude)}:null,active,fit},location.origin);
 }
 function chart(analysis){
   const box=E('div',{class:'lp-chart'});
   if(!analysis||!Array.isArray(analysis.samples)){
     box.append(text(L('Terrain profile unavailable. Load valid SRTM elevation data to assess clearance.','پروفایل زمین در دسترس نیست. ابتدا ارتفاعات معتبر SRTM را دریافت کنید.'),'lp-muted'));
     return box;
   }
   const p=analysis.samples,bounds=profileBounds(p);
   const x=i=>52+i/(p.length-1)*850;
   const y=m=>285-(m-bounds.min)/(bounds.max-bounds.min)*238;
   const svg=E('svg',{viewBox:'0 0 960 320',role:'img','aria-label':L('Terrain, line of sight and Fresnel clearance profile','پروفایل ارتفاع زمین، دید مستقیم و فرنل')});
   const pathValues=key=>p.map((s,i)=>(i===0?'M':'L')+x(i).toFixed(2)+' '+y(s[key]).toFixed(2)).join(' ');
   const ground=pathValues('groundM')+' L '+x(p.length-1)+' 292 L '+x(0)+' 292 Z';
   const add=(tag,attrs)=>svg.append(E(tag,attrs));
   for(const [pos,label] of [[0,'0'],[.5,number(bounds.min+(bounds.max-bounds.min)*.5,0)],[1,number(bounds.max,0)]]){
     const yy=285-pos*238;
     add('line',{x1:50,y1:yy,x2:907,y2:yy,stroke:'var(--lp-grid,#dbe5ee)','stroke-width':1});
     add('text',{x:4,y:yy+4,fill:'var(--lp-muted,#677b8e)','font-size':12,text:label});
   }
   add('path',{d:ground,fill:'rgba(101,137,108,.25)',stroke:'none'});
   add('path',{d:pathValues('groundM'),fill:'none',stroke:'#498e66','stroke-width':2.5,'data-line':'ground'});
   add('path',{d:pathValues('requiredM'),fill:'none',stroke:'#ef9a43','stroke-width':2,'stroke-dasharray':'6 5','data-line':'fresnel'});
   add('path',{d:pathValues('lineM'),fill:'none',stroke:'#2469bb','stroke-width':2.5,'data-line':'los'});
   add('text',{x:50,y:312,fill:'var(--lp-muted,#677b8e)','font-size':12,text:'0 km'});
   add('text',{x:838,y:312,fill:'var(--lp-muted,#677b8e)','font-size':12,text:number(p.at(-1).distanceKm,2)+' km'});
   box.append(svg,E('div',{class:'lp-chart-legend'},
     E('span',{},E('b',{class:'lp-dot terrain'}),L('Ground','زمین')),
     E('span',{},E('b',{class:'lp-dot los'}),'LOS'),
     E('span',{},E('b',{class:'lp-dot fresnel'}),L('Terrain + curvature + Fresnel clearance','زمین + انحنای زمین + فرنل'))));
   return box;
 }
 function results(){
   const host=doc().getElementById('lpResults');if(!host)return;
   host.replaceChildren();
   const outcome=validPlan();
   if(!outcome.value){host.append(text(L('Choose two distinct points and valid radio parameters.','دو نقطه متفاوت و پارامترهای معتبر انتخاب کنید.'),'lp-notice'));return;}
   const v=outcome.value,b=radioBudget(v);
   const hasProfile=profile&&profileKey===coordKey(v);
   const assessment=hasProfile?assessTerrain(v,profile.elevations):null;
   const status=assessment?.status==='clear'?L('Sampled path clear','مسیر نمونه‌برداری‌شده باز است'):
     assessment?.status==='obstructed'?L('Sampled path obstructed','مسیر نمونه‌برداری‌شده دارای مانع است'):
     L('Terrain not verified','ارتفاع مسیر تأیید نشده');
   const header=E('div',{class:'lp-results-head'},E('h3',{text:L('Path results','نتایج مسیر')}),
      E('span',{class:'lp-state '+(assessment?.status||'unknown'),text:status}));
   host.append(header,E('div',{class:'lp-metrics'},
     metric(L('Distance','فاصله'),number(b.distanceKm,2)+' km',L('Great-circle GPS','مستقیم جغرافیایی')),
     metric('FSPL',number(b.fsplDb)+' dB',L('Free-space estimate','مدل فضای آزاد')),
     metric('EIRP',number(b.eirpDbm)+' dBm',L('Check legal limits','محدودیت قانونی بررسی شود')),
     metric('RX',number(b.rxDbm)+' dBm',L('Theoretical received power','توان دریافتی نظری')),
     metric(L('Link margin','حاشیه لینک'),number(b.marginDb)+' dB',L('Vs entered sensitivity','براساس حساسیت ورودی')),
     metric(L('Min Fresnel clearance','کمترین فاصله آزاد فرنل'),
       assessment?.worst?number(assessment.worst.clearanceM,1)+' m':'—',
       assessment?.worst?L('At ','در ')+number(assessment.worst.distanceKm,2)+' km':L('Requires terrain data','نیازمند پروفایل زمین')),
     metric(L('Raise both antennas by','افزایش ارتفاع هر دو آنتن'),
       assessment?.status==='obstructed'?number(assessment.recommendedRaiseBothM,1)+' m':assessment?.status==='clear'?'0 m':'—',
       L('Uniform estimated increase','افزایش یکسان و تقریبی'))
   ));
   host.append(chart(assessment));
   host.append(text(assessment?.status==='unavailable'?assessment.message:
    assessment?L('Estimated geometric clearance at sampled terrain points only. Buildings, trees and fine obstacles are excluded.','فقط برآورد هندسی در نقاط نمونه‌برداری‌شده است؛ ساختمان‌ها، درختان و موانع ریز لحاظ نشده‌اند.'):
    L('No verified terrain profile. FSPL and link margin above are mathematical estimates, not a clearance or availability guarantee.','بدون پروفایل زمین معتبر؛ FSPL و حاشیه لینک صرفاً محاسبه ریاضی هستند و تأیید دید یا دسترس‌پذیری نیستند.'),'lp-muted'));
   host.append(text(L('Throughput / MCS / QAM and rain availability are not calculated without verified device and climate datasets.','Throughput، MCS، QAM و دسترس‌پذیری باران بدون داده معتبر تجهیزات و اقلیم محاسبه نمی‌شوند.'),'lp-muted'));
 }
 function sync(){
   const v=validPlan();
   const footer=doc().getElementById('lpValidation');
   if(footer)footer.textContent=v.error||'';
   results();sendMap();
   if(profile&&(!v.value||profileKey!==coordKey(v))){
     const tag=doc().getElementById('lpTerrainStatus');if(tag)tag.textContent=L('Coordinates changed; reload terrain.','مختصات تغییر کرد؛ پروفایل را دوباره دریافت کنید.');
   }
 }
 async function terrain(){
   const v=validPlan();if(!v.value)return toast(v.error);
   const button=doc().getElementById('lpTerrainButton');
   if(busy)return;
   busy=true;button.disabled=true;profileError='';
   const status=doc().getElementById('lpTerrainStatus');status.textContent=L('Loading 81 SRTM90 points…','در حال دریافت ۸۱ نقطه ارتفاعی SRTM90…');
   try{
     const plan=v.value;
     const qs=new URLSearchParams({latA:String(plan.a.latitude),lonA:String(plan.a.longitude),latB:String(plan.b.latitude),lonB:String(plan.b.longitude)});
     const response=await request('/api/link-planner/terrain?'+qs.toString());
     if(!current())return;
     if(!response?.ok||!Array.isArray(response.elevations))throw new Error('Invalid terrain response');
     profile=response;profileKey=coordKey(plan);
     status.textContent=response.missing?L('Some elevation samples are missing: clearance is unknown.','برخی نقاط ارتفاعی موجود نیستند؛ نتیجه نامشخص است.'):L('SRTM90 profile loaded.','پروفایل SRTM90 دریافت شد.');
     results();
   }catch(error){
     profile=null;profileKey='';
     profileError=error.message;status.textContent=L('Terrain unavailable: ','پروفایل در دسترس نیست: ')+error.message;
     results();
   }finally{busy=false;if(button?.isConnected)button.disabled=false;}
 }
 async function refreshScenarios(){
   try{const data=await request('/api/link-planner/scenarios');scenarios=Array.isArray(data.items)?data.items:[];updateScenarioSelect();}
   catch(e){toast(e.message);}
 }
 function updateScenarioSelect(){
   const input=doc().getElementById('lpScenarioSelect');if(!input)return;
   input.replaceChildren(E('option',{value:'',text:L('Saved scenarios','سناریوهای ثبت‌شده')}));
   for(const s of scenarios)input.append(E('option',{value:s.id,text:s.name}));
 }
 async function save(){
   const result=validPlan();if(!result.value)return toast(result.error);
   const name=doc().getElementById('lpScenarioName')?.value.trim()||'';
   if(!name)return toast(L('Enter a scenario name.','برای سناریو نام وارد کنید.'));
   try{
     const saved=await request('/api/link-planner/scenarios',{method:'POST',body:{name,config:result.value}});
     scenarioName=saved.item.name;
     await refreshScenarios();
     const select=doc().getElementById('lpScenarioSelect');if(select)select.value=saved.item.id;
     toast(L('Scenario saved to PostgreSQL.','سناریو در PostgreSQL ذخیره شد.'));
   }catch(e){toast(e.message);}
 }
 async function load(){
   const id=doc().getElementById('lpScenarioSelect')?.value;if(!id)return;
   try{
     const data=await request('/api/link-planner/scenarios/'+encodeURIComponent(id));
     input=structuredClone(data.item.config);scenarioName=data.item.name;profile=null;profileKey='';render();sync();
     toast(L('Scenario loaded. Re-fetch SRTM data to verify terrain.','سناریو بارگذاری شد؛ پروفایل SRTM را دوباره دریافت کنید.'));
   }catch(e){toast(e.message);}
 }
 async function remove(){
   const id=doc().getElementById('lpScenarioSelect')?.value;if(!id)return;
   try{await request('/api/link-planner/scenarios/'+encodeURIComponent(id),{method:'DELETE'});await refreshScenarios();toast(L('Scenario deleted.','سناریو حذف شد.'));}catch(e){toast(e.message);}
 }
 function exportReport(){
   const v=validPlan();if(!v.value)return toast(v.error);
   const budget=radioBudget(v.value);
   const complete=profile&&profileKey===coordKey(v.value);
   const clearance=complete?assessTerrain(v.value,profile.elevations):null;
   const report={format:'EMS-IPAM-Link-Planner-Report/1',generatedAt:new Date().toISOString(),
     name:scenarioName||'Untitled',config:v.value,budget,terrain:complete?{source:profile.source,dataset:profile.dataset,retrievedAt:profile.retrievedAt,samples:profile.elevations,clearance}:null,
     limitations:['Approximate terrain; buildings/trees absent','No verified throughput, rain availability or regulatory EIRP check','No real radio or network measurements']};
   const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
   const address=URL.createObjectURL(blob),link=E('a',{href:address,download:'ems-link-plan.json'});
   doc().body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(address),1000);
 }
 function fieldset(title,fields){
   return E('fieldset',{class:'lp-fieldset'},E('legend',{text:title}),E('div',{class:'lp-field-grid'},fields));
 }
 function render(){
   if(!current())return;
   page.replaceChildren();
   const shell=E('div',{class:'lp-shell'});
   shell.append(E('header',{class:'lp-header'},
     E('div',{},E('span',{class:'lp-eyebrow',text:'EMS_IPAM / NETWORK PLANNING'}),
       E('h1',{text:L('Link Planner','طراحی لینک رادیویی')}),
       text(L('Two-site path analysis · no connection to your radio devices','بررسی مسیر بین دو سایت · بدون اتصال به تجهیزات رادیویی'),'lp-muted')),
     E('span',{class:'lp-version',text:'MVP 0.1.0'})));
   const main=E('div',{class:'lp-main'});
   const left=E('section',{class:'lp-map-card'},
     row(E('h2',{text:L('Path location','موقعیت مسیر')}),
       button(L('Pick A','انتخاب A'),()=>activeButton('a'),'lp-pick'+(active==='a'?' selected':'')),
       button(L('Pick B','انتخاب B'),()=>activeButton('b'),'lp-pick'+(active==='b'?' selected':''))),
     E('iframe',{id:'lpMap',src:'/api/link-planner/map',title:L('OpenStreetMap two-site map','نقشه انتخاب دو سایت'),loading:'eager'}),
     text(L('Choose A or B and click the map, or type coordinates. OpenStreetMap tiles require internet.','نقطه A یا B را انتخاب و روی نقشه کلیک کنید، یا مختصات را دستی وارد کنید. نقشه آنلاین به اینترنت نیاز دارد.'),'lp-muted'),
     E('div',{class:'lp-terrain-controls'},
       button(L('Load SRTM90 terrain','دریافت ارتفاع زمین SRTM90'),terrain,'primary'),
       E('span',{id:'lpTerrainStatus',text:profile?.missing?L('Some elevation samples are missing','برخی نقاط ارتفاعی ناموجودند'):profile?L('Terrain profile loaded','پروفایل دریافت شد'):L('Terrain not loaded','پروفایل زمین دریافت نشده')})),
     E('small',{class:'lp-source',text:DEM_NOTE}));
   left.querySelector('.lp-pick:first-of-type')?.setAttribute('data-site','a');
   left.querySelector('.lp-pick:last-of-type')?.setAttribute('data-site','b');
   left.querySelector('.lp-terrain-controls button')?.setAttribute('id','lpTerrainButton');
   left.querySelector('iframe')?.addEventListener('load',()=>sendMap(true));
   const side=E('aside',{class:'lp-side'});
   const locationFields=E('div',{class:'lp-site-inputs'});
   for(const [prefix,letter] of [['a','A'],['b','B']]){
     locationFields.append(E('div',{class:'lp-site'},E('h4',{text:L('Site ','سایت ')+letter}),
       row(siteRow('Latitude',prefix+'.latitude',-90,90,'0.000001'),siteRow('Longitude',prefix+'.longitude',-180,180,'0.000001'))));
   }
   side.append(card(L('Endpoints','نقاط ابتدا و انتها'),locationFields),
     card(L('Heights above terrain (m)','ارتفاع‌ها از سطح زمین (متر)'),
       fieldset(L('Site A','سایت A'),[
         siteRow(L('Building','ساختمان'),'siteA.building',0,1000),
         siteRow(L('Tower','دکل'),'siteA.tower',0,1000),
         siteRow(L('Antenna offset','ارتفاع پایه آنتن'),'siteA.mount',0,100)]),
       fieldset(L('Site B','سایت B'),[
         siteRow(L('Building','ساختمان'),'siteB.building',0,1000),
         siteRow(L('Tower','دکل'),'siteB.tower',0,1000),
         siteRow(L('Antenna offset','ارتفاع پایه آنتن'),'siteB.mount',0,100)])),
     card(L('Radio assumptions','فرضیات رادیویی'),
       E('div',{class:'lp-field-grid'},[
         siteRow('Frequency (GHz)','frequencyGHz',.1,100,'.1'),
         siteRow('TX power (dBm)','txDbm',-50,60,'.1'),
         siteRow('A gain (dBi)','gainA',-10,65,'.1'),
         siteRow('B gain (dBi)','gainB',-10,65,'.1'),
         siteRow('A loss (dB)','lossA',0,40,'.1'),
         siteRow('B loss (dB)','lossB',0,40,'.1'),
         siteRow(L('Other loss (dB)','تلفات دیگر (dB)'),'otherLoss',0,100,'.1'),
         siteRow('RX sensitivity (dBm)','sensitivityDbm',-150,-20,'.1'),
         siteRow(L('Earth k-factor','ضریب زمین k'),'kFactor',.5,3,'.01'),
         siteRow(L('Fresnel clear fraction','درصد آزادبودن فرنل'),'fresnelClearance',0,1,'.05')]),
       stringRow(L('Site A radio model (optional)','مدل رادیو سایت A (اختیاری)'),'deviceA','MikroTik / Mimosa / ...'),
       stringRow(L('Site B radio model (optional)','مدل رادیو سایت B (اختیاری)'),'deviceB','MikroTik / Mimosa / ...')));
   const details=E('section',{class:'lp-summary'},E('div',{id:'lpValidation',class:'lp-error'}),E('div',{id:'lpResults'}));
   const storage=card(L('Saved plans and reports','سناریوهای ذخیره‌شده و گزارش'),
     row(E('input',{id:'lpScenarioName',type:'text',maxlength:80,placeholder:L('Scenario name','نام سناریو'),value:scenarioName}),button(L('Save','ذخیره'),save,'primary')),
     row(E('select',{id:'lpScenarioSelect'}),button(L('Load','بازکردن'),load),button(L('Delete','حذف'),remove)),
     row(button(L('Download calculation report (JSON)','دریافت گزارش محاسبات (JSON)'),exportReport)));
   main.append(left,side);
   shell.append(main,details,storage);
   page.append(shell);
   updateScenarioSelect();results();sync();
   const frame=doc().getElementById('lpMap');
   window.linkPlannerMessageHandler=event=>{
     if(!current()||event.origin!==location.origin||event.source!==frame.contentWindow)return;
     const d=event.data||{};
     if(d.type==='ems:planner:ready')sendMap(true);
     if(d.type==='ems:planner:select')activeButton(d.which);
     if(d.type==='ems:planner:pick'){
       if(!['a','b'].includes(d.which)||!Number.isFinite(d.latitude)||!Number.isFinite(d.longitude)||Math.abs(d.latitude)>90||Math.abs(d.longitude)>180)return;
       input[d.which]={latitude:d.latitude,longitude:d.longitude};
       const fields=page.querySelectorAll('input[data-path]');
       for(const f of fields)if(f.dataset.path===d.which+'.latitude')f.value=d.latitude;
       else if(f.dataset.path===d.which+'.longitude')f.value=d.longitude;
       sync();
     }
   };
   sendMap();
 }
 window.addEventListener('message',event=>window.linkPlannerMessageHandler?.(event));
 async function openPage(){
   state.view='module';state.currentModuleId=ID;
   render();await refreshScenarios();
 }
 return {openPage};
}
