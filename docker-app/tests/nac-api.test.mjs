import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fileURLToPath} from 'node:url';
import {migrateDatabase,migrateModuleSchemas} from '../server/migrations.mjs';
import {createModule} from '../../modules/network-access/backend/index.mjs';
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const macId='33333333-3333-4333-8333-333333333333';
const poolOf=db=>{
  const query=async (sql,params)=> {
    const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);
    return {rows:r?.rows||[],rowCount:r?.rowCount??r?.affectedRows??r?.rows?.length??0};
  };
  return {query,connect:async()=>({query,release(){}})};
};
test('NAC independent migration, switch-profile CRUD, source registry and no live RADIUS writes',async()=>{
  const db=new PGlite(),pool=poolOf(db);
  const audits=[];
  try{
    await migrateDatabase(pool);
    const moduleDir=fileURLToPath(new URL('../../modules/network-access/',import.meta.url));
    const migrations=await migrateModuleSchemas(pool,[{id:'network-access',dir:moduleDir}]);
    assert.deepEqual(migrations.failed,[],'NAC must migrate even before radius-ops is installed');
    assert.equal(migrations.applied.length,1);
    // Stub the existing module-owned tables. NAC does NOT duplicate their contents.
    await pool.query('CREATE TABLE radius_ops_devices(id uuid PRIMARY KEY,label text NOT NULL,vendor text NOT NULL,nas_ip inet NOT NULL,company_id text,enabled boolean NOT NULL)');
    await pool.query('CREATE TABLE radius_ops_macs(id uuid PRIMARY KEY,mac macaddr NOT NULL,company_id text,enabled boolean NOT NULL,vlan smallint)');
    await pool.query("INSERT INTO radius_ops_devices VALUES($1,'Switch A','cisco-legacy','192.0.2.11','company-a',true),($2,'Switch B','mikrotik','192.0.2.12','company-a',true)",[a,b]);
    await pool.query("INSERT INTO radius_ops_macs VALUES($1,'a0:bb:cc:dd:ee:f0','company-a',true,14)",[macId]);
    await pool.query("CREATE TABLE radcheck(dummy text); CREATE TABLE radreply(dummy text)");
    await pool.query("INSERT INTO radcheck VALUES('original'); INSERT INTO radreply VALUES('original')");
    const module=createModule({pool,readBody:async req=>req.body,
      requireModuleAccess:async(user,moduleId)=>{assert.equal(moduleId,'network-access');if(user.role!=='admin')throw Object.assign(new Error('forbidden'),{status:403});},
      requireAdmin:user=>{if(user.role!=='admin')throw Object.assign(new Error('forbidden'),{status:403});},
      json:(res,status,body)=>{res.status=status;res.body=body;return body;},
      audit:async(_actor,action)=>audits.push(action)});
    const call=async(method,path,body,role='admin')=>{
      const res={setHeader(){}};
      await module.handle({method,body},res,new URL('http://ems.local'+path),{role});
      return res.body;
    };
    await assert.rejects(()=>call('GET','/api/nac/overview',null,'viewer'),{status:403});
    const guest=(await call('POST','/api/nac/profiles',{name:'Guest A',description:'',enabled:true,
      knownMode:'accept-vlan',knownVlan:14,unknownMode:'guest-vlan',guestVlan:77})).profile;
    const deny=(await call('POST','/api/nac/profiles',{name:'Deny B',description:'',enabled:true,
      knownMode:'accept-static',knownVlan:null,unknownMode:'reject',guestVlan:null})).profile;
    assert.ok(guest.id && deny.id);
    await call('PUT','/api/nac/nas/'+a,{profileId:guest.id,enabled:true});
    await call('PUT','/api/nac/nas/'+b,{profileId:deny.id,enabled:true});
    const unknown='a0:11:22:33:44:66';
    const first=(await call('GET','/api/nac/preview?nasId='+a+'&mac='+unknown)).result;
    const second=(await call('GET','/api/nac/preview?nasId='+b+'&mac='+unknown)).result;
    assert.equal(first.radiusOutcome,'Access-Reject');
    assert.equal(first.portOutcome,'guest-vlan-if-switch-configured');
    assert.equal(first.vlan,77);
    assert.equal(second.portOutcome,'blocked');
    const registered='a0:bb:cc:dd:ee:f0';
    assert.equal((await call('GET','/api/nac/preview?nasId='+a+'&mac='+registered)).result.vlan,14);
    const macVlanPolicy=(await call('POST','/api/nac/profiles',{name:'Per-device VLAN',description:'',enabled:true,
      knownMode:'accept-mac-vlan',knownVlan:null,unknownMode:'reject',guestVlan:null})).profile;
    await call('PUT','/api/nac/nas/'+a,{profileId:macVlanPolicy.id,enabled:true});
    assert.equal((await call('GET','/api/nac/preview?nasId='+a+'&mac='+registered)).result.vlan,14);
    await pool.query('UPDATE radius_ops_macs SET vlan=NULL WHERE id=$1',[macId]);
    assert.equal((await call('GET','/api/nac/preview?nasId='+a+'&mac='+registered)).result.reason,'registered-mac-vlan-not-set');
    await pool.query('UPDATE radius_ops_macs SET vlan=14 WHERE id=$1',[macId]);
    await call('PUT','/api/nac/nas/'+a,{profileId:guest.id,enabled:true});
    await call('PUT','/api/nac/nas/'+a+'/rules/'+registered,{mode:'reject',vlan:null,enabled:true,note:'quarantine'});
    assert.equal((await call('GET','/api/nac/preview?nasId='+a+'&mac='+registered)).result.decision,'reject');
    assert.equal((await call('GET','/api/nac/nas/'+a+'/rules')).items.length,1);
    assert.match((await call('GET','/api/nac/nas/'+a+'/config?radiusIp=192.0.2.20&interface=Gi1%2F0%2F7')).text,/dot1x guest-vlan 77/);
    assert.match((await call('GET','/api/nac/nas/'+b+'/config?radiusIp=192.0.2.20&interface=ether5')).text,/mac-auth/);
    await pool.query("UPDATE radius_ops_devices SET vendor='other' WHERE id=$1",[a]);
    await assert.rejects(()=>call('GET','/api/nac/nas/'+a+'/config?radiusIp=192.0.2.20&interface=Gi1%2F0%2F7'),{status:409});
    assert.match((await call('GET','/api/nac/nas/'+a+'/config?radiusIp=192.0.2.20&interface=Gi1%2F0%2F7&vendor=cisco-legacy')).text,/guest-vlan 77/);
    await assert.rejects(()=>call('GET','/api/nac/nas/'+b+'/config?radiusIp=192.0.2.20&interface=Gi1%2F0%2F7&vendor=cisco-legacy'),{status:409});
    await assert.rejects(()=>call('DELETE','/api/nac/profiles/'+guest.id),{status:409});
    await pool.query("UPDATE radius_ops_macs SET enabled=false WHERE id=$1",[macId]);
    assert.equal((await call('GET','/api/nac/preview?nasId='+a+'&mac='+registered)).result.reason,'mac-explicitly-disabled');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM radcheck')).rows[0].count,1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM radreply')).rows[0].count,1);
    assert.ok(audits.some(x=>x==='nac.profile.create'));
    assert.ok(audits.some(x=>x==='nac.nas.binding'));
    assert.ok(audits.some(x=>x==='nac.mac.rule'));
    const restarted=await migrateModuleSchemas(pool,[{id:'network-access',dir:moduleDir}]);
    assert.deepEqual(restarted,{applied:[],failed:[]});
  }finally{await db.close();}
});
