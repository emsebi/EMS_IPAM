// Map-only geographical calculations. No radio measurements or device requests.
const rad=Math.PI/180;
const maxMercatorLatitude=85.05112878;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function validGeoPoint(point){
  return point && point.latitude!==null && point.latitude!=='' && point.longitude!==null && point.longitude!=='' &&
    Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) &&
    Number(point.latitude)>=-90 && Number(point.latitude)<=90 &&
    Number(point.longitude)>=-180 && Number(point.longitude)<=180;
}
export function distanceMeters(a,b){
  if(!validGeoPoint(a)||!validGeoPoint(b)) return null;
  const lat1=Number(a.latitude)*rad,lat2=Number(b.latitude)*rad;
  const deltaLat=(Number(b.latitude)-Number(a.latitude))*rad;
  const deltaLon=(Number(b.longitude)-Number(a.longitude))*rad;
  const h=Math.sin(deltaLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(deltaLon/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
export function formatDistance(meters){
  if(!Number.isFinite(meters)||meters<0) return '—';
  return meters<1000?Math.round(meters)+' m':(meters/1000).toFixed(meters<10000?2:1)+' km';
}
export function geoProject(latitude,longitude,zoom=0){
  const lat=clamp(Number(latitude),-maxMercatorLatitude,maxMercatorLatitude)*rad;
  const scale=256*2**zoom;
  return {x:(Number(longitude)+180)/360*scale,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*scale};
}
export function geoUnproject(x,y,zoom=0){
  const scale=256*2**zoom;
  const longitude=(((x/scale*360)%360)+360)%360-180;
  const n=Math.PI-2*Math.PI*y/scale;
  return {latitude:clamp(Math.atan(Math.sinh(n))/rad,-90,90),longitude};
}
// Keeps all documented markers visible. Unwraps longitude across the date line.
export function fitGeoPoints(points,width,height,{padding=65,minZoom=2,maxZoom=18}={}){
  const valid=(points||[]).filter(validGeoPoint);
  if(!valid.length) return null;
  if(valid.length===1) return {latitude:Number(valid[0].latitude),longitude:Number(valid[0].longitude),zoom:Math.min(maxZoom,14)};
  const projected=valid.map(p=>geoProject(p.latitude,p.longitude));
  const pivot=projected[0].x;
  for(const item of projected){
    while(item.x-pivot>128)item.x-=256;
    while(item.x-pivot< -128)item.x+=256;
  }
  const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);
  const extentX=Math.max(...xs)-Math.min(...xs);
  const extentY=Math.max(...ys)-Math.min(...ys);
  const availableX=Math.max(75,width-2*padding),availableY=Math.max(75,height-2*padding);
  let zoom=minZoom;
  for(let current=maxZoom;current>=minZoom;current--){
    if(extentX*2**current<=availableX && extentY*2**current<=availableY){zoom=current;break;}
  }
  const midpoint=geoUnproject((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2);
  return {...midpoint,zoom};
}
