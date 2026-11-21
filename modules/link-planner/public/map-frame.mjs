// Minimal OSM raster map. Tiles have public attribution; no inventory credentials are sent.
import {geoProject,geoUnproject,fitGeoPoints,validGeoPoint,interpolateGreatCircle} from './model.mjs?v=0.2.2-lab.1';
const get=id=>document.getElementById(id);
const map=get('map'),tiles=get('tiles'),links=get('line'),pins=get('pins'),hint=get('hint');
let center={latitude:24,longitude:40},zoom=2,sites={},active='a',tilesActive=new Map(),pan=null;
let terrainPath=[],screenPath=[],inspectIndex=null,nearRouteIndex=null;
const probe=get('routeProbe'),probeLabel=get('routeProbeLabel');
const size=256,ns='http://www.w3.org/2000/svg';
const world=()=>size*2**zoom;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function p2screen(point,centerPixel,rect){
 const projected=geoProject(point.latitude,point.longitude,zoom);
 let dx=projected.x-centerPixel.x;
 if(dx>world()/2)dx-=world();
 if(dx< -world()/2)dx+=world();
 return {x:rect.width/2+dx,y:rect.height/2+projected.y-centerPixel.y};
}
function refresh(){
 const rect=map.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 // Plain attributes allow automated tests to detect unexpected viewport jumps.
 map.dataset.viewCenterLatitude=center.latitude.toFixed(8);
 map.dataset.viewCenterLongitude=center.longitude.toFixed(8);
 map.dataset.viewZoom=String(zoom);
 const c=geoProject(center.latitude,center.longitude,zoom),left=c.x-rect.width/2,top=c.y-rect.height/2;
 const n=2**zoom,wanted=new Set();
 let count=0;
 outer:for(let ty=Math.max(0,Math.floor(top/size));ty<=Math.min(n-1,Math.ceil((top+rect.height)/size));ty++){
   for(let tx=Math.floor(left/size);tx<=Math.ceil((left+rect.width)/size);tx++){
     if(count++>40)break outer;
     const wrapped=((tx%n)+n)%n,key=zoom+'/'+wrapped+'/'+ty+'@'+tx;
     wanted.add(key);
     let tile=tilesActive.get(key);
     if(!tile){tile=document.createElement('img');tile.className='tile';tile.alt='';tile.decoding='async';tile.src='https://tile.openstreetmap.org/'+zoom+'/'+wrapped+'/'+ty+'.png';tilesActive.set(key,tile);tiles.append(tile);}
     tile.style.left=tx*size-left+'px';tile.style.top=ty*size-top+'px';
   }
 }
 for(const [key,tile] of tilesActive)if(!wanted.has(key)){tile.remove();tilesActive.delete(key);}
 links.setAttribute('viewBox','0 0 '+rect.width+' '+rect.height);
 const fragment=document.createDocumentFragment();
 const pts={};
 for(const key of ['a','b'])if(validGeoPoint(sites[key]))pts[key]=p2screen(sites[key],c,rect);
 const basePath=pts.a&&pts.b?interpolateGreatCircle(sites.a,sites.b,81):[];
 const complete=terrainPath.length===basePath.length && basePath.length>0;
 const route=complete?terrainPath:basePath;
 screenPath=route.map(point=>p2screen(point,c,rect));
 for(let i=1;i<screenPath.length;i++){
   const a=screenPath[i-1],b=screenPath[i],known=complete;
   const obstruction=known&&(terrainPath[i-1].clearanceM<0||terrainPath[i].clearanceM<0);
   const line=document.createElementNS(ns,'line');
   for(const [k,v] of Object.entries({
     x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:!known?'#ed7830':obstruction?'#d43c43':'#18986a',
     'stroke-width':known?4:3,'stroke-linecap':'round','data-route-segment':i,
     'data-obstructed':obstruction?'true':'false'
   }))line.setAttribute(k,v);
   if(!known)line.setAttribute('stroke-dasharray','9 5');
   fragment.append(line);
 }
 links.replaceChildren(fragment);
 updateProbe(rect);
 const symbols=document.createDocumentFragment();
 for(const key of ['a','b']){
   if(!pts[key])continue;
   const pin=document.createElement('button');pin.type='button';pin.className='planner-pin '+key;
   pin.style.left=pts[key].x+'px';pin.style.top=pts[key].y+'px';pin.textContent=key.toUpperCase();
   pin.title=(key==='a'?'Site A':'Site B')+' · '+sites[key].latitude.toFixed(5)+', '+sites[key].longitude.toFixed(5);
   pin.addEventListener('pointerdown',e=>e.stopPropagation());
   pin.addEventListener('click',e=>{e.stopPropagation();window.parent.postMessage({type:'ems:planner:select',which:key},location.origin);});
   symbols.append(pin);
 }
 pins.replaceChildren(symbols);
}
function updateProbe(rect=map.getBoundingClientRect()){
 if(inspectIndex===null || !terrainPath[inspectIndex] || !screenPath[inspectIndex]){
   probe.style.display='none';probeLabel.style.display='none';return;
 }
 const value=terrainPath[inspectIndex],p=screenPath[inspectIndex],obstructed=value.clearanceM<0;
 probe.style.display='block';
 probe.style.left=p.x+'px';probe.style.top=p.y+'px';
 probe.classList.toggle('obstructed',obstructed);
 probe.dataset.index=String(inspectIndex);
 probeLabel.style.display='block';
 probeLabel.style.left=clamp(p.x+15,5,Math.max(5,rect.width-205))+'px';
 probeLabel.style.top=clamp(p.y-73,5,Math.max(5,rect.height-60))+'px';
 probeLabel.classList.toggle('obstructed',obstructed);
 probeLabel.dataset.index=String(inspectIndex);
 probeLabel.textContent=(obstructed?'⚠ مانع احتمالی':'✓ مسیر آزاد در نمونه')+' · '+value.distanceKm.toFixed(2)+' km'+
   ' · ارتفاع زمین '+value.groundM.toFixed(1)+' m'+
   ' · فاصله آزاد '+value.clearanceM.toFixed(1)+' m';
}
function inspectRoute(index,notify=false){
 const next=Number.isInteger(index)&&index>=0&&index<terrainPath.length?index:null;
 if(inspectIndex===next)return;
 inspectIndex=next;
 updateProbe();
 if(notify)window.parent.postMessage({type:'ems:planner:inspect-changed',index:next},location.origin);
}
function closestRouteSample(e){
 if(!terrainPath.length||!screenPath.length)return null;
 const rect=map.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
 let bestDistance=Infinity,bestIndex=null;
 for(let i=1;i<screenPath.length;i++){
   const a=screenPath[i-1],b=screenPath[i],vx=b.x-a.x,vy=b.y-a.y;
   const ratio=clamp(((x-a.x)*vx+(y-a.y)*vy)/Math.max(1,vx*vx+vy*vy),0,1);
   const dx=x-a.x-vx*ratio,dy=y-a.y-vy*ratio;
   const dist=Math.hypot(dx,dy);
   if(dist<bestDistance){bestDistance=dist;bestIndex=ratio>=.5?i:i-1;}
 }
 return bestDistance<=16?bestIndex:null;
}

function reposition(point,z=zoom){
 center.latitude=clamp(point.latitude,-85.05,85.05);center.longitude=((point.longitude+180)%360+360)%360-180;
 zoom=clamp(z,2,18);refresh();
}
function fit(){
 const rect=map.getBoundingClientRect(),valid=[sites.a,sites.b].filter(validGeoPoint);
 const view=fitGeoPoints(valid,rect.width,rect.height,{padding:75});
 if(view)reposition(view,view.zoom);
 else reposition(center,zoom);
}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==window.parent)return;
 if(event.data?.type==='ems:planner:inspect'){
   inspectRoute(event.data.index);
   return;
 }
 if(event.data?.type==='ems:planner:focus'){
   const point=sites[event.data.which];
   if(validGeoPoint(point))reposition(point,Math.max(zoom,14));
   return;
 }
 if(event.data?.type!=='ems:planner:data')return;
 const msg=event.data;
 sites={};
 for(const key of ['a','b'])if(validGeoPoint(msg[key]))sites[key]={latitude:Number(msg[key].latitude),longitude:Number(msg[key].longitude)};
 const validTerrain=Array.isArray(msg.path)&&msg.path.length===81&&
  msg.path.every(point=>validGeoPoint(point)&&['distanceKm','groundM','lineM','requiredM','clearanceM'].every(key=>Number.isFinite(point[key])));
 terrainPath=validTerrain?msg.path.map(point=>({
   latitude:Number(point.latitude),longitude:Number(point.longitude),distanceKm:point.distanceKm,
   groundM:point.groundM,lineM:point.lineM,requiredM:point.requiredM,clearanceM:point.clearanceM
 })): [];
 if(!terrainPath.length)inspectIndex=null;
 active=msg.active==='b'?'b':'a';
 hint.textContent=(active==='a'?'A':'B')+' · click map to set '+(active==='a'?'Site A':'Site B');
 // Changing A/B is a marker update only. Even the first click must never zoom/pan.
 // Parent sends fit:true only at initial mount or through the explicit Fit A+B control.
 if(msg.fit)fit();
 else refresh();
});
map.addEventListener('pointerdown',e=>{
 if(e.button!==0||e.target.closest('#controls')||e.target.closest('#credit'))return;
 pan={x:e.clientX,y:e.clientY,old:{...center},pointer:e.pointerId,drag:false};
 inspectRoute(null,true);
 map.setPointerCapture(e.pointerId);
});
map.addEventListener('pointermove',e=>{
 if(!pan||e.pointerId!==pan.pointer){
   nearRouteIndex=closestRouteSample(e);
   inspectRoute(nearRouteIndex,true);
   return;
 }
 if(Math.hypot(e.clientX-pan.x,e.clientY-pan.y)>5)pan.drag=true;
 if(!pan.drag)return;
 map.classList.add('dragging');
 const c=geoProject(pan.old.latitude,pan.old.longitude,zoom);
 // Drag the map by pixels; inverse projection uses the same longitude origin as geoProject.
 center=geoUnproject(c.x+pan.x-e.clientX,c.y+pan.y-e.clientY,zoom);
 refresh();
});
map.addEventListener('pointerup',e=>{
 if(!pan||e.pointerId!==pan.pointer)return;
 const dragged=pan.drag;pan=null;map.classList.remove('dragging');
 if(dragged)return;
 const near=closestRouteSample(e);
 if(near!==null){inspectRoute(near,true);return;}
 const rect=map.getBoundingClientRect(),c=geoProject(center.latitude,center.longitude,zoom);
 const picked=geoUnproject(c.x+e.clientX-rect.left-rect.width/2,c.y+e.clientY-rect.top-rect.height/2,zoom);
 window.parent.postMessage({type:'ems:planner:pick',which:active,latitude:Number(picked.latitude.toFixed(6)),longitude:Number(picked.longitude.toFixed(6))},location.origin);
});
map.addEventListener('pointercancel',()=>{pan=null;map.classList.remove('dragging');});
map.addEventListener('pointerleave',()=>{if(!pan)inspectRoute(null,true);});

function zoomAt(clientX,clientY,direction){
  const rect=map.getBoundingClientRect();
  const next=clamp(zoom+direction,2,18);
  if(next===zoom)return;
  // Keep the point underneath the mouse exactly fixed while zooming.
  const offsetX=clientX-rect.left-rect.width/2,offsetY=clientY-rect.top-rect.height/2;
  const oldCenter=geoProject(center.latitude,center.longitude,zoom);
  const anchorPoint=geoUnproject(oldCenter.x+offsetX,oldCenter.y+offsetY,zoom);
  const anchorPixel=geoProject(anchorPoint.latitude,anchorPoint.longitude,next);
  reposition(geoUnproject(anchorPixel.x-offsetX,anchorPixel.y-offsetY,next),next);
}
map.addEventListener('wheel',event=>{
  event.preventDefault();
  zoomAt(event.clientX,event.clientY,event.deltaY<0?1:-1);
},{passive:false});
map.addEventListener('dblclick',event=>{
  event.preventDefault();
  zoomAt(event.clientX,event.clientY,1);
});

get('zoomIn').addEventListener('click',()=>reposition(center,zoom+1));
get('zoomOut').addEventListener('click',()=>reposition(center,zoom-1));
get('fit').addEventListener('click',fit);
window.addEventListener('resize',refresh);
window.parent.postMessage({type:'ems:planner:ready'},location.origin);
refresh();
