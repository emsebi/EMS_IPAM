// Independent PTP planning core. All RF powers are dBm/dB, distances km, elevations metres.
const rad = Math.PI / 180;
export const earthRadiusM = 6371008.8;
const number = (value, name, min, max) => {
  if (value === "" || value === null || value === undefined) throw new RangeError(name + " is required");
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(name + " out of range");
  return n;
};
export function validatePoint(point) {
  return {
    latitude: number(point?.latitude, "latitude", -90, 90),
    longitude: number(point?.longitude, "longitude", -180, 180),
  };
}
export function distanceKm(a, b) {
  const p1 = validatePoint(a), p2 = validatePoint(b);
  const dLat = (p2.latitude - p1.latitude) * rad, dLon = (p2.longitude - p1.longitude) * rad;
  const s = Math.sin(dLat/2)**2 + Math.cos(p1.latitude*rad)*Math.cos(p2.latitude*rad)*Math.sin(dLon/2)**2;
  return 2 * earthRadiusM / 1000 * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function fresnelRadiusM(frequencyGHz, d1Km, d2Km) {
  const f = number(frequencyGHz, "frequencyGHz", 0.1, 175);
  if (d1Km <= 0 || d2Km <= 0) return 0;
  const wavelength = 0.299792458 / f;
  return Math.sqrt(wavelength * (d1Km * 1000) * (d2Km * 1000) / ((d1Km+d2Km)*1000));
}
export function freeSpaceLossDb(distance, frequencyGHz) {
  const d = number(distance, "distanceKm", 0.000001, 2000);
  const f = number(frequencyGHz, "frequencyGHz", 0.1, 175);
  return 92.45 + 20 * Math.log10(d) + 20 * Math.log10(f);
}
const optional = (value, fallback, name, min, max) =>
  value === "" || value === null || value === undefined ? fallback : number(value, name, min, max);
const round = (v, digits=2) => Number(v.toFixed(digits));
const rainScale = (frequencyGHz, p) => {
  const c0 = frequencyGHz >= 10 ? 0.12 + 0.4 * Math.log10(frequencyGHz / 10)**0.8 : 0.12;
  const c1 = 0.07**c0 * 0.12**(1-c0);
  const c2 = 0.855*c0+0.546*(1-c0), c3=0.139*c0+0.043*(1-c0);
  return c1 * p**(-(c2+c3*Math.log10(p)));
};
export function rainEstimate({frequencyGHz, distance, rainRateR001, rainK, rainAlpha, marginDb}) {
  if ([rainRateR001, rainK, rainAlpha].some(v => v === undefined || v === null || v === "")) return null;
  const f = number(frequencyGHz,"frequencyGHz",1,175), d=number(distance,"distance",0.01,60);
  const R=number(rainRateR001,"rainRateR001",0.1,300);
  const k=number(rainK,"rainK",0.00000001,5), alpha=number(rainAlpha,"rainAlpha",0.1,3);
  const denominator = 0.477 * Math.min(d,30)**0.633 * Math.max(R,3)**(0.073*alpha) * Math.max(f,6)**0.123
     - 10.579*(1-Math.exp(-0.024*Math.min(d,30)));
  if (denominator <= 0) return null;
  const specificDbPerKm=k*R**alpha, factor=1/denominator, a001=specificDbPerKm*d*factor;
  const levels=[1,.3,.1,.03,.01,.003,.001].map(p=>({p,attenuationDb:round(p===.01?a001:a001*rainScale(f,p))}));
  let exceedancePercent = null, bound = "";
  if (marginDb !== null && marginDb !== undefined && Number.isFinite(Number(marginDb))) {
    const m=Number(marginDb);
    if (m<levels[0].attenuationDb) bound="availability below 99% (rain only)";
    else if (m>=levels.at(-1).attenuationDb) bound="availability at least 99.999% (rain only)";
    else {
      for(let i=0;i<levels.length-1;i++){
        const a=levels[i],b=levels[i+1];
        if(m>=a.attenuationDb && m<b.attenuationDb){
          const q=(m-a.attenuationDb)/(b.attenuationDb-a.attenuationDb);
          exceedancePercent=Math.exp(Math.log(a.p)+q*(Math.log(b.p)-Math.log(a.p)));
          break;
        }
      }
    }
  }
  return {model:"ITU-R P.530-19 §2.4.1 (rain-only), supplied P.838 k/alpha and R0.01",
    specificDbPerKm:round(specificDbPerKm,3),distanceFactor:round(factor,4),
    a001Db:round(a001),levels,
    rainOnlyAvailabilityPercent:exceedancePercent===null?null:round(100-exceedancePercent,5), bound,
    assumptions:["Annual average rain, not a forecast","No multipath, atmospheric gas, wet snow or wet antenna losses","R0.01 and k/alpha must match location, frequency and polarization"]};
}
export function calculateLink(input, elevations) {
  const a=validatePoint(input?.siteA), b=validatePoint(input?.siteB);
  const distance=distanceKm(a,b);
  if(distance<0.01 || distance>60) throw new RangeError("Link distance must be between 0.01 and 60 km");
  const frequencyGHz=number(input.frequencyGHz,"frequencyGHz",0.1,175);
  const heightA=number(input.heightA,"heightA",0,300), heightB=number(input.heightB,"heightB",0,300);
  const kFactor=optional(input.kFactor,4/3,"kFactor",0.5,10);
  const targetFresnel=optional(input.fresnelFraction,0.6,"fresnelFraction",0,1);
  const obstacleAllowance=optional(input.obstacleAllowanceM,0,"obstacleAllowanceM",0,100);
  const txDbm=optional(input.txDbm,20,"txDbm",-60,70);
  const txGain=optional(input.txGainDbi,0,"txGainDbi",0,65);
  const rxGain=optional(input.rxGainDbi,0,"rxGainDbi",0,65);
  const txLoss=optional(input.txLossDb,0,"txLossDb",0,100);
  const rxLoss=optional(input.rxLossDb,0,"rxLossDb",0,100);
  const otherLoss=optional(input.otherLossDb,0,"otherLossDb",0,100);
  const reserve=optional(input.reserveDb,0,"reserveDb",0,40);
  if(!Array.isArray(elevations) || elevations.length<3 || elevations.length>2000)
    throw new RangeError("DEM must contain 3–2000 ordered elevation samples");
  const grounds=elevations.map((value,i)=>number(value,"ground["+i+"]",-500,9000));
  const groundA=grounds[0], groundB=grounds.at(-1);
  const topA=groundA+heightA, topB=groundB+heightB;
  let worstClearance=Infinity, worstLos=Infinity, worstAtKm=0, maxFresnel=0;
  let requiredB=heightB, requiredA=heightA, impossibleB=false, impossibleA=false;
  const profile=grounds.map((ground,i)=>{
    const t=i/(grounds.length-1), d1=distance*t, d2=distance-d1;
    const bulge=1000*d1*d2/(2*(kFactor*earthRadiusM/1000));
    const f=fresnelRadiusM(frequencyGHz,d1,d2);
    const targetHeight=ground+bulge+obstacleAllowance+targetFresnel*f;
    const ray=topA+(topB-topA)*t;
    const clear=ray-targetHeight, los=ray-(ground+bulge+obstacleAllowance);
    if(clear<worstClearance){worstClearance=clear; worstAtKm=d1;}
    worstLos=Math.min(worstLos,los);maxFresnel=Math.max(maxFresnel,f);
    if(t>0){
      const needed=(targetHeight-(1-t)*topA)/t-groundB;
      if(Number.isFinite(needed))requiredB=Math.max(requiredB,needed);
    }else if(clear<0)impossibleB=true;
    if(t<1){
      const needed=(targetHeight-t*topB)/(1-t)-groundA;
      if(Number.isFinite(needed))requiredA=Math.max(requiredA,needed);
    }else if(clear<0)impossibleA=true;
    return {distanceKm:round(d1,4),groundM:round(ground),earthBulgeM:round(bulge),
      rayM:round(ray),fresnelM:round(f),targetM:round(targetHeight),clearanceM:round(clear)};
  });
  const fspl=freeSpaceLossDb(distance,frequencyGHz);
  const eirp=txDbm+txGain-txLoss;
  const rxDbm=eirp-fspl+rxGain-rxLoss-otherLoss;
  const sensitivity=input.sensitivityDbm === "" || input.sensitivityDbm===null || input.sensitivityDbm===undefined
    ? null : number(input.sensitivityDbm,"sensitivityDbm",-150,0);
  const fadeMargin=sensitivity===null?null:rxDbm-sensitivity;
  const mcsRows=Array.isArray(input.mcsRows)?input.mcsRows.slice(0,40):[];
  const qualified=mcsRows.map(row=>({
    name:String(row.name||"").slice(0,40),sensitivityDbm:Number(row.sensitivityDbm),phyMbps:Number(row.phyMbps)
  })).filter(row=>row.name && Number.isFinite(row.sensitivityDbm)&&row.sensitivityDbm>=-150&&row.sensitivityDbm<=0
    && Number.isFinite(row.phyMbps)&&row.phyMbps>0&&row.phyMbps<=100000)
    .filter(row=>rxDbm-reserve>=row.sensitivityDbm)
    .sort((x,y)=>y.phyMbps-x.phyMbps);
  const bestMcs=qualified[0]||null;
  const efficiency=optional(input.efficiency,0.65,"efficiency",0.01,1);
  const result={
    distanceKm:round(distance,4),sampleIntervalM:round(distance*1000/(grounds.length-1),1),
    frequencyGHz,groundA,groundB,heightA,heightB,topA,topB,
    kFactor,targetFresnel,obstacleAllowanceM:obstacleAllowance,profile,
    lineOfSightClear:worstLos>=0,fresnelClear:worstClearance>=0,
    worstClearanceM:round(worstClearance),worstClearanceAtKm:round(worstAtKm,3),
    maximumFresnelRadiusM:round(maxFresnel),
    minHeightAIfBFixedM:impossibleA?null:round(Math.max(0,requiredA),1),
    minHeightBIfAFixedM:impossibleB?null:round(Math.max(0,requiredB),1),
    fsplDb:round(fspl),eirpDbm:round(eirp),rxDbm:round(rxDbm),
    sensitivityDbm:sensitivity,fadeMarginDb:fadeMargin===null?null:round(fadeMargin),
    reserveDb:reserve, bestMcs:bestMcs?{...bestMcs,estimatedThroughputMbps:round(bestMcs.phyMbps*efficiency)}:null,
    terrainSource:input.terrainSource||"supplied",
    rain: null,
    disclaimers:["SRTM elevation is bare-earth/DSM-dependent and does not certify buildings, vegetation or diffraction",
      "Free-space link budget omits multipath, interference, polarization mismatch and atmospheric gas losses",
      "MCS and throughput rely on entered equipment sensitivity and PHY data; throughput is an efficiency assumption"]
  };
  try {
    result.rain=rainEstimate({frequencyGHz,distance,rainRateR001:input.rainRateR001,
      rainK:input.rainK,rainAlpha:input.rainAlpha,marginDb:fadeMargin===null?null:fadeMargin});
  } catch(error){ if(input.rainRateR001!==""&&input.rainRateR001!==undefined)throw error; }
  return result;
}
