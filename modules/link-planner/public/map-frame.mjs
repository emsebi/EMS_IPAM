// Minimal OSM raster map. Tiles have public attribution; no inventory credentials are sent.
import {geoProject,geoUnproject,fitGeoPoints,validGeoPoint} from '../../radio/public/geo-math.mjs';
const get=id=>document.getElementById(id);
const map=get('map'),tiles=get('tiles'),links=get('line'),pins=get('pins'),hint=get('hint');
let center={latitude:24,longitude:40},zoom=2,sites={},active='a',tilesActive=new Map(),pan=null;
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
 if(pts.a&&pts.b){
   const line=document.createElementNS(ns,'line');
   for(const [k,v] of Object.entries({x1:pts.a.x,y1:pts.a.y,x2:pts.b.x,y2:pts.b.y,stroke:'#ed7830','stroke-width':3,'stroke-linecap':'round','stroke-dasharray':'9 5'}))line.setAttribute(k,v);
   fragment.append(line);
 }
 links.replaceChildren(fragment);
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
 if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='ems:planner:data')return;
 const msg=event.data;
 const previous=JSON.stringify(sites);
 sites={};
 for(const key of ['a','b'])if(validGeoPoint(msg[key]))sites[key]={latitude:Number(msg[key].latitude),longitude:Number(msg[key].longitude)};
 active=msg.active==='b'?'b':'a';
 hint.textContent=(active==='a'?'A':'B')+' · click map to set '+(active==='a'?'Site A':'Site B');
 if(previous!==JSON.stringify(sites)||msg.fit)fit();else refresh();
});
map.addEventListener('pointerdown',e=>{
 if(e.button!==0||e.target.closest('#controls')||e.target.closest('#credit'))return;
 pan={x:e.clientX,y:e.clientY,old:{...center},pointer:e.pointerId,drag:false};
 map.setPointerCapture(e.pointerId);
});
map.addEventListener('pointermove',e=>{
 if(!pan||e.pointerId!==pan.pointer)return;
 if(Math.hypot(e.clientX-pan.x,e.clientY-pan.y)>5)pan.drag=true;
 if(!pan.drag)return;
 const c=geoProject(pan.old.latitude,pan.old.longitude,zoom);
 center=geoUnproject(c.x+pan.x-e.clientX,c.y+pan.y-e.clientY,zoom);refresh();
});
map.addEventListener('pointerup',e=>{
 if(!pan||e.pointerId!==pan.pointer)return;
 const dragged=pan.drag;pan=null;
 if(dragged)return;
 const rect=map.getBoundingClientRect(),c=geoProject(center.latitude,center.longitude,zoom);
 const picked=geoUnproject(c.x+e.clientX-rect.left-rect.width/2,c.y+e.clientY-rect.top-rect.height/2,zoom);
 window.parent.postMessage({type:'ems:planner:pick',which:active,latitude:Number(picked.latitude.toFixed(6)),longitude:Number(picked.longitude.toFixed(6))},location.origin);
});
map.addEventListener('pointercancel',()=>pan=null);
get('zoomIn').addEventListener('click',()=>reposition(center,zoom+1));
get('zoomOut').addEventListener('click',()=>reposition(center,zoom-1));
get('fit').addEventListener('click',fit);
window.addEventListener('resize',fit);
window.parent.postMessage({type:'ems:planner:ready'},location.origin);
refresh();
