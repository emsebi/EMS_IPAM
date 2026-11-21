// Link Planner engineering functions. Units: WGS84 degrees, m, km, GHz, dBm.
// Terrain and buildings are *not* inferred. Site heights are above supplied terrain.
export const EARTH_RADIUS_M = 6371008.8;
const rad = Math.PI / 180;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const problem = message => Object.assign(new Error(message),{status:400});
export function coordinate(value,min,max,label) {
  if(value === '' || value === null || value === undefined) throw problem(label+' is required.');
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw problem(label+' is outside '+min+'..'+max+'.');
  return n;
}
export function endpoint(data,prefix) {
  const raw=data||{};
  const latitude=coordinate(raw.latitude,-90,90,prefix+' latitude');
  const longitude=coordinate(raw.longitude,-180,180,prefix+' longitude');
  return {latitude,longitude};
}
export function greatCircleMeters(a,b){
  const dLat=(b.latitude-a.latitude)*rad,dLon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
  return 2*EARTH_RADIUS_M*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))));
}
export function interpolateGreatCircle(a,b,count){
  if(!Number.isInteger(count)||count<2||count>100)throw problem('Sample count must be 2..100.');
  const la=a.latitude*rad,lb=b.latitude*rad,oa=a.longitude*rad,ob=b.longitude*rad;
  const u=[Math.cos(la)*Math.cos(oa),Math.cos(la)*Math.sin(oa),Math.sin(la)];
  const v=[Math.cos(lb)*Math.cos(ob),Math.cos(lb)*Math.sin(ob),Math.sin(lb)];
  const arc=Math.acos(Math.max(-1,Math.min(1,u.reduce((sum,x,i)=>sum+x*v[i],0))));
  return Array.from({length:count},(_,i)=>{
    const t=i/(count-1);
    if(t===0)return {...a};
    if(t===1)return {...b};
    const k=arc>1e-10?Math.sin((1-t)*arc)/Math.sin(arc):1-t;
    const j=arc>1e-10?Math.sin(t*arc)/Math.sin(arc):t;
    const p=u.map((x,i)=>x*k+v[i]*j);
    const length=Math.hypot(...p);
    return {latitude:Math.asin(p[2]/length)/rad,longitude:Math.atan2(p[1],p[0])/rad};
  });
}
export function normalizeInput(raw){
  if(!raw||typeof raw!=='object')throw problem('Planner parameters are missing.');
  const a=endpoint(raw.a,'A'),b=endpoint(raw.b,'B');
  const km=greatCircleMeters(a,b)/1000;
  if(km<0.01||km>300)throw problem('Plan must be between 10 m and 300 km.');
  const bounded=(value,label,min,max,defaultValue)=>{
    const n=value===undefined||value===null||value===''?defaultValue:Number(value);
    if(!finite(n)||n<min||n>max)throw problem(label+' must be '+min+'..'+max+'.');
    return n;
  };
  const height=(site,name)=>({
    building:bounded(site?.building,name+' building height',0,1000,0),
    tower:bounded(site?.tower,name+' tower height',0,1000,0),
    mount:bounded(site?.mount,name+' antenna mount height',0,100,0)
  });
  return {a,b,siteA:height(raw.siteA,'A'),siteB:height(raw.siteB,'B'),
    frequencyGHz:bounded(raw.frequencyGHz,'Frequency GHz',0.1,100,5.8),
    txDbm:bounded(raw.txDbm,'TX power dBm',-50,60,20),
    gainA:bounded(raw.gainA,'TX antenna gain dBi',-10,65,27),
    gainB:bounded(raw.gainB,'RX antenna gain dBi',-10,65,27),
    lossA:bounded(raw.lossA,'TX cable loss dB',0,40,1),
    lossB:bounded(raw.lossB,'RX cable loss dB',0,40,1),
    otherLoss:bounded(raw.otherLoss,'Additional losses dB',0,100,0),
    sensitivityDbm:bounded(raw.sensitivityDbm,'Receiver sensitivity dBm',-150,-20,-80),
    kFactor:bounded(raw.kFactor,'Effective Earth k-factor',0.5,3,4/3),
    fresnelClearance:bounded(raw.fresnelClearance,'First-zone clearance fraction',0,1,0.6),
    deviceA:String(raw.deviceA||'').slice(0,90).trim(),
    deviceB:String(raw.deviceB||'').slice(0,90).trim(),
    radioA:String(raw.radioA||'custom').slice(0,70),
    radioB:String(raw.radioB||'custom').slice(0,70),
    protocol:String(raw.protocol||'802.11ac').slice(0,60),
    channelWidthMHz:bounded(raw.channelWidthMHz,'Channel width MHz',3.5,112,40),
    spatialStreams:bounded(raw.spatialStreams,'Spatial streams',1,8,2),
    modulation:String(raw.modulation||'').slice(0,25)
  };
}
export function radioBudget(input) {
  const km=greatCircleMeters(input.a,input.b)/1000;
  if(km<=0)throw problem('Distance must be positive.');
  const fMHz=input.frequencyGHz*1000;
  const fspl=32.44+20*Math.log10(km)+20*Math.log10(fMHz);
  const eirp=input.txDbm+input.gainA-input.lossA;
  const received=eirp+input.gainB-input.lossB-input.otherLoss-fspl;
  return {distanceKm:km,fsplDb:fspl,eirpDbm:eirp,rxDbm:received,marginDb:received-input.sensitivityDbm};
}
export function assessTerrain(input, elevations) {
  if(!Array.isArray(elevations)||elevations.length<3||elevations.length>100)return {status:'unavailable',message:'Terrain elevation samples are missing.'};
  if(elevations.some(e=>!finite(e)||e< -12000||e>12000))return {status:'unavailable',message:'Incomplete elevation data: terrain clearance is not calculated.'};
  const total=greatCircleMeters(input.a,input.b);
  const wavelength=299792458/(input.frequencyGHz*1e9);
  const aHeight=elevations[0]+input.siteA.building+input.siteA.tower+input.siteA.mount;
  const bHeight=elevations.at(-1)+input.siteB.building+input.siteB.tower+input.siteB.mount;
  let worst={clearanceM:Infinity,index:-1,distanceKm:0},maxBulge=0;
  const samples=elevations.map((ground,i)=>{
    const frac=i/(elevations.length-1),d1=total*frac,d2=total-d1;
    const bulgeM=d1*d2/(2*input.kFactor*EARTH_RADIUS_M);
    const fresnelM=Math.sqrt(Math.max(0,wavelength*d1*d2/total));
    const lineM=aHeight+(bHeight-aHeight)*frac;
    const requiredM=ground+bulgeM+fresnelM*input.fresnelClearance;
    const clearanceM=lineM-requiredM;
    if(clearanceM<worst.clearanceM)worst={clearanceM,index:i,distanceKm:d1/1000};
    maxBulge=Math.max(maxBulge,bulgeM);
    return {distanceKm:d1/1000,groundM:ground,lineM,bulgeM,fresnelM,requiredM,clearanceM};
  });
  return {status:worst.clearanceM>=0?'clear':'obstructed',samples,worst,
    recommendedRaiseBothM:Math.max(0,-worst.clearanceM),maxEarthBulgeM:maxBulge,
    endpointAmslM:aHeight,endpointBmslM:bHeight,
    method:'Spherical effective-Earth k-factor + first Fresnel zone; point samples do not capture all obstacles.'};
}
// Fix one side's existing building + tower + antenna mount, solve the least
// tower on the *opposite* side required for sampled LOS+Fresnel clearance.
// The terrain-derived requiredM is independent of the current antenna heights.
export function requiredOppositeTower(input,elevations,fixedSide='a') {
  if(!['a','b'].includes(fixedSide))throw problem('fixedSide must be a or b.');
  const analysis=assessTerrain(input,elevations);
  if(analysis.status==='unavailable')return {status:'unavailable',fixedSide,requiredTowerM:null,reason:analysis.message};
  const targetSide=fixedSide==='a'?'b':'a';
  const fixed= input[fixedSide==='a'?'siteA':'siteB'];
  const target=input[targetSide==='a'?'siteA':'siteB'];
  const groundFixed=fixedSide==='a'?elevations[0]:elevations.at(-1);
  const groundTarget=targetSide==='a'?elevations[0]:elevations.at(-1);
  const fixedAbsoluteM=groundFixed+fixed.building+fixed.tower+fixed.mount;
  let minimumTargetAbsoluteM=-Infinity;
  for(let i=0;i<analysis.samples.length;i++){
    const point=analysis.samples[i];
    const proportion=i/(analysis.samples.length-1);
    const weight=fixedSide==='a'?proportion:1-proportion;
    if(weight<=1e-12){
      if(point.requiredM>fixedAbsoluteM+0.00001)
        return {status:'impossible-fixed-end',fixedSide,targetSide,requiredTowerM:null,
          reason:'The fixed antenna itself does not clear the endpoint obstacle.'};
      continue;
    }
    const needed=(point.requiredM-(1-weight)*fixedAbsoluteM)/weight;
    minimumTargetAbsoluteM=Math.max(minimumTargetAbsoluteM,needed);
  }
  const requiredTowerM=Math.max(0,minimumTargetAbsoluteM-groundTarget-target.building-target.mount);
  return {status:requiredTowerM>1000?'exceeds-limit':'ok',
    fixedSide,targetSide,requiredTowerM,
    configuredTowerM:target.tower,
    differenceM:requiredTowerM-target.tower,
    fixedTowerM:fixed.tower,
    targetBuildingM:target.building,
    targetMountM:target.mount,
    endpointAbsoluteM:groundTarget+target.building+requiredTowerM+target.mount,
    note:'Minimum opposite tower relative to SRTM terrain, sampled curvature and selected Fresnel clearance; not a construction recommendation.'};
}
// Summarize only sampled SRTM ground heights. Nulls are unknown, not zero.
export function terrainElevationSummary(samples){
  if(!Array.isArray(samples)||samples.length<2||samples.some(s=>!Number.isFinite(s?.groundM)||!Number.isFinite(s?.distanceKm)))return null;
  const heights=samples.map(s=>s.groundM);
  let ascentM=0,descentM=0;
  for(let i=1;i<heights.length;i++){
    const delta=heights[i]-heights[i-1];
    if(delta>0)ascentM+=delta;else descentM-=delta;
  }
  const minM=Math.min(...heights),maxM=Math.max(...heights);
  const highestIndex=heights.indexOf(maxM);
  return {startM:heights[0],endM:heights.at(-1),deltaM:heights.at(-1)-heights[0],minM,maxM,
    reliefM:maxM-minM,ascentM,descentM,highestAtKm:samples[highestIndex].distanceKm,sampleCount:heights.length};
}

export function profileBounds(points){
  if(!points?.length)return {min:0,max:1};
  const vals=points.flatMap(s=>[s.groundM,s.lineM,s.requiredM]).filter(finite);
  if(!vals.length)return {min:0,max:1};
  const min=Math.min(...vals),max=Math.max(...vals),pad=Math.max(5,(max-min)*.08);
  return {min:min-pad,max:max+pad};
}

export function validGeoPoint(p){
  return Boolean(p&&p.latitude!==''&&p.longitude!==''&&p.latitude!==null&&p.longitude!==null&&
    Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&
    Number(p.latitude)>=-90&&Number(p.latitude)<=90&&Number(p.longitude)>=-180&&Number(p.longitude)<=180);
}
export function geoProject(latitude,longitude,zoom=0){
  const lat=Math.max(-85.05112878,Math.min(85.05112878,Number(latitude)))*rad;
  const scale=256*2**zoom;
  return {x:(Number(longitude)+180)/360*scale,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*scale};
}
export function geoUnproject(x,y,zoom=0){
  const scale=256*2**zoom,n=Math.PI-2*Math.PI*y/scale;
  return {latitude:Math.atan(Math.sinh(n))/rad,longitude:(((x/scale*360)%360)+360)%360-180};
}
export function fitGeoPoints(points,width,height,{padding=65,minZoom=2,maxZoom=18}={}){
  const selected=(points||[]).filter(validGeoPoint);
  if(!selected.length)return null;
  if(selected.length===1)return {...selected[0],latitude:Number(selected[0].latitude),longitude:Number(selected[0].longitude),zoom:14};
  const projected=selected.map(p=>geoProject(p.latitude,p.longitude));
  const first=projected[0].x;
  for(const point of projected){
    while(point.x-first>128)point.x-=256;
    while(point.x-first< -128)point.x+=256;
  }
  const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  let zoom=minZoom;
  for(let z=maxZoom;z>=minZoom;z--){
    if((maxX-minX)*2**z<=Math.max(60,width-2*padding)&&(maxY-minY)*2**z<=Math.max(60,height-2*padding)){zoom=z;break;}
  }
  return {...geoUnproject((minX+maxX)/2,(minY+maxY)/2),zoom};
}
