// Lightweight raster map: no dependencies, location requests, devices or scans.
// Only visible OSM tiles are loaded; browser caching is kept enabled.
const el = (id) => document.getElementById(id);
const map=el('radioMap'), tiles=el('radioTiles'), pins=el('radioPins');
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const maxLat=85.05112878, size=256;
let center={latitude:0,longitude:0},zoom=2,markers=[],selectedId='',initialized=false;
let pan=null;

function project(latitude,longitude,z=zoom) {
 const scale=size*2**z,lat=clamp(latitude,-maxLat,maxLat)*Math.PI/180;
 return {x:(longitude+180)/360*scale,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*scale};
}
function unproject(x,y,z=zoom) {
 const scale=size*2**z;
 const lon=((x/scale)*360)-180;
 const n=Math.PI-2*Math.PI*(y/scale);
 return {latitude:clamp(Math.atan(Math.sinh(n))*180/Math.PI,-90,90),longitude:((lon+180)%360+360)%360-180};
}
function atPixel(x,y) {
 const r=map.getBoundingClientRect(),p=project(center.latitude,center.longitude);
 return unproject(p.x+x-r.width/2,p.y+y-r.height/2);
}
function show() {
 const r=map.getBoundingClientRect();
 if(!r.width||!r.height)return;
 const centerPx=project(center.latitude,center.longitude),n=2**zoom;
 const x0=centerPx.x-r.width/2,y0=centerPx.y-r.height/2;
 const x1=centerPx.x+r.width/2,y1=centerPx.y+r.height/2;
 const chunk=document.createDocumentFragment();
 const minX=Math.floor(x0/size),maxX=Math.ceil(x1/size);
 const minY=Math.max(0,Math.floor(y0/size)),maxY=Math.min(n-1,Math.ceil(y1/size));
 let count=0;
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   if(++count>42)break;
   const image=document.createElement('img');
   const wrapped=((x%n)+n)%n;
   image.className='tile';image.alt='';image.decoding='async';
   image.style.left=(x*size-x0)+'px';image.style.top=(y*size-y0)+'px';
   image.src='https://tile.openstreetmap.org/'+zoom+'/'+wrapped+'/'+y+'.png';
   chunk.append(image);
 }
 tiles.replaceChildren(chunk);
 const pinNodes=document.createDocumentFragment();
 for(const marker of markers){
   if(!Number.isFinite(Number(marker.latitude))||!Number.isFinite(Number(marker.longitude)))continue;
   const p=project(Number(marker.latitude),Number(marker.longitude));
   let dx=p.x-centerPx.x;
   const world=size*2**zoom;
   if(dx>world/2)dx-=world;
   else if(dx<-world/2)dx+=world;
   const left=r.width/2+dx,top=r.height/2+p.y-centerPx.y;
   if(left<-120||left>r.width+120||top<-70||top>r.height+100)continue;
   const btn=document.createElement('button');
   btn.type='button';btn.className='radio-pin '+(marker.role==='station'?'station':'ap')+(marker.id===selectedId?' selected':'');
   btn.style.left=left+'px';btn.style.top=top+'px';
   btn.textContent=(marker.role==='ap'?'AP · ':'ST · ')+String(marker.name||marker.id).slice(0,60);
   btn.title=btn.textContent;
   btn.addEventListener('pointerdown',event=>event.stopPropagation());
   btn.addEventListener('click',event=>{event.stopPropagation();window.parent.postMessage({type:'ems:radio:geo:select',id:marker.id},location.origin);});
   pinNodes.append(btn);
 }
 pins.replaceChildren(pinNodes);
}
function updateView(newCenter,newZoom=zoom) {
 center.latitude=clamp(newCenter.latitude,-maxLat,maxLat);
 center.longitude=((newCenter.longitude+180)%360+360)%360-180;
 zoom=clamp(newZoom,2,18);show();
}
window.addEventListener('message',(event)=>{
 if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='ems:radio:geo:data')return;
 const data=event.data;
 markers=Array.isArray(data.markers)?data.markers.slice(0,120):[];
 selectedId=String(data.selectedId||'');
 const selected=markers.find(m=>m.id===selectedId);
 if(!initialized){
   initialized=true;
   if(selected)updateView({latitude:Number(selected.latitude),longitude:Number(selected.longitude)},14);
   else if(markers.length)updateView({latitude:Number(markers[0].latitude),longitude:Number(markers[0].longitude)},11);
   else updateView(center,2);
 } else if(data.recenter && selected)updateView({latitude:Number(selected.latitude),longitude:Number(selected.longitude)},Math.max(zoom,12));
 else show();
 el('radioHint').textContent=data.hint||'Click map to select location';
});
map.addEventListener('pointerdown',event=>{
 if(event.button!==0||event.target.closest('#radioControls')||event.target.closest('#radioCredit'))return;
 pan={x:event.clientX,y:event.clientY,center:{...center},drag:false,pointerId:event.pointerId};
 map.setPointerCapture(event.pointerId);
});
map.addEventListener('pointermove',event=>{
 if(!pan||pan.pointerId!==event.pointerId)return;
 if(Math.hypot(event.clientX-pan.x,event.clientY-pan.y)>6)pan.drag=true;
 if(pan.drag){
   const p=project(pan.center.latitude,pan.center.longitude);
   center=unproject(p.x+pan.x-event.clientX,p.y+pan.y-event.clientY);
   show();
 }
});
map.addEventListener('pointerup',event=>{
 if(!pan||pan.pointerId!==event.pointerId)return;
 const wasDrag=pan.drag;pan=null;
 if(!wasDrag){
   const r=map.getBoundingClientRect(),position=atPixel(event.clientX-r.left,event.clientY-r.top);
   window.parent.postMessage({type:'ems:radio:geo:pick',latitude:Number(position.latitude.toFixed(6)),longitude:Number(position.longitude.toFixed(6))},location.origin);
 }
});
map.addEventListener('pointercancel',()=>{pan=null;});
el('zoomIn').addEventListener('click',()=>updateView(center,zoom+1));
el('zoomOut').addEventListener('click',()=>updateView(center,zoom-1));
window.addEventListener('resize',show);
window.parent.postMessage({type:'ems:radio:geo:ready'},location.origin);
show();
