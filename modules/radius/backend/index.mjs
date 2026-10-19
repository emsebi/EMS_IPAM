import crypto from "node:crypto";
import { isIP } from "node:net";

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function validateNetwork(value) {
  if (typeof value!=="string") throw fail("NAS IP/CIDR is required");
  const v=value.trim(); const [ip,bits,...extra]=v.split("/");
  const family=isIP(ip);
  if (!family || extra.length || (bits!==undefined && (!/^\d+$/.test(bits) || +bits>(family===4?32:128)))) throw fail("Invalid NAS IP/CIDR");
  return v;
}
function encryptionKey() {
  const hex=process.env.EMS_RADIUS_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw fail("EMS_RADIUS_ENCRYPTION_KEY must be set to 64 hexadecimal characters",503);
  return Buffer.from(hex,"hex");
}
function encrypt(value) {
  if (typeof value!=="string" || value.length<12 || value.length>256) throw fail("NAS secret must be 12-256 characters");
  const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey(),nonce);
  const data=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",nonce.toString("base64"),cipher.getAuthTag().toString("base64"),data.toString("base64")].join(":");
}
function payload(row) {return {id:row.id,name:row.name,network:row.network,vendor:row.vendor,enabled:row.enabled,createdAt:row.created_at,updatedAt:row.updated_at,secretConfigured:true};}
export function createModule(ctx) {
  const {pool,json,readBody,requireAdmin,audit}=ctx;
  return {
    match:(req,url)=>url.pathname.startsWith("/api/radius/") && ["GET","POST","PUT","DELETE"].includes(req.method),
    async handle(req,res,url,user) {
      requireAdmin(user);
      const path=url.pathname;
      if(path==="/api/radius/nas" && req.method==="GET") {
        const {rows}=await pool.query("SELECT id,name,network::text,vendor,enabled,created_at,updated_at FROM radius_access_devices ORDER BY name");
        return json(res,200,{ok:true,items:rows.map(payload)});
      }
      if(path==="/api/radius/nas" && req.method==="POST") {
        const b=await readBody(req),name=String(b.name??"").trim().slice(0,120),network=validateNetwork(b.network),vendor=b.vendor;
        if(!name || !["cisco","mikrotik"].includes(vendor)) throw fail("Invalid name/vendor");
        const id=crypto.randomUUID(),secret=encrypt(b.secret);
        await pool.query("INSERT INTO radius_access_devices(id,name,network,vendor,secret_encrypted,enabled) VALUES($1,$2,$3::cidr,$4,$5,$6)",[id,name,network,vendor,secret,b.enabled!==false]);
        await audit(user,"create","radius_nas",id,{detail:{name,network,vendor}});
        return json(res,201,{ok:true,id});
      }
      const m=path.match(/^\/api\/radius\/nas\/([0-9a-f-]{36})$/i);
      if(m && req.method==="PUT") {
        const b=await readBody(req),name=String(b.name??"").trim().slice(0,120),network=validateNetwork(b.network),vendor=b.vendor;
        if(!name || !["cisco","mikrotik"].includes(vendor)) throw fail("Invalid name/vendor");
        const secret=b.secret==null || b.secret===""?null:encrypt(b.secret);
        const result=await pool.query(`UPDATE radius_access_devices SET name=$2,network=$3::cidr,vendor=$4,enabled=$5,secret_encrypted=COALESCE($6,secret_encrypted),updated_at=now() WHERE id=$1`,[m[1],name,network,vendor,b.enabled!==false,secret]);
        if(!result.rowCount) throw fail("NAS not found",404);
        await audit(user,"update","radius_nas",m[1],{detail:{name,network,vendor}});
        return json(res,200,{ok:true});
      }
      if(m && req.method==="DELETE") {
        const result=await pool.query("DELETE FROM radius_access_devices WHERE id=$1",[m[1]]);
        if(!result.rowCount) throw fail("NAS not found",404);
        await audit(user,"delete","radius_nas",m[1]);
        return json(res,200,{ok:true});
      }
      if(path==="/api/radius/profiles" && req.method==="GET") {
        const {rows}=await pool.query("SELECT id,name,cisco_privilege AS \"ciscoPrivilege\",mikrotik_group AS \"mikrotikGroup\" FROM radius_profiles ORDER BY name");
        return json(res,200,{ok:true,items:rows});
      }
      if(path==="/api/radius/profiles" && req.method==="POST") {
        const b=await readBody(req),name=String(b.name??"").trim().slice(0,100),group=String(b.mikrotikGroup??"read").trim(),priv=Number(b.ciscoPrivilege);
        if(!name || !Number.isInteger(priv) || priv<0 || priv>15 || !/^[a-zA-Z0-9_-]{1,80}$/.test(group)) throw fail("Invalid RADIUS profile");
        const id=crypto.randomUUID();
        await pool.query("INSERT INTO radius_profiles(id,name,cisco_privilege,mikrotik_group) VALUES($1,$2,$3,$4)",[id,name,priv,group]);
        await audit(user,"create","radius_profile",id,{detail:{name}});
        return json(res,201,{ok:true,id});
      }
      if(path==="/api/radius/events" && req.method==="GET") {
        const {rows}=await pool.query("SELECT id,occurred_at AS \"occurredAt\",username,nas_ip::text AS \"nasIp\",event_type AS \"eventType\",session_id AS \"sessionId\" FROM radius_auth_events ORDER BY occurred_at DESC LIMIT 200");
        return json(res,200,{ok:true,items:rows});
      }
      return json(res,404,{ok:false,error:"Unknown RADIUS endpoint"});
    }
  };
}
