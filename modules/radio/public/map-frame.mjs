// Radio documentation map: OSM background + AP/Station positions and straight-line GPS distances.
// No radio login, live discovery, recurring network checks or additional dependencies.
import {distanceMeters,formatDistance,fitGeoPoints,geoProject,geoUnproject,validGeoPoint} from './geo-math.mjs';

const el=id=>document.getElementById(id);
const map=el('radioMap'),tiles=el('radioTiles'),links=el('radioLinks'),pins=el('radioPins');
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
let center={latitude:0,longitude:0},zoom=2,markers=[],selectedId='',initialized=false,lastPositions='';
let pan=null,activeTiles=new Map();
const size=256,ns='http://www.w3.org/2000/svg';

function currentCoordinates(position,centerPixel,rect) {
  const pixel=geoProject(position.latitude,position.longitude,zoom);
  const world=size*2**zoom;
  let dx=pixel.x-centerPixel.x;
  if(dx>world/2)dx-=world;
  if(dx<-world/2)dx+=world;
  return {x:rect.width/2+dx,y:rect.height/2+pixel.y-centerPixel.y};
}
function atPixel(x,y){
  const r=map.getBoundingClientRect(),point=geoProject(center.latitude,center.longitude,zoom);
  return geoUnproject(point.x+x-r.width/2,point.y+y-r.height/2,zoom);
}
function updateTiles(rect,centerPixel) {
  const x0=centerPixel.x-rect.width/2,y0=centerPixel.y-rect.height/2;
  const x1=centerPixel.x+rect.width/2,y1=centerPixel.y+rect.height/2;
  const n=2**zoom;
  const minX=Math.floor(x0/size),maxX=Math.ceil(x1/size);
  const minY=Math.max(0,Math.floor(y0/size)),maxY=Math.min(n-1,Math.ceil(y1/size));
  const wanted=new Set();
  let count=0;
  outer:for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    if(count++>=42)break outer;
    const wrapped=((x%n)+n)%n,key=zoom+'/'+wrapped+'/'+y+'@'+x;
    wanted.add(key);
    let img=activeTiles.get(key);
    if(!img){
      img=document.createElement('img');img.className='tile';img.alt='';img.decoding='async';
      img.src='https://tile.openstreetmap.org/'+zoom+'/'+wrapped+'/'+y+'.png';
      activeTiles.set(key,img);tiles.append(img);
    }
    img.style.left=x*size-x0+'px';img.style.top=y*size-y0+'px';
  }
  for(const [key,img] of activeTiles)if(!wanted.has(key)){img.remove();activeTiles.delete(key);}
}
function svgNode(tag,attributes,text){
  const node=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  if(text!==undefined)node.textContent=text;
  return node;
}
function renderLinks(rect,positions) {
  links.setAttribute('viewBox','0 0 '+rect.width+' '+rect.height);
  const layer=document.createDocumentFragment();
  const ap=markers.find(m=>m.role==='ap' && validGeoPoint(m));
  if(ap){
    const source=positions.get(ap.id);
    if(source){
      for(const station of markers){
        if(station.role!=='station'||!validGeoPoint(station))continue;
        const target=positions.get(station.id);
        if(!target)continue;
        const meters=distanceMeters(ap,station);
        if(meters===null)continue;
        const visible=[source,target].some(p=>p.x>=-100&&p.x<=rect.width+100&&p.y>=-100&&p.y<=rect.height+100);
        if(!visible)continue;
        const line=svgNode('line',{x1:source.x,y1:source.y,x2:target.x,y2:target.y,class:'radio-link', 'data-station-id':station.id});
        layer.append(line);
        const mx=(source.x+target.x)/2,my=(source.y+target.y)/2-7;
        const label=svgNode('text',{x:mx,y:my,class:'radio-link-distance','text-anchor':'middle','data-station-id':station.id},formatDistance(meters));
        layer.append(label);
      }
    }
  }
  links.replaceChildren(layer);
}
function renderMarkers(rect,positions) {
  const layer=document.createDocumentFragment();
  const ap=markers.find(m=>m.role==='ap'&&validGeoPoint(m));
  for(const marker of markers){
    const point=positions.get(marker.id);
    if(!point||point.x<-180||point.x>rect.width+180||point.y<-80||point.y>rect.height+100)continue;
    const isAp=marker.role==='ap',distance=!isAp&&ap?distanceMeters(ap,marker):null;
    const text=(isAp?'AP · ':'ST · ')+String(marker.name||marker.id).slice(0,52);
    const pin=document.createElement('button');
    pin.type='button';pin.className='radio-pin '+(isAp?'ap':'station')+(marker.id===selectedId?' selected':'');
    pin.dataset.hostId=String(marker.id);
    pin.style.left=point.x+'px';pin.style.top=point.y+'px';
    pin.textContent=text;
    if(distance!==null)pin.title=text+' · '+formatDistance(distance)+' straight-line';
    else pin.title=text;
    pin.addEventListener('pointerdown',event=>event.stopPropagation());
    pin.addEventListener('click',event=>{event.stopPropagation();window.parent.postMessage({type:'ems:radio:geo:select',id:marker.id},location.origin);});
    layer.append(pin);
  }
  pins.replaceChildren(layer);
}
function draw(){
  const rect=map.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const centerPixel=geoProject(center.latitude,center.longitude,zoom);
  updateTiles(rect,centerPixel);
  const positions=new Map(markers.filter(validGeoPoint).map(m=>[m.id,currentCoordinates(m,centerPixel,rect)]));
  renderLinks(rect,positions);
  renderMarkers(rect,positions);
  el('radioCounts').textContent=markers.filter(m=>m.role==='station'&&validGeoPoint(m)).length+' station locations';
}
function updateView(position,newZoom=zoom){
  center.latitude=clamp(position.latitude,-85.05112878,85.05112878);
  center.longitude=(((position.longitude+180)%360)+360)%360-180;
  zoom=clamp(newZoom,2,18);draw();
}
function fitAll(){
  const rect=map.getBoundingClientRect();
  const view=fitGeoPoints(markers,rect.width,rect.height);
  if(view)updateView(view,view.zoom);
  else updateView({latitude:0,longitude:0},2);
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='ems:radio:geo:data')return;
  const data=event.data;
  markers=(Array.isArray(data.markers)?data.markers:[]).slice(0,120).filter(m=>m&&['ap','station'].includes(m.role)&&validGeoPoint(m))
    .map(m=>({id:String(m.id),name:String(m.name||m.id),role:m.role,latitude:Number(m.latitude),longitude:Number(m.longitude)}));
  selectedId=String(data.selectedId||'');
  // Refresh automatic fit only when the location set changes or user selects another AP.
  const signature=JSON.stringify(markers.map(m=>[m.id,m.latitude,m.longitude,m.role]));
  if(!initialized||signature!==lastPositions||data.recenter){
    lastPositions=signature;initialized=true;fitAll();
  }else draw();
  const ap=markers.some(m=>m.role==='ap');
  el('radioHint').textContent=!ap?
    'Save AP coordinates to display links and distances':
    data.hint||'AP → Stations: straight-line GPS distances';
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
   const p=geoProject(pan.center.latitude,pan.center.longitude,zoom);
   center=geoUnproject(p.x+pan.x-event.clientX,p.y+pan.y-event.clientY,zoom);
   draw();
 }
});
map.addEventListener('pointerup',event=>{
 if(!pan||pan.pointerId!==event.pointerId)return;
 const dragged=pan.drag;pan=null;
 if(!dragged){
   const r=map.getBoundingClientRect(),position=atPixel(event.clientX-r.left,event.clientY-r.top);
   window.parent.postMessage({type:'ems:radio:geo:pick',latitude:Number(position.latitude.toFixed(6)),longitude:Number(position.longitude.toFixed(6))},location.origin);
 }
});
map.addEventListener('pointercancel',()=>{pan=null;});
el('zoomIn').addEventListener('click',()=>updateView(center,zoom+1));
el('zoomOut').addEventListener('click',()=>updateView(center,zoom-1));
el('fitRadio').addEventListener('click',fitAll);
window.addEventListener('resize',fitAll);
window.parent.postMessage({type:'ems:radio:geo:ready'},location.origin);
draw();
