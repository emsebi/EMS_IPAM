// Physical-location UI for documented radio hosts.
// Does not change or poll equipment. Coordinates are optional.
export function createGeoUi({request,escapeHtml,canWrite,toast,state,onRefresh}) {
 const esc=value=>escapeHtml(String(value??''));
 const cache=new Map(),loading=new Set();
 let currentTarget='';
 const lang=()=>String(document.documentElement.lang||'en').startsWith('fa');
 const L=(english,persian)=>lang()?persian:english;
 const validPoint=(p)=>p&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude));

 function load(apId) {
   if(!apId||cache.has(apId)||loading.has(apId))return;
   loading.add(apId);
   request('/api/radio/locations?apId='+encodeURIComponent(apId))
    .then(result=>{cache.set(apId,new Map((result.items||[]).map(item=>[item.hostId,item])));if(state.view==='radios'&&state.selectedRadioApId===apId)onRefresh();})
    .catch(error=>{cache.set(apId,new Map());toast(error.message);})
    .finally(()=>loading.delete(apId));
 }
 function content({ap,stations=[]}) {
  if(!ap)return '';
  const targets=[ap,...stations];
  if(!targets.some(t=>t.id===currentTarget))currentTarget=ap.id;
  const point=cache.get(ap.id)?.get(currentTarget);
  const options=targets.map(t=>'<option value="'+esc(t.id)+'"'+(currentTarget===t.id?' selected':'')+'>'+esc((t.radioMode==='ap'?'AP':'Station')+' · '+(t.name||t.ip))+'</option>').join('');
  return '<section class="panel radio-geo-panel" aria-label="'+esc(L('Device geographic locations','موقعیت جغرافیایی تجهیزات'))+'">'+
   '<div class="radio-geo-header"><div><h3>'+esc(L('AP and Station locations','موقعیت AP و Station'))+'</h3><p>'+esc(L('Choose a device, click the map or enter its latitude and longitude. Changes are saved only when you press Save.','دستگاه را انتخاب کنید، روی نقشه بزنید یا مختصات را وارد کنید. فقط با دکمه ذخیره ثبت می‌شود.'))+'</p></div></div>'+
   '<div class="radio-geo-controls"><label>'+esc(L('Device','دستگاه'))+'<select id="radioGeoTarget">'+options+'</select></label>'+
   '<label>Latitude<input id="radioGeoLatitude" class="ltr mono" type="number" min="-90" max="90" step="0.000001" value="'+esc(point?.latitude??'')+'" placeholder="35.689200"></label>'+
   '<label>Longitude<input id="radioGeoLongitude" class="ltr mono" type="number" min="-180" max="180" step="0.000001" value="'+esc(point?.longitude??'')+'" placeholder="51.389000"></label>'+
   (canWrite()?'<button class="btn primary sm" type="button" id="radioGeoSave">'+esc(L('Save location','ذخیره موقعیت'))+'</button>'+
    '<button class="btn sm" type="button" id="radioGeoClear">'+esc(L('Clear','پاک کردن'))+'</button>':'')+
   '<a class="btn sm" id="radioGeoExternal" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/">'+esc(L('Open online map','نمایش در نقشه آنلاین'))+'</a></div>'+
   '<iframe id="radioGeoFrame" src="/api/radio/map" loading="lazy" title="'+esc(L('OpenStreetMap location picker','انتخاب موقعیت روی OpenStreetMap'))+'"></iframe>'+
   '<small class="radio-geo-note">'+esc(L('Only documented positions are shown. Tile images need internet access; coordinates still work offline. Map data © OpenStreetMap contributors.','فقط موقعیت‌های ثبت‌شده نشان داده می‌شوند. تصاویر نقشه اینترنت می‌خواهند؛ ثبت مختصات بدون اینترنت هم کار می‌کند.'))+'</small>'+
   '</section>';
 }
 function attach({ap,stations=[]}) {
  if(!ap)return;
  load(ap.id);
  const targets=[ap,...stations],sel=document.getElementById('radioGeoTarget'),lat=document.getElementById('radioGeoLatitude'),lon=document.getElementById('radioGeoLongitude'),frame=document.getElementById('radioGeoFrame'),external=document.getElementById('radioGeoExternal');
  if(!sel||!lat||!lon||!frame)return;
  const record=()=>cache.get(ap.id)?.get(currentTarget);
  function validInput() {
    if(!lat.value.trim()||!lon.value.trim())return null;
    const a=Number(lat.value),b=Number(lon.value);
    return Number.isFinite(a)&&Number.isFinite(b)&&a>=-90&&a<=90&&b>=-180&&b<=180?{latitude:a,longitude:b}:null;
  }
  function externalUrl() {
    const point=validInput()||record();
    const url=point?'https://www.openstreetmap.org/#map=15/'+point.latitude+'/'+point.longitude:'https://www.openstreetmap.org/';
    external.href=url;
  }
  function sendMap(recenter=false) {
    const markers=targets.map(t=>{
      const position=t.id===currentTarget?(validInput()||record()):cache.get(ap.id)?.get(t.id);
      return position&&validPoint(position)?{id:t.id,name:t.name||t.ip,role:t.radioMode==='ap'?'ap':'station',latitude:Number(position.latitude),longitude:Number(position.longitude)}:null;
    }).filter(Boolean);
    frame.contentWindow?.postMessage({type:'ems:radio:geo:data',markers,selectedId:currentTarget,recenter,hint:L('Click map to position selected device','برای تعیین موقعیت دستگاه انتخاب‌شده روی نقشه کلیک کنید')},location.origin);
    externalUrl();
  }
  const selectTarget=id=>{
    if(!targets.some(t=>t.id===id))return;
    currentTarget=id;
    sel.value=id;
    const point=record();
    lat.value=point?.latitude??'';
    lon.value=point?.longitude??'';
    sendMap(true);
  };
  sel.addEventListener('change',()=>selectTarget(sel.value));
  lat.addEventListener('input',()=>sendMap());
  lon.addEventListener('input',()=>sendMap());
  frame.addEventListener('load',()=>sendMap());
  window.radioGeoMessageHandler=(event)=>{
    if(state.view!=='radios'||state.selectedRadioApId!==ap.id||event.origin!==location.origin||event.source!==frame.contentWindow)return;
    const message=event.data||{};
    if(message.type==='ems:radio:geo:ready')sendMap();
    if(message.type==='ems:radio:geo:select')selectTarget(message.id);
    if(message.type==='ems:radio:geo:pick'&&canWrite()){
      const {latitude,longitude}=message;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return;
      lat.value=latitude.toFixed(6);lon.value=longitude.toFixed(6);
      sendMap();
    }
  };
  document.getElementById('radioGeoSave')?.addEventListener('click',async()=>{
    const point=validInput();
    if(!point)return toast(L('Enter valid latitude and longitude first.','مختصات عرض و طول معتبر وارد کنید.'));
    const button=document.getElementById('radioGeoSave'),targetId=currentTarget;button.disabled=true;
    try{
      const answer=await request('/api/radio/location',{method:'PUT',body:{hostId:targetId,...point}});
      const next=cache.get(ap.id)||new Map();next.set(targetId,answer.item);cache.set(ap.id,next);
      toast(L('Location saved.','موقعیت ذخیره شد.'));
      if(currentTarget===targetId)sendMap();
    }catch(error){toast(error.message);}finally{button.disabled=false;}
  });
  document.getElementById('radioGeoClear')?.addEventListener('click',async()=>{
    const button=document.getElementById('radioGeoClear'),targetId=currentTarget;button.disabled=true;
    try{
      await request('/api/radio/location',{method:'PUT',body:{hostId:targetId,latitude:null,longitude:null}});
      cache.get(ap.id)?.delete(targetId);
      if(currentTarget===targetId){lat.value='';lon.value='';sendMap();}
      toast(L('Location cleared.','موقعیت پاک شد.'));
    }catch(error){toast(error.message);}finally{button.disabled=false;}
  });
  sendMap();
 }
 // A single event listener is retained while this module is active, replacing only the callback on rerenders.
 window.addEventListener('message',event=>window.radioGeoMessageHandler?.(event));
 return {content,attach,load};
}
