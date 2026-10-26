import {parseCdpNeighborsDetail,parseLldpNeighborsDetail,normalizePort} from './parsers.mjs';
import {normalizeMac} from '../backend/model.mjs';

export const commandFailed=s=>!s||/(?:%\s*(?:Invalid|Incomplete|Ambiguous|Authorization|Error)|not enough permissions|bad command name|syntax error|permission denied)/i.test(s);
const mac=s=>{try{return normalizeMac(s);}catch{return null;}};
const capability=(enabled,source,supported='unknown')=>({enabled,supported,source});
export function parseCisco(outputs) {
  const ports=[];
  for(const line of (outputs.ports||'').split(/\r?\n/)) {
    const m=line.match(/^\s*((?:Gi|Te|Fa|Eth|Et|Fo|Hu|Twe|Po)\S+)\s+(.*?)\s*(connected|notconnect|disabled|err-disabled|inactive|suspended|monitoring)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/i);
    if(m)ports.push({name:normalizePort(m[1]),description:m[2].trim(),status:m[3]==='connected'?'up':m[3]==='disabled'?'disabled':m[3]==='err-disabled'?'err-disabled':'down',
      mode:m[4]==='trunk'?'trunk':/^\d+$/.test(m[4])?'access':m[4]==='routed'?'routed':'unknown',vlan:m[4],duplex:m[5],speed:m[6],media:m[7]});
  }
  for(const block of (outputs.switchports||'').split(/(?=^Name:)/m)){
    const name=normalizePort(block.match(/^Name:\s*(\S+)/m)?.[1]);const p=ports.find(p=>p.name===name);if(!p)continue;
    const operational=block.match(/^Operational Mode:\s*(.+)/m)?.[1]||'';
    const admin=block.match(/^Administrative Mode:\s*(.+)/m)?.[1]||'';
    const mode=operational==='down'?admin:operational;
    p.mode=/trunk/.test(mode)?'trunk':/access/.test(mode)?'access':p.mode;
    p.adminMode=admin;p.nativeVlan=block.match(/^Trunking Native Mode VLAN:\s*(\d+)/m)?.[1]||'';
    p.allowedVlans=block.match(/^Trunking VLANs Enabled:\s*(.+)/m)?.[1]||'';
    p.voiceVlan=block.match(/^Voice VLAN:\s*(.+)/m)?.[1]||'';
  }
  const macs=[];
  for(const line of (outputs.macs||'').split(/\r?\n/)){
    const m=line.match(/^\s*\*?\s*(\d+)\s+([0-9a-f.:-]+)\s+(DYNAMIC|STATIC|SECURE)\s+(\S+)/i);
    if(m&&mac(m[2])&&m[4]!=='CPU')macs.push({mac:mac(m[2]),vlan:m[1],port:normalizePort(m[4]),kind:m[3].toLowerCase()});
  }
  const config=outputs.config||'',configOk=!commandFailed(config)&&/(?:^hostname |^interface |Current configuration)/m.test(config);
  const features={};
  for(const [name,pattern] of Object.entries({MAB:/^\s*mab\s*$/m,SNMP:/^snmp-server\s/m,AAA:/^aaa new-model/m,'802.1X':/^dot1x system-auth-control/m,'DHCP Snooping':/^ip dhcp snooping\s*$/m,DAI:/^ip arp inspection vlan/m,'Port Security':/^\s*switchport port-security\s*$/m}))features[name]=capability(configOk?pattern.test(config):null,'running-config');
  features.PoE=capability(commandFailed(outputs.poe)?null:/\s(?:auto|on|static)\s+on\s/i.test(outputs.poe),'show power inline',commandFailed(outputs.poe)?'unknown':'yes');
  const version=outputs.version||'';
  return {hostname:config.match(/^hostname\s+(\S+)/m)?.[1]||version.match(/^(\S+) uptime is/m)?.[1]||'',
    model:version.match(/Model [Nn]umber\s*:\s*(\S+)/)?.[1]||version.match(/^cisco\s+(\S+)\s+\(/im)?.[1]||'',
    os:version.match(/(?:Cisco IOS.*?Version|NXOS:\s*version)\s+([^,\r\n]+)/i)?.[1]||'',
    serial:version.match(/(?:System [Ss]erial [Nn]umber\s*:|Processor board ID)\s*(\S+)/)?.[1]||'',
    uptime:version.match(/uptime is (.+)/)?.[1]||'',ports,macs,features,
    neighbors:[...parseCdpNeighborsDetail(outputs.cdp),...parseLldpNeighborsDetail(outputs.lldp)]};
}
export function rosRows(raw) {
  const rows=[];let row=null;
  for(const line of String(raw||'').split(/\r?\n/)) {
    const start=line.match(/^\s*(\d+)\s+([A-Z ]*)\s*(?=[a-z][a-z0-9-]*=)/);
    if(start){row={flags:start[2].trim()};rows.push(row);}
    if(!row)continue;
    for(const m of line.matchAll(/([a-z][a-z0-9-]*)=("(?:\\.|[^"\\])*"|[^\s]+)/g))row[m[1]]=m[2].replace(/^"|"$/g,'').replace(/\\"/g,'"');
  }return rows;
}
export function parseMikrotik(outputs) {
  const properties={};for(const line of (outputs.version||'').split(/\r?\n/)){const m=line.match(/^\s*([\w-]+):\s*(.*)$/);if(m)properties[m[1]]=m[2];}
  const bridgePorts=rosRows(outputs.bridgePorts),ports=rosRows(outputs.ports).map(p=>{
    const bridge=bridgePorts.find(b=>b.interface===p.name);
    return {name:p.name,status:p.flags.includes('X')?'disabled':p.flags.includes('R')?'up':'down',
      mode:bridge?.['frame-types']==='admit-only-vlan-tagged'?'trunk':bridge?.['frame-types']==='admit-only-untagged-and-priority-tagged'?'access':'unknown',
      vlan:bridge?.pvid||'',mac:p['mac-address']||'',media:p.type||'',description:p.comment||''};
  });
  const config=outputs.config||'',configOk=!commandFailed(config)&&config.includes('/');
  const features={SNMP:capability(commandFailed(outputs.snmp)?null:/enabled:\s*yes/.test(outputs.snmp),'snmp print'),
    AAA:capability(commandFailed(outputs.aaa)?null:/use-radius:\s*yes/.test(outputs.aaa),'user aaa print'),
    PoE:capability(commandFailed(outputs.poe)?null:rosRows(outputs.poe).some(p=>p['poe-out']&&p['poe-out']!=='off'),'ethernet poe print',commandFailed(outputs.poe)?'unknown':'yes'),
    MAB:capability(null,'not collected'), '802.1X':capability(configOk&&/\/interface dot1x server/.test(config)?true:null,'export')};
  return {hostname:(outputs.identity||'').match(/name:\s*(.+)/)?.[1]||'',model:properties['board-name']||'',os:properties.version||'',uptime:properties.uptime||'',ports,features,
    macs:rosRows(outputs.macs).filter(p=>mac(p['mac-address'])&&!p.flags.includes('L')).map(p=>({mac:mac(p['mac-address']),port:p['on-interface']||'',vlan:p.vid||'',kind:p.flags.includes('D')?'dynamic':'static'})),
    neighbors:rosRows(outputs.neighbors).map(p=>({deviceId:p.identity||p['mac-address'],address:p.address||'',localPort:p.interface||'',remotePort:p['interface-name']||'',protocol:p['discovered-by']||'mndp'}))};
}
export function redactConfig(value) {
  // A readable analysis/configuration export, explicitly not a full secret backup.
  const withoutKeys=String(value||'').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[PRIVATE KEY REDACTED]');
  const sensitive=/(?:password|passphrase|secret|community|private-key|pre-?shared-key|shared-secret|authentication-key|auth-key|encryption-key|privacy-key|key-string|(?:^|[-_])psk\b|\bkey\b)/i;
  return withoutKeys.split(/\r?\n/).map(line=>{
    if(/^\s*snmp-server\s+user\b/i.test(line))return 'snmp-server user [REDACTED]';
    const match=line.match(sensitive);if(!match)return line;
    return line.slice(0,match.index)+match[0]+' [REDACTED]';
  }).join('\n');
}
