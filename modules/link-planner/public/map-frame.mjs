// Minimal OSM raster map. Tiles have public attribution; no inventory credentials are sent.
import {geoProject,geoUnproject,fitGeoPoints,validGeoPoint} from './model.mjs?v=0.2.2-lab.2';
const get=id=>document.getElementById(id);
const map=get('map'),tiles=get('tiles'),links=get('line'),pins=get('pins'),hint=get('hint');
let center={latitude:24,longitude:40},zoom=2,sites={},active='a',terrainHeights=null,tilesActive=new Map(),pan=null,initialFit=false;
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
   if(terrainHeights && terrainHeights.length >= 3){
     // The offset ribbon follows the A-to-B screen direction and is visibly
     // exaggerated for readability. The underlying ground samples are SRTM90.
     const dx=pts.b.x-pts.a.x,dy=pts.b.y-pts.a.y,distance=Math.hypot(dx,dy);
     if(distance>35 && distance<Math.max(rect.width,rect.height)*5){
       const nx=-dy/distance,ny=dx/distance;
       // Choose a side that keeps the elevation ribbon within the viewport.
       const mx=(pts.a.x+pts.b.x)/2,my=(pts.a.y+pts.b.y)/2;
       const preferred=(mx+nx*68<12||mx+nx*68>rect.width-12||my+ny*68<12||my+ny*68>rect.height-12)?-1:1;
       const normal={x:nx*preferred,y:ny*preferred};
       const min=Math.min(...terrainHeights),max=Math.max(...terrainHeights);
       const relief=Math.max(1,max-min);
       const base=16,amplitude=clamp(relief*0.65,12,54);
       const baseAt=t=>({x:pts.a.x+dx*t+normal.x*base,y:pts.a.y+dy*t+normal.y*base});
       const terrainAt=(height,t)=>{
         const p=baseAt(t),offset=amplitude*(height-min)/relief;
         return {x:p.x+normal.x*offset,y:p.y+normal.y*offset};
       };
       const samples=terrainHeights.map((height,i)=>terrainAt(height,i/(terrainHeights.length-1)));
       const start=baseAt(0),end=baseAt(1);
       const d='M '+samples.map(p=>p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' L ');
       const fill=d+' L '+end.x.toFixed(1)+' '+end.y.toFixed(1)+' L '+start.x.toFixed(1)+' '+start.y.toFixed(1)+' Z';
       const shape=(tag,attributes)=>{
         const element=document.createElementNS(ns,tag);
         for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
         fragment.append(element);
         return element;
       };
       shape('path',{d:fill,fill:'rgba(28,143,103,0.30)',stroke:'none','data-profile':'terrain-fill'});
       shape('path',{d,fill:'none',stroke:'#138b62','stroke-width':2.8,'stroke-linejoin':'round','data-profile':'terrain-ribbon'});
       shape('line',{x1:start.x,y1:start.y,x2:end.x,y2:end.y,stroke:'#116b58','stroke-width':1,'stroke-dasharray':'3 4'});
       const highest=terrainHeights.indexOf(max),t=highest/(terrainHeights.length-1),point=samples[highest];
       const mark=shape('circle',{cx:point.x,cy:point.y,r:3,fill:'#065f46',stroke:'white','stroke-width':1.5});
       mark.setAttribute('data-profile','highest-point');
       // Annotation makes exaggeration explicit; no claim of a surveyed 3D model.
       const label=shape('text',{x:point.x+7,y:point.y-7,fill:'#064e3b',stroke:'white','stroke-width':3,'paint-order':'stroke','font-size':11,'font-weight':700,'data-profile':'height-label'});
       label.textContent=Math.round(max)+' m · SRTM';
     }
   }
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
 if(event.origin!==location.origin||event.source!==window.parent)return;
 if(event.data?.type==='ems:planner:focus'){
   const point=sites[event.data.which];
   if(validGeoPoint(point))reposition(point,Math.max(zoom,14));
   return;
 }
 if(event.data?.type!=='ems:planner:data')return;
 const msg=event.data;
 sites={};
 for(const key of ['a','b'])if(validGeoPoint(msg[key]))sites[key]={latitude:Number(msg[key].latitude),longitude:Number(msg[key].longitude)};
 active=msg.active==='b'?'b':'a';
 // Validate all profile samples. Coordinate edits clear the overlay upstream.
 terrainHeights=Array.isArray(msg.terrainHeights)&&msg.terrainHeights.length>=3&&msg.terrainHeights.length<=100&&
   msg.terrainHeights.every(height=>typeof height==='number'&&Number.isFinite(height)&&height>=-12000&&height<=12000)
   ?msg.terrainHeights:null;
 hint.textContent=(active==='a'?'A':'B')+' · click map to set '+(active==='a'?'Site A':'Site B');
 // Picking a point edits a marker, never the viewport. Only initial data or explicit Fit may pan/zoom.
 if(msg.fit){ initialFit=true;fit(); }
 else if(!initialFit){ initialFit=true; if(Object.values(sites).some(validGeoPoint))fit();else refresh(); }
 else refresh();
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
