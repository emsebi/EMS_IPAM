import {isIP} from 'node:net';
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function name(v){if(typeof v!=='string'||!v.trim()||v.trim().length>120||/[\u0000-\u001f\u007f]/.test(v))throw fail('Invalid name');return v.trim();}
export function user(v){if(typeof v!=='string'||!/^[A-Za-z][A-Za-z0-9_.@-]{0,63}$/.test(v))throw fail('Invalid username');return v;}
export function password(v){if(typeof v!=='string'||v.length<1||/[\u0000-\u001f\u007f]/.test(v))throw fail('Password must be non-empty and must not contain control characters');return v;}
export function secret(v){if(typeof v!=='string'||v.length<1||!/^[A-Za-z0-9._@%+=:,!^-]+$/.test(v))throw fail('NAS secret must be non-empty safe ASCII');return v;}
export function ip(v){if(typeof v!=='string'||isIP(v)!==4||Number(v.split('.')[0])===0||Number(v.split('.')[0])>=224)throw fail('Invalid IPv4');return v;}
function ipv4Int(v){return v.split('.').reduce((n,p)=>((n<<8)|Number(p))>>>0,0)>>>0;}
function intIpv4(n){return [24,16,8,0].map(s=>(n>>>s)&255).join('.');}
export function nasSource(v){
 if(typeof v!=='string')throw fail('Invalid NAS IP/CIDR');
 const raw=v.trim(),parts=raw.split('/');
 if(parts.length>2||isIP(parts[0])!==4||Number(parts[0].split('.')[0])>=224)throw fail('Invalid NAS IP/CIDR');
 if(parts.length===1){
  if(Number(parts[0].split('.')[0])===0)throw fail('Invalid NAS IP/CIDR');
  return parts[0];
 }
 if(!/^(?:0|[8-9]|[12][0-9]|3[0-2])$/.test(parts[1]))throw fail('NAS CIDR prefix must be /0 or between /8 and /32');
 const prefix=Number(parts[1]);
 // /0 is an explicit dynamic-NAS fallback.  Do not silently turn arbitrary
 // 0/8 addresses into exact clients, and keep the historical /8 minimum for
 // all narrower broad-client definitions.
 if(prefix===0)return '0.0.0.0/0';
 if(Number(parts[0].split('.')[0])===0)throw fail('Invalid NAS IP/CIDR');
 if(prefix===32)return parts[0];
 const mask=(0xffffffff << (32-prefix))>>>0;
 return `${intIpv4(ipv4Int(parts[0])&mask)}/${prefix}`;
}
export function accessScope(v){
 if(typeof v!=='string')throw fail('Invalid access scope');
 const raw=v.trim(),parts=raw.split('/');
 if(parts.length>2||isIP(parts[0])!==4||Number(parts[0].split('.')[0])>=224)throw fail('Invalid access scope');
 const prefix=parts.length===1?32:Number(parts[1]);
 if(!Number.isInteger(prefix)||prefix<0||prefix>32||String(prefix)!==(parts[1]??'32'))throw fail('Access scope prefix must be between /0 and /32');
 if(prefix===32)return parts[0];
 const mask=prefix===0?0:(0xffffffff << (32-prefix))>>>0;
 return `${intIpv4(ipv4Int(parts[0])&mask)}/${prefix}`;
}
export function mac(v){if(typeof v!=='string')throw fail('Invalid MAC');const x=v.replace(/[.:-]/g,'').toLowerCase();if(!/^[0-9a-f]{12}$/.test(x)||x==='000000000000'||(parseInt(x.slice(0,2),16)&1))throw fail('Invalid unicast MAC');return x.match(/../g).join(':');}
export function aliases(v){const h=mac(v).replaceAll(':','');return [...new Set([h,h.toUpperCase(),h.match(/.{4}/g).join('.'),h.match(/.{4}/g).join('.').toUpperCase(),h.match(/.{2}/g).join(':'),h.match(/.{2}/g).join(':').toUpperCase(),h.match(/.{2}/g).join('-'),h.match(/.{2}/g).join('-').toUpperCase()])];}
export function vid(v){if(v===null||v===undefined||v==='')return null;if(!/^[1-9][0-9]{0,3}$/.test(String(v))||Number(v)>4094)throw fail('Invalid VLAN');return Number(v);}
export function priv(v){if(!/^(?:[0-9]|1[0-5])$/.test(String(v)))throw fail('Invalid privilege');return Number(v);}
export function checkVendor(v){if(!['cisco-legacy','cisco-ios','mikrotik','other'].includes(v))throw fail('Invalid NAS vendor');return v;}
export function checkAccountVendor(v){if(!['cisco','mikrotik','generic'].includes(v))throw fail('Invalid account vendor');return v;}
export function checkGroup(v){if(typeof v!=='string'||!/^[A-Za-z0-9_.-]{1,32}$/.test(v))throw fail('Invalid RouterOS group');return v;}
export function replies(a){if(a.vlan!==null&&a.vlan!==undefined)return [['Tunnel-Type','VLAN'],['Tunnel-Medium-Type','IEEE-802'],['Tunnel-Private-Group-Id',String(vid(a.vlan))]];if(a.vendor==='cisco')return [['Cisco-AVPair',`shell:priv-lvl=${priv(a.privilege)}`]];if(a.vendor==='mikrotik')return [['Mikrotik-Group',checkGroup(a.mikrotik_group)]];return [];}
export function cli(d,server,mode='admin',iface='GigabitEthernet0/1'){
 const s=secret(d.secret),rip=ip(server);checkVendor(d.vendor);
 if(!['admin','mab','dot1x'].includes(mode))throw fail('Invalid mode');
 if(mode==='dot1x')throw fail('802.1X/EAP is disabled until a trusted certificate and tested EAP configuration are provisioned',409);
 if(d.vendor==='mikrotik')return mode==='admin'?`/radius add address=${rip} service=login secret="${s}" authentication-port=1812 accounting-port=1813\n/user aaa set use-radius=yes accounting=yes default-group=read\n# Keep a tested local administrator.\n`:'# Model-specific RouterOS 802.1X/MAB configuration requires validation.';
 if(d.vendor==='other')return '# Select Cisco or MikroTik for supported CLI.';
 const common=d.vendor==='cisco-legacy'?`aaa new-model\nradius-server host ${rip} auth-port 1812 acct-port 1813 key ${s}\n`:`aaa new-model\nradius server EMS-RADIUS\n address ipv4 ${rip} auth-port 1812 acct-port 1813\n key ${s}\n`;
 if(mode==='admin')return common+'aaa authentication login default group radius local\naaa authorization exec default group radius local\n# Preserve local break-glass access.\n';
 if(!/^(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|Ethernet)[0-9/]{1,24}$/.test(iface))throw fail('Invalid Cisco interface');
 return common+`aaa authentication dot1x default group radius\naaa authorization network default group radius\ndot1x system-auth-control\ninterface ${iface}\n switchport mode access\n authentication port-control auto\n ${mode==='mab'?'mab\n authentication order mab\n authentication priority mab':'dot1x pae authenticator'}\n spanning-tree portfast\n# Verify IOS/IBNS syntax on this exact model before applying.\n# Preserve console and local recovery access.\n`;
}
