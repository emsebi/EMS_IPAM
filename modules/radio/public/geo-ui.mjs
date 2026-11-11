import {distanceMeters,formatDistance,validGeoPoint} from './geo-math.mjs?v=2.3.0';

// Radio documentation only: the requests below read existing IPAM/PostgreSQL records.
// Never SSH/SNMP/poll any radio. AP visibility and the selected AP for editing are separate.
export function createGeoUi({request,escapeHtml,canWrite,toast,state,onOpenAp}) {
 const esc=value=>escapeHtml(String(value??''));
 const cache=new Map(),loading=new Set(),failures=new Set(),pending=[];
 const shownAps=new Set(),hiddenStations=new Set();
 let initializedSelection=false,activeRequests=0,currentTarget='',activeAp='',liveRefresh=()=>{};
 const lang=()=>String(document.documentElement.lang||'en').startsWith('fa');
 const L=(english,persian)=>lang()?persian:english;
 const getOwner=device=>device?.radioMode==='ap'?device.id:device?.radioParentHostId;
 const selectedCount=()=>shownAps.size;
 const displayName=device=>device.name||device.ip||device.id;

 function drain(){
   while(activeRequests<4 && pending.length){
     const apId=pending.shift();activeRequests++;
     request('/api/radio/locations?apId='+encodeURIComponent(apId))
       .then(result=>{cache.set(apId,new Map((result.items||[]).map(item=>[item.hostId,item])));failures.delete(apId);})
       .catch(error=>{failures.add(apId);toast(error.message);})
       .finally(()=>{loading.delete(apId);activeRequests--;liveRefresh();drain();});
   }
 }
 function load(apId){
   if(!apId||cache.has(apId)||loading.has(apId)||failures.has(apId))return;
   loading.add(apId);pending.push(apId);drain();
 }
 function openAp(apId){
   if(apId){shownAps.add(apId);currentTarget=apId;activeAp=apId;load(apId);}
 }
 function normalize({ap,aps=[]}){
   const allowed=new Set(aps.map(item=>item.id));
   for(const id of shownAps)if(!allowed.has(id))shownAps.delete(id);
   if(!initializedSelection&&ap){shownAps.add(ap.id);initializedSelection=true;}
   if(ap&&activeAp!==ap.id){
     activeAp=ap.id;
     if(!currentTarget)currentTarget=ap.id;
   }
   if(ap)load(ap.id);
   for(const id of shownAps)load(id);
 }
 function content({ap,stations=[],aps=[],allStations=[]}){
   if(!ap)return '';
   normalize({ap,aps});
   const targets=[ap,...stations];
   if(!targets.some(t=>t.id===currentTarget))currentTarget=ap.id;
   const position=cache.get(getOwner(targets.find(t=>t.id===currentTarget)))?.get(currentTarget);
   const options=targets.map(t=>'<option value="'+esc(t.id)+'"'+(currentTarget===t.id?' selected':'')+'>'+esc((t.radioMode==='ap'?'AP':'Station')+' · '+displayName(t))+'</option>').join('');
   const groups=aps.map(item=>{
     const count=allStations.filter(st=>st.radioParentHostId===item.id).length;
     const checked=shownAps.has(item.id);
     return '<div class="radio-map-ap-group"><div class="radio-map-ap-row">'+
      '<label class="radio-map-check"><input type="checkbox" class="radio-map-choose-ap" data-id="'+esc(item.id)+'" '+(checked?'checked ':'')+'aria-label="'+esc(L('Show AP on map','نمایش AP روی نقشه')+' '+displayName(item))+'"></label>'+
      '<button type="button" class="radio-map-open-ap'+(ap.id===item.id?' active':'')+'" data-id="'+esc(item.id)+'"><strong>'+esc(displayName(item))+'</strong><small class="ltr mono">'+esc(item.ip||'')+' · '+esc(count)+' ST</small></button>'+
      '</div>'+
      (count?'<div class="radio-map-stations">'+allStations.filter(st=>st.radioParentHostId===item.id).map(st=>
        '<label class="radio-map-st-row"><input type="checkbox" class="radio-map-choose-station" data-id="'+esc(st.id)+'" '+(!hiddenStations.has(st.id)?'checked ':'')+(!checked?'disabled ':'')+'><span>'+esc(displayName(st))+'</span></label>'
       ).join('')+'</div>':'')+'</div>';
   }).join('');
   return '<section class="panel radio-geo-panel" aria-label="'+esc(L('Radio geographic documentation','نقشه مستندسازی رادیو'))+'">'+
     '<div class="radio-geo-header"><div><h3>'+esc(L('Radio locations and links','موقعیت و ارتباط رادیوها'))+'</h3><p>'+esc(L('Select one or more AP groups on the right; each Station connects only to its recorded parent AP.','یک یا چند AP را از ستون کناری انتخاب کنید؛ هر Station فقط به AP ثبت‌شده خودش وصل می‌شود.'))+'</p></div></div>'+
     '<div class="radio-geo-layout">'+
       '<div class="radio-map-main"><div class="radio-map-toolbar"><strong>'+esc(L('Geographic map','نقشه جغرافیایی'))+'</strong><span id="radioMapSelectedCount">'+esc(selectedCount())+' AP</span></div>'+
       '<iframe id="radioGeoFrame" src="/api/radio/map" loading="eager" title="'+esc(L('OpenStreetMap radio location map','نقشه موقعیت رادیوها'))+'"></iframe>'+
       '<small class="radio-geo-note">'+esc(L('Blue = AP · Green = Station · Lines and labels are straight-line GPS distance, not RF measurements. OpenStreetMap needs internet for tiles.','آبی = AP · سبز = Station · خطوط فاصله مستقیم GPS هستند، نه کیفیت رادیو. تصویر زمینه به اینترنت نیاز دارد.'))+'</small>'+
       '<div id="radioGeoDistances" class="radio-geo-distances" aria-live="polite"></div></div>'+
       '<aside class="radio-map-aside"><div class="radio-map-side-header"><strong>'+esc(L('APs on map','APهای روی نقشه'))+'</strong><span>'+esc(aps.length)+' AP</span></div>'+
       '<div class="radio-map-side-actions"><button type="button" id="radioMapAll" class="btn sm">'+esc(L('Show all','نمایش همه'))+'</button><button type="button" id="radioMapNone" class="btn sm">'+esc(L('Hide all','مخفی کردن همه'))+'</button></div>'+
       '<div class="radio-map-selection" aria-label="'+esc(L('Select APs and Stations to show on map','انتخاب AP و Station برای نمایش روی نقشه'))+'">'+(groups||esc(L('No AP registered','AP ثبت نشده است')))+'</div>'+
       '<div class="radio-map-location-editor"><h4>'+esc(L('Edit device location','ثبت موقعیت دستگاه'))+'</h4>'+
       '<label>'+esc(L('Device in open AP','دستگاه AP انتخاب‌شده'))+'<select id="radioGeoTarget">'+options+'</select></label>'+
       '<div class="radio-map-coordinates"><label>Latitude<input id="radioGeoLatitude" class="ltr mono" type="number" min="-90" max="90" step="0.000001" value="'+esc(position?.latitude??'')+'" placeholder="35.689200"></label>'+
       '<label>Longitude<input id="radioGeoLongitude" class="ltr mono" type="number" min="-180" max="180" step="0.000001" value="'+esc(position?.longitude??'')+'" placeholder="51.389000"></label></div>'+
       '<div class="radio-map-location-actions">'+(canWrite()?'<button class="btn primary sm" type="button" id="radioGeoSave">'+esc(L('Save location','ذخیره موقعیت'))+'</button><button class="btn sm" type="button" id="radioGeoClear">'+esc(L('Clear','پاک کردن'))+'</button>':'')+
       '<a class="btn sm" id="radioGeoExternal" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/">'+esc(L('Open in OSM','نمایش در نقشه'))+'</a></div></div></aside>'+
     '</div></section>';
 }
 function attach({ap,stations=[],aps=[],allStations=[]}){
   if(!ap)return;
   normalize({ap,aps});
   const visibleIds=new Set(aps.map(a=>a.id));
   const targets=[ap,...stations],allDevices=[...aps,...allStations];
   const known=new Map(allDevices.map(item=>[item.id,item]));
   const sel=document.getElementById('radioGeoTarget'),lat=document.getElementById('radioGeoLatitude'),lon=document.getElementById('radioGeoLongitude'),frame=document.getElementById('radioGeoFrame'),external=document.getElementById('radioGeoExternal');
   if(!sel||!lat||!lon||!frame)return;
   const selectedDevice=()=>known.get(currentTarget);
   const record=()=>cache.get(getOwner(selectedDevice()))?.get(currentTarget);
   function validInput(){
     if(!lat.value.trim()||!lon.value.trim())return null;
     const a=Number(lat.value),b=Number(lon.value);
     return Number.isFinite(a)&&Number.isFinite(b)&&a>=-90&&a<=90&&b>=-180&&b<=180?{latitude:a,longitude:b}:null;
   }
   const positionFor=device=>{
     if(device.id===currentTarget) return validInput()||record();
     return cache.get(getOwner(device))?.get(device.id);
   };
   function updateDistances(){
     const box=document.getElementById('radioGeoDistances');if(!box)return;
     const items=[];
     for(const parent of aps){
       if(!shownAps.has(parent.id))continue;
       const source=positionFor(parent);
       for(const st of allStations){
         if(st.radioParentHostId!==parent.id||hiddenStations.has(st.id))continue;
         const destination=positionFor(st);
         const meters=source&&destination?distanceMeters(source,destination):null;
         items.push('<span class="radio-geo-distance-item"><strong>'+esc(displayName(parent))+' → '+esc(displayName(st))+'</strong> · '+esc(meters===null?'—':formatDistance(meters))+'</span>');
       }
     }
     box.innerHTML='<strong>'+esc(L('Documented GPS distances','فاصله‌های GPS ثبت‌شده'))+'</strong><div>'+(items.length?items.join(''):'<small>'+esc(L('Choose an AP to see its links.','برای نمایش ارتباطات یک AP انتخاب کنید.'))+'</small>')+'</div>';
   }
   function externalUrl(){
     const position=validInput()||record();
     external.href=position?'https://www.openstreetmap.org/#map=15/'+position.latitude+'/'+position.longitude:'https://www.openstreetmap.org/';
   }
   function sendMap(recenter=false){
     const markers=[];
     for(const parent of aps){
       if(!shownAps.has(parent.id))continue;
       const devices=[parent,...allStations.filter(st=>st.radioParentHostId===parent.id&&!hiddenStations.has(st.id))];
       for(const device of devices){
         const point=positionFor(device);
         if(!validGeoPoint(point))continue;
         markers.push({id:device.id,name:displayName(device),role:device.radioMode==='ap'?'ap':'station',parentId:device.radioMode==='station'?device.radioParentHostId:'',latitude:Number(point.latitude),longitude:Number(point.longitude)});
       }
     }
     frame.contentWindow?.postMessage({type:'ems:radio:geo:data',markers,selectedId:currentTarget,recenter,hint:L('Click to edit selected position · select APs on the right','برای ویرایش موقعیت کلیک کنید · APها را از سمت راست انتخاب کنید')},location.origin);
     const count=document.getElementById('radioMapSelectedCount');
     if(count)count.textContent=shownAps.size+' AP · '+markers.filter(m=>m.role==='station').length+' ST';
     externalUrl();updateDistances();
   }
   liveRefresh=()=>{if(state.view==='radios'&&state.selectedRadioApId===ap.id&&document.getElementById('radioGeoFrame')===frame)sendMap();};
   function selectTarget(id){
     if(!targets.some(t=>t.id===id))return;
     currentTarget=id;sel.value=id;
     const point=record();lat.value=point?.latitude??'';lon.value=point?.longitude??'';
     sendMap(true);
   }
   function updateChecks(){
     document.querySelectorAll('.radio-map-choose-ap').forEach(input=>{
       const checked=shownAps.has(input.dataset.id);input.checked=checked;
       const group=input.closest('.radio-map-ap-group');
       group?.querySelectorAll('.radio-map-choose-station').forEach(st=>st.disabled=!checked);
     });
     document.querySelectorAll('.radio-map-choose-station').forEach(input=>{input.checked=!hiddenStations.has(input.dataset.id);});
   }
   document.querySelectorAll('.radio-map-choose-ap').forEach(input=>input.addEventListener('change',()=>{
     const id=input.dataset.id;
     if(!visibleIds.has(id))return;
     if(input.checked){shownAps.add(id);load(id);}else shownAps.delete(id);
     updateChecks();sendMap(true);
   }));
   document.querySelectorAll('.radio-map-choose-station').forEach(input=>input.addEventListener('change',()=>{
     const device=known.get(input.dataset.id);
     if(!device||!shownAps.has(device.radioParentHostId))return;
     if(input.checked)hiddenStations.delete(device.id);else hiddenStations.add(device.id);
     sendMap(true);
   }));
   document.getElementById('radioMapAll')?.addEventListener('click',()=>{
     for(const item of aps){shownAps.add(item.id);load(item.id);}
     hiddenStations.clear();updateChecks();sendMap(true);
   });
   document.getElementById('radioMapNone')?.addEventListener('click',()=>{
     shownAps.clear();updateChecks();sendMap(true);
   });
   document.querySelectorAll('.radio-map-open-ap').forEach(button=>button.addEventListener('click',()=>{
     const id=button.dataset.id;
     if(!visibleIds.has(id))return;
     openAp(id);onOpenAp(id);
   }));
   sel.addEventListener('change',()=>selectTarget(sel.value));
   lat.addEventListener('input',()=>sendMap());
   lon.addEventListener('input',()=>sendMap());
   frame.addEventListener('load',()=>sendMap());
   window.radioGeoMessageHandler=(event)=>{
     if(state.view!=='radios'||state.selectedRadioApId!==ap.id||event.origin!==location.origin||event.source!==frame.contentWindow)return;
     const message=event.data||{};
     if(message.type==='ems:radio:geo:ready')sendMap();
     if(message.type==='ems:radio:geo:select'){
       const device=known.get(message.id);
       if(!device)return;
       const owner=getOwner(device);
       if(!visibleIds.has(owner))return;
       if(owner!==ap.id){currentTarget=device.id;openAp(owner);currentTarget=device.id;onOpenAp(owner);}
       else selectTarget(device.id);
     }
     if(message.type==='ems:radio:geo:pick'&&canWrite()){
       const {latitude,longitude}=message;
       if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return;
       lat.value=latitude.toFixed(6);lon.value=longitude.toFixed(6);sendMap();
     }
   };
   document.getElementById('radioGeoSave')?.addEventListener('click',async()=>{
     const point=validInput();
     if(!point)return toast(L('Enter valid latitude and longitude.','عرض و طول جغرافیایی معتبر وارد کنید.'));
     const targetId=currentTarget,owner=getOwner(selectedDevice()),button=document.getElementById('radioGeoSave');
     button.disabled=true;
     try{
       const answer=await request('/api/radio/location',{method:'PUT',body:{hostId:targetId,...point}});
       const saved=cache.get(owner)||new Map();saved.set(targetId,answer.item);cache.set(owner,saved);
       toast(L('Location saved.','موقعیت ذخیره شد.'));sendMap();
     }catch(error){toast(error.message);}finally{button.disabled=false;}
   });
   document.getElementById('radioGeoClear')?.addEventListener('click',async()=>{
     const targetId=currentTarget,owner=getOwner(selectedDevice()),button=document.getElementById('radioGeoClear');
     button.disabled=true;
     try{
       await request('/api/radio/location',{method:'PUT',body:{hostId:targetId,latitude:null,longitude:null}});
       cache.get(owner)?.delete(targetId);
       if(currentTarget===targetId){lat.value='';lon.value='';sendMap();}
       toast(L('Location cleared.','موقعیت پاک شد.'));
     }catch(error){toast(error.message);}finally{button.disabled=false;}
   });
   sendMap();
 }
 window.addEventListener('message',event=>window.radioGeoMessageHandler?.(event));
 return {content,attach,openAp,load};
}
