import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {routerosOutputs} from './routeros-fixture-data.mjs';

const require=createRequire('/app/package.json'),{Server}=require('ssh2');
const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});
const outputs=routerosOutputs(),prompt='[map-readonly@SyntheticRouterOS] > ';
const server=new Server({hostKeys:[privateKey]},client=>{
 client.on('error',()=>{});
 client.on('authentication',ctx=>{
  if(ctx.method==='password'&&ctx.username==='map-readonly'&&ctx.password==='Synthetic-Map-Password')ctx.accept();else ctx.reject();
 }).on('ready',()=>client.on('session',accept=>{
  const session=accept();session.on('pty',acceptPty=>acceptPty()).on('shell',acceptShell=>{
   const stream=acceptShell();let pending='';stream.write(prompt);
   stream.on('data',chunk=>{
    pending+=chunk.toString().replace(/\r/g,'');
    while(pending.includes('\n')){
     const index=pending.indexOf('\n'),command=pending.slice(0,index).trim();pending=pending.slice(index+1);
     if(!command)continue;
     const output=Object.hasOwn(outputs,command)?outputs[command]:'failure: unsupported synthetic command';
     stream.write(command+'\r\n'+(output?output+'\r\n':'')+prompt);
    }
   });
  });
 }));
});
server.listen(2222,'0.0.0.0',()=>console.log('Synthetic RouterOS SSH fixture listening on 2222'));
const stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);
