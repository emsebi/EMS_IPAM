import net from 'node:net';
import {normalizePort} from '../discovery/parsers.mjs';

export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const text=(v,n=160)=>String(v??'').trim().slice(0,n);
export function address(v) {
  const s=text(v,64); if(net.isIP(s)!==4)throw fail('Enter an IPv4 management address.');
  const [a,b]=s.split('.').map(Number);
  if(a===0||a===127||a>=224||(a===169&&b===254))throw fail('Management address is not allowed.');
  return s;
}
export function normalizeMac(v) {
  const s=text(v,40).replace(/[.:-]/g,'').toLowerCase();
  if(!/^[0-9a-f]{12}$/.test(s))throw fail('Invalid MAC address.');
  return s.match(/../g).join(':');
}
export const ipNumber=ip=>ip.split('.').reduce((n,v)=>n*256+Number(v),0);
const toIp=n=>[24,16,8,0].map(b=>(n>>>b)&255).join('.');
export function expandScopes(scopes) {
  if(!Array.isArray(scopes)||scopes.length>64)throw fail('At most 64 ranges are allowed.');
  const result=new Set();
  for(const raw of scopes) {
    const [ip,bits]=text(raw,80).split('/'); address(ip);
    const prefix=bits===undefined?32:Number(bits);
    if(!Number.isInteger(prefix)||prefix<20||prefix>32|| (bits!==undefined&&!/^\d{1,2}$/.test(bits)))throw fail('Use IPv4 ranges /20 through /32.');
    const count=2**(32-prefix),start=Math.floor(ipNumber(ip)/count)*count;
    for(let i=prefix<31?1:0;i<count-(prefix<31?1:0);i++) {
      result.add(address(toIp(start+i))); if(result.size>4096)throw fail('Scan limit is 4096 addresses.');
    }
  }
  return [...result];
}
export function settingsInput(body) {
  const devices=Array.isArray(body.devices)?body.devices:[];
  if(devices.length>500)throw fail('Device limit is 500.');
  const seen=new Set();
  const targets=devices.map(d=>{
    const ip=address(d.address);if(seen.has(ip))throw fail('Duplicate management address.');seen.add(ip);
    if(!['auto','cisco','mikrotik'].includes(d.platform||'auto'))throw fail('Unsupported platform.');
    return {id:ip,address:ip,name:text(d.name)||ip,platform:d.platform||'auto'};
  });
  const scopes=(body.scopes||[]).map(v=>text(v,80)); expandScopes(scopes);
  const port=Number(body.port??22),timeout=Number(body.timeout??8),concurrency=Number(body.concurrency??4);
  if(!Number.isInteger(port)||port<1||port>65535)throw fail('Invalid SSH port.');
  if(!Number.isInteger(timeout)||timeout<3||timeout>30)throw fail('Timeout must be 3–30 seconds.');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw fail('Concurrency must be 1–8.');
  const username=text(body.username,100); if(!username||/[\x00-\x1f]/.test(username))throw fail('Username is required.');
  const rootId=text(body.rootId,64); if(rootId&&!seen.has(rootId)&&!expandScopes(scopes).includes(rootId))throw fail('Root device must be in the scan scope.');
  return {username,port,timeout,concurrency,devices:targets,scopes,rootId,saveConfig:body.saveConfig!==false};
}
export const emptyTopology=()=>({nodes:[],links:[],updatedAt:null});
export function buildTopology(nodes, previous=emptyTopology()) {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const aliases=new Map();
  const alias=(key,id)=>{if(!key)return;key=key.toLowerCase();if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(id);};
  for(const n of nodes){alias(n.address,n.id);alias(n.name,n.id);alias(n.hostname,n.id);alias(n.hostname?.split('.')[0],n.id);}
  const lookup=key=>{const ids=aliases.get(String(key||'').toLowerCase());return ids?.size===1?[...ids][0]:null;};
  const links=new Map();
  for(const n of nodes)for(const neighbor of n.neighbors||[]) {
    const other=lookup(neighbor.address)||lookup(neighbor.deviceId)||lookup(neighbor.deviceId?.split('.')[0]);
    if(!other||other===n.id)continue;
    const local=normalizePort(neighbor.localPort),remote=normalizePort(neighbor.remotePort);
    const reverse=n.id>other,source=reverse?other:n.id,target=reverse?n.id:other;
    const sourcePort=reverse?remote:local,targetPort=reverse?local:remote;
    const id=[source,sourcePort,target,targetPort].join('|');
    const old=links.get(id);
    links.set(id,{id,source,target,sourcePort,targetPort,protocol:old?`${old.protocol}/${neighbor.protocol}`:neighbor.protocol,
      observedAt:n.collectedAt,confidence:old?'confirmed':'observed',state:'unknown'});
  }
  // Keep a previous cable visible when an endpoint fails; never invent a disconnect.
  for(const l of previous.links||[])if(!links.has(l.id)&&byId.has(l.source)&&byId.has(l.target))links.set(l.id,{...l,confidence:'stale',state:'unknown'});
  for(const l of links.values()) {
    const a=byId.get(l.source),b=byId.get(l.target);
    const ap=a.ports?.find(p=>normalizePort(p.name)===l.sourcePort),bp=b.ports?.find(p=>normalizePort(p.name)===l.targetPort);
    const fresh=n=>['online','partial'].includes(n.status)&&n.collectedAt===n.checkedAt;
    const observations=[[a,ap],[b,bp]].filter(([n,p])=>fresh(n)&&p);
    if(observations.some(([,p])=>['down','disabled','err-disabled'].includes(p.status)))l.state='down';
    else if(observations.some(([,p])=>p.status==='up')&&l.confidence!=='stale')l.state='up';
    if(a.status==='unreachable'||b.status==='unreachable')l.state='unknown';
  }
  return {nodes,links:[...links.values()],updatedAt:new Date().toISOString()};
}
function reachable(topology,root,omitNode,omitLink) {
  if(!root||root===omitNode||!topology.nodes.some(n=>n.id===root))return new Set();
  const found=new Set([root]),queue=[root];
  while(queue.length){const id=queue.shift();for(const l of topology.links){
    if(l.id===omitLink||l.source===omitNode||l.target===omitNode||l.state==='down')continue;
    const other=l.source===id?l.target:l.target===id?l.source:null;
    if(other&&!found.has(other)){found.add(other);queue.push(other);}
  }}return found;
}
export function impact(topology,root,{nodeId,linkId}={}) {
  const before=reachable(topology,root),after=reachable(topology,root,nodeId,linkId);
  return {affected:[...before].filter(id=>!after.has(id)),unmapped:topology.nodes.filter(n=>!before.has(n.id)).map(n=>n.id),
    confidence:'topology-only',note:'Physical topology estimate; STP, LAG, VLANs and routing may change the actual effect.'};
}
function shortest(topology,root,target) {
  const queue=[[root,[]]],seen=new Set([root]);
  while(queue.length){const [id,path]=queue.shift();if(id===target)return path;
    for(const l of topology.links){if(l.state==='down')continue;const next=l.source===id?l.target:l.target===id?l.source:null;
      if(next&&!seen.has(next)){seen.add(next);queue.push([next,[...path,l.id]]);}}
  }return null;
}
export function traceMac(topology,mac,root) {
  mac=normalizeMac(mac); const observations=[];
  for(const n of topology.nodes)for(const row of n.macs||[])if(row.mac===mac){
    const uplink=topology.links.some(l=>(l.source===n.id&&l.sourcePort===normalizePort(row.port))||(l.target===n.id&&l.targetPort===normalizePort(row.port)));
    const port=n.ports?.find(p=>normalizePort(p.name)===normalizePort(row.port));
    observations.push({...row,nodeId:n.id,nodeName:n.name,observedAt:n.collectedAt,source:n.platform==='mikrotik'?'bridge-host':'mac-address-table',
      candidate:!uplink&&port?.mode!=='trunk',stale:!['online','partial'].includes(n.status)||Date.now()-Date.parse(n.collectedAt)>300000});
  }
  const candidates=observations.filter(o=>o.candidate);
  return {mac,observations,candidates,paths:candidates.map(o=>({nodeId:o.nodeId,port:o.port,links:shortest(topology,root,o.nodeId)})),
    confidence:candidates.length===1&&!candidates[0].stale?'candidate':'uncertain'};
}
export function layoutInput(body) {
  if(!body||typeof body.positions!=='object'||Array.isArray(body.positions)||!body.positions)throw fail('Invalid map layout.');
  const positions={};if(Object.keys(body.positions).length>500)throw fail('Layout limit exceeded.');
  for(const [id,p] of Object.entries(body.positions)){
    if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||p.x<0||p.x>2000||p.y<0||p.y>1200)throw fail('Invalid position.');
    positions[text(id,100)]={x:p.x,y:p.y};
  }
  const background=String(body.background||'');
  if(background.length>4*1024*1024|| (background&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(background)))throw fail('Use a PNG, JPEG or WebP image under 3 MB.');
  if(background){const bytes=Buffer.from(background.split(',')[1],'base64');const ok=(bytes[0]===137&&bytes.toString('ascii',1,4)==='PNG')||(bytes[0]===255&&bytes[1]===216)||(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');if(!ok)throw fail('Invalid image data.');}
  return {positions,background};
}
