// Admin-only NAC policy drafts. The existing radius-ops FreeRADIUS authorization
// path is intentionally untouched: these APIs never apply a switch configuration.
import crypto from 'node:crypto';
import {validId,normalizeMac,prepareProfile,prepareRule,simulate,configDraft} from '../policy.mjs';
const root='/api/nac';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const id=v=>{if(!validId(v))throw fail('Invalid UUID');return v;};
const cols='id,name,description,enabled,known_mode AS "knownMode",known_vlan AS "knownVlan",unknown_mode AS "unknownMode",guest_vlan AS "guestVlan",updated_at AS "updatedAt"';
const profileFrom=(p)=>({
  name:p.name,description:p.description,enabled:p.enabled,
  knownMode:p.known_mode,knownVlan:p.known_vlan,
  unknownMode:p.unknown_mode,guestVlan:p.guest_vlan
});
async function nasById(pool,nasId){
  const result=await pool.query('SELECT id,label,vendor,nas_ip::text AS "nasIp",company_id AS "companyId",enabled FROM radius_ops_devices WHERE id=$1',[id(nasId)]);
  if(!result.rowCount)throw fail('NAS does not exist in RADIUS Operations',404);
  return result.rows[0];
}
async function profileById(pool,profileId){
  const r=await pool.query('SELECT * FROM nac_profiles WHERE id=$1',[id(profileId)]);
  if(!r.rowCount)throw fail('NAC profile not found',404);
  return r.rows[0];
}
export function createModule({pool,json,readBody,requireAdmin,requireModuleAccess,audit}){
  return {
    match:(_req,url)=>url.pathname===root||url.pathname.startsWith(root+'/'),
    async handle(req,res,url,user){
      await requireModuleAccess(user,'network-access');
      requireAdmin(user);
      res.setHeader('Cache-Control','no-store');
      const p=url.pathname,m=req.method;
      if(m==='GET'&&p===root+'/overview'){
        const [profiles,nas]=await Promise.all([
          pool.query('SELECT '+cols+' FROM nac_profiles ORDER BY name,id'),
          pool.query('SELECT d.id,d.label,d.vendor,d.enabled,d.nas_ip::text AS "nasIp",b.profile_id AS "profileId",b.enabled AS "bindingEnabled",p.name AS "profileName" FROM radius_ops_devices d LEFT JOIN nac_nas_bindings b ON b.nas_id=d.id LEFT JOIN nac_profiles p ON p.id=b.profile_id ORDER BY d.label,d.id')
        ]);
        return json(res,200,{ok:true,phase:'draft-not-enforced',profiles:profiles.rows,nas:nas.rows});
      }
      if(m==='POST'&&p===root+'/profiles'){
        const f=prepareProfile(await readBody(req)),newId=crypto.randomUUID();
        const r=await pool.query('INSERT INTO nac_profiles(id,name,description,enabled,known_mode,known_vlan,unknown_mode,guest_vlan) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(name) DO NOTHING RETURNING '+cols,
          [newId,f.name,f.description,f.enabled,f.knownMode,f.knownVlan,f.unknownMode,f.guestVlan]);
        if(!r.rowCount)throw fail('Profile name already exists',409);
        await audit?.(user,'nac.profile.create','nac_profile',newId,{detail:{name:f.name}});
        return json(res,201,{ok:true,profile:r.rows[0],phase:'draft-not-enforced'});
      }
      const hit=p.match(/^\/api\/nac\/profiles\/([^/]+)$/);
      if(hit&&m==='PUT'){
        const key=id(hit[1]),f=prepareProfile(await readBody(req));
        const r=await pool.query('UPDATE nac_profiles SET name=$2,description=$3,enabled=$4,known_mode=$5,known_vlan=$6,unknown_mode=$7,guest_vlan=$8,updated_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM nac_profiles x WHERE x.name=$2 AND x.id<>$1) RETURNING '+cols,
          [key,f.name,f.description,f.enabled,f.knownMode,f.knownVlan,f.unknownMode,f.guestVlan]);
        if(!r.rowCount)throw fail('Profile not found or name already in use',409);
        await audit?.(user,'nac.profile.update','nac_profile',key,{detail:{name:f.name}});
        return json(res,200,{ok:true,profile:r.rows[0]});
      }
      if(hit&&m==='DELETE'){
        const key=id(hit[1]);
        const r=await pool.query('DELETE FROM nac_profiles WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM nac_nas_bindings WHERE profile_id=$1) RETURNING id',[key]);
        if(!r.rowCount)throw fail('Profile not found or still assigned to a switch',409);
        await audit?.(user,'nac.profile.delete','nac_profile',key);
        return json(res,200,{ok:true});
      }
      const nasHit=p.match(/^\/api\/nac\/nas\/([^/]+)$/);
      if(nasHit&&m==='PUT'){
        const nas=await nasById(pool,nasHit[1]),body=await readBody(req);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['profileId','enabled'].includes(k))||
          typeof body.enabled!=='boolean')throw fail('Invalid NAS binding');
        const profile=await profileById(pool,body.profileId);
        if(body.enabled&&(!nas.enabled||!profile.enabled))throw fail('Enable the NAS and profile before enabling its draft binding',409);
        if(body.enabled&&nas.nasIp.includes('/')&&!nas.nasIp.endsWith('/32'))throw fail('Per-switch policy needs a single source-IP NAS (/32), not a shared CIDR',409);
        const r=await pool.query('INSERT INTO nac_nas_bindings(nas_id,profile_id,enabled) VALUES($1,$2,$3) ON CONFLICT(nas_id) DO UPDATE SET profile_id=excluded.profile_id,enabled=excluded.enabled,updated_at=now() RETURNING *',[nas.id,profile.id,body.enabled]);
        await audit?.(user,'nac.nas.binding','nac_nas_binding',nas.id,{detail:{profileId:profile.id,enabled:body.enabled}});
        return json(res,200,{ok:true,binding:r.rows[0],phase:'draft-not-enforced'});
      }
      const rulePath=p.match(/^\/api\/nac\/nas\/([^/]+)\/rules(?:\/([^/]+))?$/);
      if(rulePath){
        const nas=await nasById(pool,rulePath[1]);
        if(m==='GET'&&!rulePath[2]){
          const r=await pool.query('SELECT mac::text,mode,vlan,note,enabled,updated_at AS "updatedAt" FROM nac_mac_rules WHERE nas_id=$1 ORDER BY mac',[nas.id]);
          return json(res,200,{ok:true,items:r.rows});
        }
        if(rulePath[2]&&m==='PUT'){
          const mac=normalizeMac(decodeURIComponent(rulePath[2])),f=prepareRule(await readBody(req));
          const r=await pool.query('INSERT INTO nac_mac_rules(nas_id,mac,mode,vlan,note,enabled) VALUES($1,$2::macaddr,$3,$4,$5,$6) ON CONFLICT(nas_id,mac) DO UPDATE SET mode=excluded.mode,vlan=excluded.vlan,note=excluded.note,enabled=excluded.enabled,updated_at=now() RETURNING mac::text,mode,vlan,note,enabled',
            [nas.id,mac,f.mode,f.vlan,f.note,f.enabled]);
          await audit?.(user,'nac.mac.rule','nac_mac_rule',nas.id,{detail:{mac,mode:f.mode}});
          return json(res,200,{ok:true,rule:r.rows[0],phase:'draft-not-enforced'});
        }
        if(rulePath[2]&&m==='DELETE'){
          const mac=normalizeMac(decodeURIComponent(rulePath[2]));
          await pool.query('DELETE FROM nac_mac_rules WHERE nas_id=$1 AND mac=$2::macaddr',[nas.id,mac]);
          await audit?.(user,'nac.mac.delete','nac_mac_rule',nas.id,{detail:{mac}});
          return json(res,200,{ok:true});
        }
      }
      if(m==='GET'&&p===root+'/preview'){
        const nas=await nasById(pool,url.searchParams.get('nasId'));
        const mac=normalizeMac(url.searchParams.get('mac'));
        const [b,r,rule]=await Promise.all([
          pool.query('SELECT b.enabled AS "bindingEnabled",p.* FROM nac_nas_bindings b JOIN nac_profiles p ON p.id=b.profile_id WHERE b.nas_id=$1',[nas.id]),
          pool.query('SELECT id,mac::text,company_id AS "companyId",enabled,vlan FROM radius_ops_macs WHERE mac=$1::macaddr',[mac]),
          pool.query('SELECT mode,vlan,enabled FROM nac_mac_rules WHERE nas_id=$1 AND mac=$2::macaddr',[nas.id,mac])
        ]);
        const row=b.rows[0],profile=row?profileFrom(row):null;
        const binding=row?{enabled:row.bindingEnabled}:null;
        const result=simulate({nas,profile,binding,registry:r.rows[0]||null,rule:rule.rows[0]||null});
        return json(res,200,{ok:true,phase:'draft-not-enforced',mac,nas:{id:nas.id,label:nas.label,vendor:nas.vendor},result,
          caveat:'Simulation only; existing FreeRADIUS MAC authorization and switch behavior are unchanged.'});
      }
      const configPath=p.match(/^\/api\/nac\/nas\/([^/]+)\/config$/);
      if(configPath&&m==='GET'){
        const nas=await nasById(pool,configPath[1]);
        const r=await pool.query('SELECT p.* FROM nac_nas_bindings b JOIN nac_profiles p ON p.id=b.profile_id WHERE b.nas_id=$1',[nas.id]);
        if(!r.rowCount)throw fail('Assign a profile before generating a CLI draft',409);
        const content=configDraft({vendor:nas.vendor,interfaceName:url.searchParams.get('interface'),radiusIp:url.searchParams.get('radiusIp'),profile:profileFrom(r.rows[0])});
        return json(res,200,{ok:true,phase:'review-only',text:content});
      }
      throw fail('Unknown NAC endpoint',404);
    }
  };
}
