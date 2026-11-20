// Small, manually curated radio planning catalogue with manufacturer reference URLs.
// A model entry is a *family capability*, not proof that firmware, licence or ODU supports it.
// No guessed RX sensitivity, MCS threshold, actual throughput or RF antenna gain for connectorized radios.
const wifi=['802.11a','802.11n','802.11ac'];
const mt=[...wifi,'NV2 (legacy RouterOS wireless)','Nstreme (legacy RouterOS wireless)'];
const qam=['QPSK','16QAM','32QAM','64QAM','128QAM','256QAM','512QAM','1024QAM','2048QAM','4096QAM'];
const entry=(id,brand,model,kind,protocols,source,more={})=>Object.freeze({
  id,brand,model,kind,protocols,source,antennaGainDbi:null,chains:null,brochureCeilingMbps:null,modulations:[],notes:'',...more
});
export const RADIO_PROFILES=Object.freeze([
 entry('custom','Custom / Generic','Manual technical parameters','manual',
   [...wifi,'NV2 (legacy RouterOS wireless)','Nstreme (legacy RouterOS wireless)','Mimosa proprietary PTP','Digital microwave ACM'],'',
   {notes:'Enter vendor-verified specifications and actual antenna gain.'}),
 entry('mt-lhg5ac','MikroTik','LHG 5 ac','wifi',mt,'https://mikrotik.com/product/lhg_5_ac',
   {antennaGainDbi:24.5,chains:2,notes:'5GHz dual-chain 802.11a/n/ac. Legacy NV2/Nstreme require compatible RouterOS wireless package on both sides.'}),
 entry('mt-lhgxl5ac','MikroTik','LHG XL 5 ac','wifi',mt,'https://mikrotik.com/product/lhg_xl_5_ac',
   {antennaGainDbi:27,chains:2,notes:'5GHz dual-chain 802.11a/n/ac; verify RouterOS wireless drivers for proprietary protocols.'}),
 entry('mt-lhg5','MikroTik','LHG 5 (802.11a/n)','wifi',mt.filter(p=>p!=='802.11ac'),'https://mikrotik.com/product/RBLHG-5nD',
   {antennaGainDbi:24.5,chains:2,notes:'802.11a/n, not 802.11ac.'}),
 entry('mim-c5c','Mimosa','C5c','vendor',['Mimosa proprietary PTP'],'https://mimosa.co/products/c5c',
   {brochureCeilingMbps:700,notes:'Mimosa SRS/PTP; max 700 Mbps advertised for supported PTP setup; external antenna gain must be entered manually.'}),
 entry('mim-b5x','Mimosa','B5x','vendor',['Mimosa proprietary PTP'],'https://mimosa.co/products/b5x',
   {notes:'PTP proprietary radio; external antenna and firmware/licence affect capacity. Model-specific sensitivity needed for MCS.'}),
 entry('er-6600','Ericsson','MINI-LINK 6600 family','microwave',['Digital microwave ACM'],'https://www.ericsson.com/en/portfolio/networks/ericsson-radio-system/mobile-transport/microwave/split-mount-shorthaul/mini-link-66002',
   {brochureCeilingMbps:2500,modulations:[...qam,'8192QAM'],notes:'Family maximum up to 2.5 Gbps per link, 8kQAM supported only by certain link/ODU/licence configurations.'}),
 entry('er-6200','Ericsson','MINI-LINK 6200 family','microwave',['Digital microwave ACM'],'https://www.ericsson.com/en/portfolio/networks/ericsson-radio-system/mobile-transport/microwave/long-haul/mini-link-6200',
   {modulations:qam,notes:'Family modulation up to 4096QAM, depends on ODU and channel licence.'}),
 entry('hw-rtn320','Huawei','RTN 320 family','microwave',['Digital microwave ACM'],'https://carrier.huawei.com/kr/products/wireless-network/microwave/fo/rtn320',
   {brochureCeilingMbps:2000,modulations:qam,notes:'6–42GHz family with 112MHz / 4096QAM option and up to 2Gbps per carrier under supported configurations.'}),
 entry('rc-ray3-17','RACOM','RAy3-17','microwave',['Digital microwave ACM'],'https://www.racom.eu/eng/products/m/ray3/tech.html',
   {modulations:qam,notes:'17GHz family; actual centre frequency and FEC/licence must match installation.'}),
 entry('rc-ray3-24','RACOM','RAy3-24','microwave',['Digital microwave ACM'],'https://www.racom.eu/eng/products/m/ray3/tech.html',
   {modulations:qam,notes:'24GHz family; regional channel plan and modulation licence must match installation.'})
]);
export const radioById=id=>RADIO_PROFILES.find(p=>p.id===id)||RADIO_PROFILES[0];
export const RADIO_BRANDS=Object.freeze([...new Set(RADIO_PROFILES.map(p=>p.brand))]);
export const protocolOverlap=(a,b)=>{
  const A=radioById(a),B=radioById(b);
  if(A.kind==='manual')return [...B.protocols];
  if(B.kind==='manual')return [...A.protocols];
  return A.protocols.filter(p=>B.protocols.includes(p));
};
export const modulationOptions=(a,b)=>{
  const A=radioById(a),B=radioById(b);
  if(A.kind==='manual')return [...B.modulations];
  if(B.kind==='manual')return [...A.modulations];
  return A.modulations.filter(m=>B.modulations.includes(m));
};
// Short-GI single spatial stream IEEE reference rates; not vendor-specific achievable payload.
const WIFI_PHY={
 '802.11a':{20:{rate:54,mod:'64QAM 3/4'}},
 '802.11n':{20:{rate:72.2,mod:'64QAM 5/6'},40:{rate:150,mod:'64QAM 5/6'}},
 '802.11ac':{20:{rate:86.7,mod:'256QAM 3/4'},40:{rate:200,mod:'256QAM 5/6'},80:{rate:433.3,mod:'256QAM 5/6'}}
};
export function estimateRadioCapacity(params,budget){
 const a=radioById(params.radioA),b=radioById(params.radioB),protocol=String(params.protocol||'');
 const width=Number(params.channelWidthMHz);
 const base={status:'unavailable',protocol,widthMHz:width,modelA:a.model,modelB:b.model,
   modulation:null,phyCeilingMbps:null,actualThroughputMbps:null,advertisedCeilingMbps:null,rxDbm:budget.rxDbm,
   note:'No measurement: actual MCS, adaptive modulation and throughput cannot be inferred without vendor sensitivity curves, noise/interference, FEC and licence data.'};
 if(!protocol||!a.protocols.includes(protocol)||!b.protocols.includes(protocol))
   return {...base,status:'incompatible',note:'The selected radio protocol is not supported by both selected model profiles.'};
 if(a.kind==='wifi'&&b.kind==='wifi'&&WIFI_PHY[protocol]){
   const rate=WIFI_PHY[protocol][width];
   if(!rate)return {...base,status:'incompatible',note:'This channel width is not defined for the selected IEEE PHY.'};
   const streams=Math.min(a.chains||1,b.chains||1,Math.max(1,Math.floor(Number(params.spatialStreams)||1)));
   return {...base,status:'reference',modulation:rate.mod,streams,phyCeilingMbps:Number((rate.rate*streams).toFixed(1)),
     note:'Theoretical peak PHY rate with short guard interval at maximum MCS; NOT a throughput prediction. Actual modulation requires measured or documented SNR/MCS sensitivity curves.'};
 }
 if(protocol==='Digital microwave ACM' && a.kind==='microwave'&&b.kind==='microwave'){
   const modulation=String(params.modulation||'');
   if(!modulation||!a.modulations.includes(modulation)||!b.modulations.includes(modulation))
     return {...base,status:'unavailable',note:'Choose an ACM constellation supported by both model families to view ideal gross symbol capacity.'};
   const bits=modulation==='QPSK'?2:Math.log2(parseInt(modulation,10));
   return {...base,status:'reference',modulation,
     idealRawUpperMbps:Number((width*bits).toFixed(1)),
     advertisedCeilingMbps:Math.min(...[a.brochureCeilingMbps,b.brochureCeilingMbps].filter(Number.isFinite)),
     note:'Bandwidth × bits per symbol is an ideal uncoded upper bound ONLY; it ignores roll-off, framing, FEC, XPIC and licence/channel limits. Never treat it as throughput.'};
 }
 return {...base,status:'reference',
   advertisedCeilingMbps:Math.min(...[a.brochureCeilingMbps,b.brochureCeilingMbps].filter(Number.isFinite)),
   note:'Proprietary PHY: vendor marketing ceiling is informational only. Current path throughput/MCS cannot be predicted without model+firmware+channel-specific tables.'};
}
