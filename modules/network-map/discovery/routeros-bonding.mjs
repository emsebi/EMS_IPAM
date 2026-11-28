export const MAX_BOND_MONITORS=32;

// Select by exact name rather than a mutable print index. Never interpolate CLI
// metacharacters from equipment output. Unrepresentable names remain unverified.
export function routerosBondMonitorCommand(name) {
  if(typeof name!=='string'||!name.trim()||!/^[A-Za-z0-9_. :/-]{1,80}$/.test(name))return null;
  return `/interface bonding monitor [find where name="${name}"] once`;
}

const list=value=>String(value||'').split(',').map(s=>s.trim().replace(/^"|"$/g,'')).filter(s=>s&&s!=='none');
function monitor(raw,mode,members) {
  const fields={};let key='',valid=typeof raw==='string'&&!/^\s*(?:failure:|bad command name|not enough permissions|expected end of command)/im.test(raw);
  for(const line of String(raw||'').split(/\r?\n/)){
    const match=line.match(/^\s*([a-z][a-z0-9-]*):[ \t]*(.*)$/);
    if(match){key=match[1];if(Object.hasOwn(fields,key))valid=false;fields[key]=match[2].trim();}
    else if(line.trim()&&['active-ports','inactive-ports'].includes(key))fields[key]+=(fields[key]?',':'')+line.trim();
  }
  const active=list(fields['active-ports']),inactive=list(fields['inactive-ports']),all=[...active,...inactive];
  valid=valid&&typeof mode==='string'&&mode.length>0&&fields.mode===mode&&Object.hasOwn(fields,'active-ports')&&Object.hasOwn(fields,'inactive-ports')
    &&new Set(all).size===all.length&&all.length===members.length&&all.every(p=>members.includes(p));
  return {valid,active:new Set(active)};
}

export function parseRouterosBonds(rows,monitors,ports) {
  return rows.filter(r=>r.name&&r.slaves!==undefined).map(row=>{
    const names=list(row.slaves),iface=ports.find(p=>p.name===row.name),disabled=row.flags.includes('X')||iface?.status==='disabled';
    const observed=monitor(Object.hasOwn(monitors||{},row.name)?monitors[row.name]:null,row.mode,names);
    const state=disabled||iface?.status==='down'?'down':!observed.valid?'unknown':observed.active.size?'up':'down';
    return {kind:'routeros-bond',name:row.name,protocol:row.mode||'unknown',flags:row.flags,state,
      monitorStatus:disabled?'disabled':observed.valid?'observed':'unavailable',
      members:names.map(port=>({port,flags:disabled?'disabled':!observed.valid?'unknown':observed.active.has(port)?'active':'inactive',
        state:disabled?'inactive':!observed.valid?'unknown':observed.active.has(port)?'bundled':'inactive'}))};
  });
}
