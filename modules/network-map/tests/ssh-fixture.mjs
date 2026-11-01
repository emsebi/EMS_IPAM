import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire('/app/package.json');
const {Server}=require('ssh2');
const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});

const outputs={
 'terminal length 0':'',
 'terminal width 512':'',
 'show version':`Cisco IOS XE Software, Version 17.12.1
FixtureSwitch uptime is 1 day, 2 hours
cisco C9300-24T (X86) processor
Processor board ID FOC0000TEST
Model Number : C9300-24T`,
 'show interfaces status':`Gi1/0/1 Synthetic-Uplink connected trunk a-full a-1000 1000BaseSX
Gi1/0/2 Synthetic-Client connected 10 a-full a-1000 10/100/1000BaseTX`,
 'show interfaces switchport':`Name: Gi1/0/1
Administrative Mode: trunk
Operational Mode: trunk
Trunking Native Mode VLAN: 1
Trunking VLANs Enabled: 10,20
Voice VLAN: none
Name: Gi1/0/2
Administrative Mode: static access
Operational Mode: static access
Trunking Native Mode VLAN: 1
Trunking VLANs Enabled: ALL
Voice VLAN: none`,
 'show cdp neighbors detail':`Device ID: SyntheticEdge
Entry address(es):
  IP address: 192.0.2.22
Platform: cisco WS-C2960, Capabilities: Switch
Interface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet0/24
Holdtime : 122 sec`,
 'show lldp neighbors detail':`Local Intf: Gi1/0/1
Chassis id: 00:aa:bb:cc:dd:ee
Port id: Gi0/24
System Name: SyntheticEdge
Management Addresses:
    IP: 192.0.2.22`,
 'show mac address-table':`  10    0011.2233.4455    DYNAMIC     Gi1/0/2`,
 'show power inline':`Gi1/0/2 auto on 15.4 Ieee PD`,
 'show running-config':`Current configuration : 2048 bytes
hostname FixtureSwitch
aaa new-model
snmp-server community synthetic-community-value RO
username map-readonly privilege 1 secret synthetic-enable-secret
ip dhcp snooping
interface GigabitEthernet1/0/1
 switchport mode trunk
interface GigabitEthernet1/0/2
 switchport access vlan 10
 switchport port-security`,
};

const server=new Server({hostKeys:[privateKey]},client=>{
 client.on('error',()=>{});
 client.on('authentication',context=>{
  if(context.method==='password'&&context.username==='map-readonly'&&context.password==='Synthetic-Map-Password')context.accept();
  else context.reject();
 }).on('ready',()=>client.on('session',accept=>{
  const session=accept();
  session.on('pty',acceptPty=>acceptPty()).on('shell',acceptShell=>{
   const stream=acceptShell();let pending='';
   stream.write('FixtureSwitch# ');
   stream.on('data',chunk=>{
    pending+=chunk.toString().replace(/\r/g,'');
    while(pending.includes('\n')){
     const index=pending.indexOf('\n'),command=pending.slice(0,index).trim();pending=pending.slice(index+1);
     if(!command)continue;
     const output=Object.hasOwn(outputs,command)?outputs[command]:'% Invalid input detected at synthetic fixture';
     stream.write(command+'\r\n'+(output?output+'\r\n':'')+'FixtureSwitch# ');
    }
   });
  });
 }));
});

server.listen(2222,'0.0.0.0',()=>console.log('Synthetic read-only SSH fixture listening on 2222'));
const stop=()=>server.close(()=>process.exit(0));
process.on('SIGTERM',stop);process.on('SIGINT',stop);
