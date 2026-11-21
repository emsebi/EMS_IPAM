import {normalizeInput,radioBudget,assessTerrain,profileBounds,requiredOppositeTower,interpolateGreatCircle} from './model.mjs?v=0.2.1-lab.1';
import {RADIO_PROFILES,RADIO_BRANDS,radioById,protocolOverlap,modulationOptions,estimateRadioCapacity} from './radio-profiles.mjs?v=0.2.1-lab.1';

const INITIAL=()=>({
 a:{latitude:'',longitude:''},b:{latitude:'',longitude:''},
 siteA:{building:0,tower:12,mount:0},siteB:{building:0,tower:12,mount:0},
 frequencyGHz:5.8,txDbm:20,gainA:27,gainB:27,lossA:1,lossB:1,otherLoss:0,
 sensitivityDbm:-80,kFactor:4/3,fresnelClearance:0.6,deviceA:'',deviceB:'',
 radioA:'custom',radioB:'custom',protocol:'802.11ac',channelWidthMHz:40,spatialStreams:2,modulation:''
});
const DEM_NOTE='SRTM90m · approx. 90 m DEM, not a survey; no trees/buildings captured';
export function createUi(ctx){
 const {state,page,request,toast}=ctx;
 const L=(english,persian)=>state.language==='fa'?persian:english;
 let input=INITIAL(),active='a',profile=null,profileKey='',scenarioName='',scenarios=[],busy=false,notice='',profileError='';
 let inspectedIndex=null,inspectChart=()=>{};
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
 function deviceChoices(which){
   const code='radio'+which.toUpperCase(),current=radioById(input[code]),label=which.toUpperCase();
   const brand=E('select',{id:'lpBrand'+label,onChange:event=>{
     const first=RADIO_PROFILES.find(p=>p.brand===event.target.value);
     if(!first)return;
     input[code]=first.id;
     if(first.antennaGainDbi!==null){
       const gainKey=which==='a'?'gainA':'gainB';
       input[gainKey]=first.antennaGainDbi;
       const field=page.querySelector('[data-path="'+gainKey+'"]');
       if(field)field.value=String(input[gainKey]);
     }
     rebuildRadioControls();sync();
   }},RADIO_BRANDS.map(b=>E('option',{value:b,text:b,selected:b===current.brand?true:null})));
   const model=E('select',{id:'lpModel'+label,onChange:event=>{
     input[code]=event.target.value;
     const profile=radioById(event.target.value);
     const gainKey=which==='a'?'gainA':'gainB';
     if(profile.antennaGainDbi!==null){
       input[gainKey]=profile.antennaGainDbi;
       const gainField=page.querySelector('[data-path="'+gainKey+'"]');
       if(gainField)gainField.value=String(input[gainKey]);
     }
     rebuildRadioControls();sync();
   }});
   const details=E('div',{class:'lp-profile-info',id:'lpProfileInfo'+label});
   return E('div',{class:'lp-device-group'},
     E('h4',{text:L('Site ','سایت ')+label}),
     E('div',{class:'lp-field-grid'},
       E('label',{class:'lp-field'},E('span',{text:L('Manufacturer','سازنده')}),brand),
       E('label',{class:'lp-field'},E('span',{text:L('Model / family','مدل / خانواده')}),model)),
     details);
 }
 function rebuildRadioControls(){
   for(const which of ['a','b']){
     const letter=which.toUpperCase(),profile=radioById(input['radio'+letter]);
     const model=doc().getElementById('lpModel'+letter),brand=doc().getElementById('lpBrand'+letter);
     if(!model||!brand)continue;
     brand.value=profile.brand;
     model.replaceChildren(...RADIO_PROFILES.filter(p=>p.brand===profile.brand).map(p=>E('option',{value:p.id,text:p.model})));
     model.value=profile.id;
     const details=doc().getElementById('lpProfileInfo'+letter);
     if(details){
       details.replaceChildren();
       if(profile.notes)details.append(text(profile.notes,'lp-muted'));
       if(profile.source)details.append(E('a',{href:profile.source,target:'_blank',rel:'noopener noreferrer',text:L('Manufacturer datasheet','مشخصات سازنده')}));
       if(profile.antennaGainDbi!==null)details.append(text(L('Integrated antenna gain: ','گین آنتن داخلی: ')+profile.antennaGainDbi+' dBi','lp-muted'));
     }
   }
   const select=doc().getElementById('lpProtocol');
   if(select){
     const protocols=protocolOverlap(input.radioA,input.radioB);
     if(!protocols.includes(input.protocol))input.protocol=protocols[0]||'';
     select.replaceChildren(...(protocols.length?protocols:[null]).map(p=>E('option',{value:p||'',text:p||L('No compatible PHY','پروتکل مشترک وجود ندارد')})));
     select.value=input.protocol;
   }
   const mod=doc().getElementById('lpModulation');
   if(mod){
     const modes=modulationOptions(input.radioA,input.radioB);
     if(!modes.includes(input.modulation))input.modulation='';
     mod.replaceChildren(E('option',{value:'',text:L('Auto / not verified','خودکار / تأییدنشده')}),
       ...modes.map(x=>E('option',{value:x,text:x})));
     mod.value=input.modulation;
     mod.disabled=input.protocol!=='Digital microwave ACM'||modes.length===0;
   }
 }
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
   const plan=validPlan().value;
   const complete=plan&&profile&&profileKey===coordKey(plan);
   const analysis=complete?assessTerrain(plan,profile.elevations):null;
   const coords=analysis?.samples?interpolateGreatCircle(plan.a,plan.b,analysis.samples.length):[];
   const path=analysis?.samples?.map((sample,i)=>({
     latitude:coords[i].latitude,longitude:coords[i].longitude,
     distanceKm:sample.distanceKm,groundM:sample.groundM,
     lineM:sample.lineM,requiredM:sample.requiredM,clearanceM:sample.clearanceM
   }))||[];
   frame.contentWindow?.postMessage({type:'ems:planner:data',
     a:valid(a)?{latitude:Number(a.latitude),longitude:Number(a.longitude)}:null,
     b:valid(b)?{latitude:Number(b.latitude),longitude:Number(b.longitude)}:null,
     active,fit,path},location.origin);
 }
 function inspectSample(index,fromMap=false){
   const accepted=Number.isInteger(index)&&index>=0&&index<81?index:null;
   inspectedIndex=accepted;
   inspectChart(accepted);
   if(!fromMap)doc().getElementById('lpMap')?.contentWindow?.postMessage({
     type:'ems:planner:inspect',index:accepted
   },location.origin);
 }
 function focusSite(which){
   const p=input[which];
   if(!p||p.latitude===''||p.longitude===''||!Number.isFinite(Number(p.latitude))||!Number.isFinite(Number(p.longitude)))
     return toast(L('Enter the coordinates for this site first.','ابتدا مختصات این سایت را وارد کنید.'));
   sendMap();
   doc().getElementById('lpMap')?.contentWindow?.postMessage({type:'ems:planner:focus',which},location.origin);
 }
 function chart(analysis){
   const box=E('div',{class:'lp-chart'});
   inspectChart=()=>{};
   if(!analysis||!Array.isArray(analysis.samples)){
     box.append(text(L('Terrain profile unavailable. Load valid SRTM elevation data to assess clearance.','پروفایل زمین در دسترس نیست. ابتدا ارتفاعات معتبر SRTM را دریافت کنید.'),'lp-muted'));
     return box;
   }
   const p=analysis.samples,bounds=profileBounds(p),left=52,right=902;
   const x=i=>left+i/(p.length-1)*(right-left);
   const y=m=>285-(m-bounds.min)/(bounds.max-bounds.min)*238;
   const peaks=p.reduce((best,s,i)=>s.groundM>p[best].groundM?i:best,0);
   const blocked=p.filter(s=>s.clearanceM<0).length;
   const header=E('div',{class:'lp-profile-overview'},
     E('strong',{text:L('Elevation along the path','پستی و بلندی مسیر')}),
     E('span',{text:L('Highest sampled terrain: ','بالاترین ارتفاع زمین: ')+
       number(p[peaks].groundM,1)+' m · '+number(p[peaks].distanceKm,2)+' km'}),
     E('span',{class:blocked?'lp-path-alert':'lp-path-clear',text:blocked?
       L('Potentially obstructed samples: ','نمونه‌های دارای مانع احتمالی: ')+blocked:
       L('No sampled obstruction (not a field survey)','در نمونه‌ها مانعی دیده نشد (جایگزین بررسی میدانی نیست)')}));
   const svg=E('svg',{id:'lpProfileSvg',viewBox:'0 0 960 320',role:'img',
     'aria-label':L('Interactive elevation profile: green ground, blue LOS, orange Fresnel clearance, red possible obstruction','پروفایل تعاملی ارتفاع: سبز زمین، آبی خط دید، نارنجی فرنل و قرمز مانع احتمالی')});
   const pathValues=key=>p.map((s,i)=>(i===0?'M':'L')+x(i).toFixed(2)+' '+y(s[key]).toFixed(2)).join(' ');
   const ground=pathValues('groundM')+' L '+x(p.length-1)+' 292 L '+x(0)+' 292 Z';
   const add=(tag,attrs)=>{const element=E(tag,attrs);svg.append(element);return element;};
   for(const [pos,label] of [[0,number(bounds.min,0)],[.5,number(bounds.min+(bounds.max-bounds.min)*.5,0)],[1,number(bounds.max,0)]]){
     const yy=285-pos*238;
     add('line',{x1:50,y1:yy,x2:907,y2:yy,stroke:'var(--lp-grid,#dbe5ee)','stroke-width':1});
     add('text',{x:4,y:yy+4,fill:'var(--lp-muted,#677b8e)','font-size':12,text:label});
   }
   add('path',{d:ground,fill:'rgba(101,137,108,.25)',stroke:'none'});
   add('path',{d:pathValues('groundM'),fill:'none',stroke:'#498e66','stroke-width':2.5,'data-line':'ground'});
   add('path',{d:pathValues('requiredM'),fill:'none',stroke:'#ef9a43','stroke-width':2,'stroke-dasharray':'6 5','data-line':'fresnel'});
   add('path',{d:pathValues('lineM'),fill:'none',stroke:'#2469bb','stroke-width':2.5,'data-line':'los'});
   for(let i=0;i<p.length;i++)if(p[i].clearanceM<0){
     add('circle',{cx:x(i),cy:y(p[i].requiredM),r:3,fill:'#d83b44',
       'data-obstruction-index':i,'aria-label':'Possible obstructed sample '+i});
   }
   add('circle',{cx:x(peaks),cy:y(p[peaks].groundM),r:5,fill:'#226447',stroke:'white','stroke-width':1.8,
     'data-highest-point':peaks});
   add('text',{x:50,y:312,fill:'var(--lp-muted,#677b8e)','font-size':12,text:'0 km'});
   add('text',{x:838,y:312,fill:'var(--lp-muted,#677b8e)','font-size':12,text:number(p.at(-1).distanceKm,2)+' km'});
   const marker=add('g',{'data-profile-cursor':'true'});
   marker.style.display='none';
   const vertical=E('line',{x1:0,y1:38,x2:0,y2:285,stroke:'#25374b','stroke-width':1.6,'stroke-dasharray':'5 4'});
   const groundDot=E('circle',{cx:0,cy:0,r:5,fill:'#498e66',stroke:'#fff','stroke-width':2});
   const losDot=E('circle',{cx:0,cy:0,r:5,fill:'#2469bb',stroke:'#fff','stroke-width':2});
   marker.append(vertical,groundDot,losDot);
   const hit=add('rect',{x:50,y:35,width:854,height:260,fill:'transparent','data-profile-hover-area':'true'});
   hit.style.cursor='crosshair';
   const readout=E('div',{id:'lpInspectReadout',class:'lp-inspect-readout',
     role:'status',text:L('Move the pointer along this elevation profile or the map link to inspect a specific point.','موس را روی نمودار ارتفاع یا خط مسیر روی نقشه حرکت دهید تا ارتفاع و مانع هر نقطه را ببینید.')});
   const inspect=index=>{
     const ok=Number.isInteger(index)&&index>=0&&index<p.length;
     marker.style.display=ok?'':'none';
     if(!ok){
       readout.removeAttribute('data-obstructed');
       readout.textContent=L('Move the pointer along this elevation profile or the map link to inspect a specific point.','موس را روی نمودار ارتفاع یا خط مسیر روی نقشه حرکت دهید تا ارتفاع و مانع هر نقطه را ببینید.');
       return;
     }
     const sample=p[index],xx=x(index),obstructed=sample.clearanceM<0;
     vertical.setAttribute('x1',xx);vertical.setAttribute('x2',xx);
     groundDot.setAttribute('cx',xx);groundDot.setAttribute('cy',y(sample.groundM));
     losDot.setAttribute('cx',xx);losDot.setAttribute('cy',y(sample.lineM));
     readout.dataset.obstructed=String(obstructed);
     readout.textContent=(obstructed?L('Potential obstruction','مانع احتمالی'):L('Clear at sampled point','در نمونه مسیر آزاد'))+
       ' · '+L('From A','فاصله از A')+' '+number(sample.distanceKm,2)+' km'+
       ' · '+L('Terrain','ارتفاع زمین')+' '+number(sample.groundM,1)+' m'+
       ' · LOS '+number(sample.lineM,1)+' m'+
       ' · '+L('Fresnel boundary','مرز فرنل')+' '+number(sample.requiredM,1)+' m'+
       ' · '+L('Clearance','فاصله آزاد')+' '+number(sample.clearanceM,1)+' m';
   };
   hit.addEventListener('pointermove',event=>{
     const rect=svg.getBoundingClientRect();
     const scaledX=(event.clientX-rect.left)*960/rect.width;
     inspectSample(Math.max(0,Math.min(p.length-1,Math.round((scaledX-left)/(right-left)*(p.length-1)))));
   });
   hit.addEventListener('pointerdown',event=>{
     const rect=svg.getBoundingClientRect();
     const scaledX=(event.clientX-rect.left)*960/rect.width;
     inspectSample(Math.max(0,Math.min(p.length-1,Math.round((scaledX-left)/(right-left)*(p.length-1)))));
   });
   svg.addEventListener('pointerleave',()=>inspectSample(null));
   box.append(header,svg,readout,E('div',{class:'lp-chart-legend'},
     E('span',{},E('b',{class:'lp-dot terrain'}),L('Ground','زمین')),
     E('span',{},E('b',{class:'lp-dot los'}),'LOS'),
     E('span',{},E('b',{class:'lp-dot fresnel'}),L('Terrain + curvature + Fresnel clearance','زمین + انحنای زمین + فرنل')),
     E('span',{},E('b',{class:'lp-dot obstruction'}),L('Possible obstruction','مانع احتمالی'))));
   inspectChart=inspect;
   inspect(inspectedIndex);
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
   const minB=hasProfile?requiredOppositeTower(v,profile.elevations,'a'):null;
   const minA=hasProfile?requiredOppositeTower(v,profile.elevations,'b'):null;
   const capacity=estimateRadioCapacity(v,b);
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
   // Each candidate fixes one site's current tower/building/offset and solves the opposite side.
   // Do not invent a tower height without complete SRTM samples.
   host.append(E('section',{class:'lp-height-solver'},
     E('h4',{text:L('Minimum opposite tower — hold one side fixed','حداقل ارتفاع دکل مقابل — با ثابت بودن یک طرف')}),
     E('div',{class:'lp-metrics'},
       metric(L('Required B tower (A fixed)','حداقل دکل B (A ثابت)'),
         minB?.status==='ok'?number(minB.requiredTowerM,1)+' m':'—',
         L('Current A tower: ','ارتفاع فعلی دکل A: ')+number(v.siteA.tower,1)+' m'),
       metric(L('Required A tower (B fixed)','حداقل دکل A (B ثابت)'),
         minA?.status==='ok'?number(minA.requiredTowerM,1)+' m':'—',
         L('Current B tower: ','ارتفاع فعلی دکل B: ')+number(v.siteB.tower,1)+' m')
     ),
     E('div',{class:'lp-row'},
       button(L('Set B to minimum (A fixed)','ثبت ارتفاع حداقل B (A ثابت)'),()=>{
         if(minB?.status!=='ok')return;
         const value=Math.ceil(minB.requiredTowerM*10)/10;
         input.siteB.tower=value;
         const field=page.querySelector('[data-path="siteB.tower"]');if(field)field.value=String(value);
         sync();
       },'lp-apply-height'),
       button(L('Set A to minimum (B fixed)','ثبت ارتفاع حداقل A (B ثابت)'),()=>{
         if(minA?.status!=='ok')return;
         const value=Math.ceil(minA.requiredTowerM*10)/10;
         input.siteA.tower=value;
         const field=page.querySelector('[data-path="siteA.tower"]');if(field)field.value=String(value);
         sync();
       },'lp-apply-height')),
     text(L('A = ground + building + tower + antenna mount. Opposite-site tower is computed after subtracting its building and antenna mount. Site coverage depends on SRTM samples and configured Fresnel percentage.','ارتفاع آنتن = ارتفاع زمین + ساختمان + دکل + پایه آنتن. ارتفاع دکل سمت مقابل پس از کسر ارتفاع ساختمان و پایه آنتن محاسبه می‌شود. نتیجه تقریبی و وابسته به نمونه‌های SRTM و درصد فرنل است.'),'lp-muted')
   ));
   host.append(E('section',{class:'lp-capacity-reference'},
     E('h4',{text:L('Radio modulation and capacity reference','مازولیشن و ظرفیت مرجع تجهیزات')}),
     E('div',{class:'lp-metrics'},
       metric(L('Protocol','پروتکل'),capacity.protocol||'—',capacity.status),
       metric(L('Modulation / PHY reference','مازولیشن / PHY مرجع'),capacity.modulation||'—',L('Not a measured MCS','MCS اندازه‌گیری‌شده نیست')),
       metric(L('Maximum theoretical PHY','حداکثر PHY نظری'),capacity.phyCeilingMbps!==null?number(capacity.phyCeilingMbps,1)+' Mbps':'—',L('Not payload throughput','توان عملیاتی واقعی نیست')),
       metric(L('Actual throughput','توان عملیاتی واقعی'),'—',L('Needs vendor SNR/MCS + interference','نیازمند جدول MCS و تداخل')),
       metric(L('Ideal uncoded symbol rate','نرخ نماد بدون کدینگ'),capacity.idealRawUpperMbps!=null?number(capacity.idealRawUpperMbps,1)+' Mb/s':'—',L('Microwave upper bound only','فقط سقف نظری مایکروویو')),
       metric(L('Both-model brochure ceiling','حداکثر کاتالوگی دو مدل'),capacity.advertisedCeilingMbps!=null?number(capacity.advertisedCeilingMbps,0)+' Mbps':'—',L('Not predicted performance','عملکرد پیش‌بینی‌شده نیست'))
     ),
     text(capacity.note,'lp-muted')
   ));
   host.append(chart(assessment));
   host.append(text(assessment?.status==='unavailable'?assessment.message:
    assessment?L('Estimated geometric clearance at sampled terrain points only. Buildings, trees and fine obstacles are excluded.','فقط برآورد هندسی در نقاط نمونه‌برداری‌شده است؛ ساختمان‌ها، درختان و موانع ریز لحاظ نشده‌اند.'):
    L('No verified terrain profile. FSPL and link margin above are mathematical estimates, not a clearance or availability guarantee.','بدون پروفایل زمین معتبر؛ FSPL و حاشیه لینک صرفاً محاسبه ریاضی هستند و تأیید دید یا دسترس‌پذیری نیستند.'),'lp-muted'));
   host.append(text(L('Actual throughput, adaptive MCS and rain Availability remain unknown without measured noise, licensed device specifications and climate data.','توان عملیاتی واقعی، MCS تطبیقی و Availability باران بدون داده معتبر تداخل، مشخصات لایسنس تجهیزات و اطلاعات اقلیم همچنان نامشخص‌اند.'),'lp-muted'));
 }
 function sync(){
   const v=validPlan();
   const footer=doc().getElementById('lpValidation');
   if(footer)footer.textContent=v.error||'';
   results();sendMap();
   if(profile&&(!v.value||profileKey!==coordKey(v.value))){
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
     results();sendMap();
   }catch(error){
     profile=null;profileKey='';
     profileError=error.message;status.textContent=L('Terrain unavailable: ','پروفایل در دسترس نیست: ')+error.message;
     results();sendMap();
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
   const capacity=estimateRadioCapacity(v.value,budget);
   const oppositeTower=complete?{bWithAFixed:requiredOppositeTower(v.value,profile.elevations,'a'),aWithBFixed:requiredOppositeTower(v.value,profile.elevations,'b')}:null;
   const report={format:'EMS-IPAM-Link-Planner-Report/2',generatedAt:new Date().toISOString(),
     name:scenarioName||'Untitled',config:v.value,budget,capacityReference:capacity,oppositeTower,terrain:complete?{source:profile.source,dataset:profile.dataset,retrievedAt:profile.retrievedAt,samples:profile.elevations,clearance}:null,
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
     E('span',{class:'lp-version',text:'MVP 0.2.0'})));
   const main=E('div',{class:'lp-main'});
   const left=E('section',{class:'lp-map-card'},
     row(E('h2',{text:L('Path location','موقعیت مسیر')}),
       button(L('Fit A + B','نمایش هر دو نقطه'),()=>sendMap(true),'lp-fit'),
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
       row(siteRow('Latitude',prefix+'.latitude',-90,90,'0.000001'),siteRow('Longitude',prefix+'.longitude',-180,180,'0.000001')),
       button(L('Go to site ','برو به سایت ')+letter,()=>focusSite(prefix),'lp-focus-site')));
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
     card(L('Radio equipment & waveform','تجهیزات و پروتکل ارتباطی'),
       deviceChoices('a'),deviceChoices('b'),
       E('div',{class:'lp-field-grid'},[
         E('label',{class:'lp-field'},E('span',{text:L('Common protocol / PHY','پروتکل مشترک / استاندارد')}),
           E('select',{id:'lpProtocol',onChange:event=>{input.protocol=event.target.value;rebuildRadioControls();sync();}})),
         E('label',{class:'lp-field'},E('span',{text:L('Microwave QAM (manual)','مازولیشن مایکروویو (دستی)')}),
           E('select',{id:'lpModulation',onChange:event=>{input.modulation=event.target.value;sync();}}))]),
       text(L('A/n/ac are Wi-Fi PHY standards, not frequency bands. Proprietary modes require compatible equipment at both ends.','a/n/ac استانداردهای وای‌فای هستند، نه باند فرکانسی. پروتکل اختصاصی نیازمند سازگاری دو طرف است.'),'lp-muted')),
     card(L('Radio assumptions','فرضیات رادیویی'),
       E('div',{class:'lp-field-grid'},[
         siteRow(L('Channel width (MHz)','پهنای کانال (MHz)'),'channelWidthMHz',3.5,112,'.5'),
         siteRow(L('Spatial streams','تعداد استریم فضایی'),'spatialStreams',1,8,'1'),
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
       text(L('Actual equipment throughput requires firmware/licence-specific MCS sensitivity, interference and channel conditions.','توان عملیاتی واقعی به حساسیت MCS، نسخه نرم‌افزار، لایسنس، تداخل و شرایط کانال وابسته است.'),'lp-muted')));
   const details=E('section',{class:'lp-summary'},E('div',{id:'lpValidation',class:'lp-error'}),E('div',{id:'lpResults'}));
   const storage=card(L('Saved plans and reports','سناریوهای ذخیره‌شده و گزارش'),
     row(E('input',{id:'lpScenarioName',type:'text',maxlength:80,placeholder:L('Scenario name','نام سناریو'),value:scenarioName}),button(L('Save','ذخیره'),save,'primary')),
     row(E('select',{id:'lpScenarioSelect'}),button(L('Load','بازکردن'),load),button(L('Delete','حذف'),remove)),
     row(button(L('Download calculation report (JSON)','دریافت گزارش محاسبات (JSON)'),exportReport)));
   main.append(left,side);
   shell.append(main,details,storage);
   page.append(shell);
   rebuildRadioControls();
   updateScenarioSelect();results();sync();
   const frame=doc().getElementById('lpMap');
   window.linkPlannerMessageHandler=event=>{
     if(!current()||event.origin!==location.origin||event.source!==frame.contentWindow)return;
     const d=event.data||{};
     if(d.type==='ems:planner:ready')sendMap(true);
     if(d.type==='ems:planner:select')activeButton(d.which);
     if(d.type==='ems:planner:inspect-changed')inspectSample(d.index,true);
     if(d.type==='ems:planner:pick'){
       if(!['a','b'].includes(d.which)||!Number.isFinite(d.latitude)||!Number.isFinite(d.longitude)||Math.abs(d.latitude)>90||Math.abs(d.longitude)>180)return;
       input[d.which]={latitude:d.latitude,longitude:d.longitude};
       const fields=page.querySelectorAll('input[data-path]');
       for(const f of fields)if(f.dataset.path===d.which+'.latitude')f.value=d.latitude;
       else if(f.dataset.path===d.which+'.longitude')f.value=d.longitude;
       sync();
       if(d.which==='a' && (input.b.latitude===''||input.b.longitude===''))activeButton('b');
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
