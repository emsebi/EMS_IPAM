import net from 'node:net';
import {parseCisco,parseMikrotik,commandFailed,redactConfig} from './device-parsers.mjs';

export function probeTcp(host,port,timeout=1500){return new Promise(resolve=>{
  const socket=net.connect({host,port});let done=false;
  const finish=result=>{if(done)return;done=true;socket.destroy();resolve(result);};
  socket.setTimeout(timeout,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
});}
const ciscoCommands={version:'show version',ports:'show interfaces status',switchports:'show interfaces switchport',cdp:'show cdp neighbors detail',lldp:'show lldp neighbors detail',macs:'show mac address-table',poe:'show power inline',config:'show running-config'};
const rosCommands={version:'/system resource print',identity:'/system identity print',ports:'/interface print detail without-paging',bridgePorts:'/interface bridge port print detail without-paging',neighbors:'/ip neighbor print detail without-paging',macs:'/interface bridge host print detail without-paging',snmp:'/snmp print',aaa:'/user aaa print',poe:'/interface ethernet poe print detail without-paging',config:'/export'};
const strip=s=>s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'').replace(/\r/g,'');

// Only the fixed read commands above can reach the equipment. No arbitrary CLI API.
export async function collectDevice(target,settings,password,{createSshClient,verifyHostKey}) {
  const client=createSshClient();const timeout=settings.timeout*1000;let mismatch=false,stream,waiter,pending='',platform=target.platform;
  let sessionError=null;
  const rejectPending=e=>{sessionError=e;if(waiter){clearTimeout(waiter.timer);const w=waiter;waiter=null;w.reject(e);}};
  try {
    await new Promise((resolve,reject)=>{
      client.once('ready',resolve);client.once('error',reject);
      client.connect({host:target.address,port:settings.port,username:settings.username,password,readyTimeout:timeout,keepaliveInterval:10000,keepaliveCountMax:2,
        hostHash:'sha256',hostVerifier:(hash,callback)=>{Promise.resolve(verifyHostKey(target.address,settings.port,hash)).then(ok=>{mismatch=!ok;callback(ok);}).catch(()=>{mismatch=true;callback(false);});}});
    });
    client.on('error',rejectPending);
    stream=await new Promise((resolve,reject)=>client.shell({term:'dumb',cols:512,rows:1000},(e,s)=>e?reject(e):resolve(s)));
    stream.on('error',rejectPending);stream.on('close',()=>rejectPending(new Error('SSH_CLOSED')));
    const receive=()=>{
      if(!waiter)return;
      const plain=strip(pending);
      // IOS/NX-OS prompts and RouterOS prompts. Match a complete final line.
      const match=plain.match(/(?:^|\n)([^\n]*?)(?:[>#])\s*$/);
      if(!match||(!/^\s*\[[^\]]+@[^\]]+\]/.test(match[1])&&!/^[\w.():/@-]{1,120}$/.test(match[1].trim())))return;
      const w=waiter;waiter=null;clearTimeout(w.timer);pending='';w.resolve({output:plain.slice(0,match.index).trim(),prompt:match[0]});
    };
    stream.on('data',chunk=>{pending+=chunk.toString();if(pending.length>2*1024*1024){rejectPending(new Error('OUTPUT_LIMIT'));stream.close();return;}receive();});
    const readPrompt=()=>new Promise((resolve,reject)=>{
      if(sessionError)return reject(sessionError);
      waiter={resolve,reject,timer:setTimeout(()=>{waiter=null;reject(new Error('COMMAND_TIMEOUT'));stream.close();},timeout)};receive();
    });
    const greeting=await readPrompt();
    if(platform==='auto')platform=/\[[^\]]+@/.test(greeting.prompt)?'mikrotik':'cisco';
    const run=async command=>{const result=readPrompt();stream.write(command+'\n');const {output}=await result;return output.replace(new RegExp('^'+command.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\n?'),'').trim();};
    if(platform==='cisco'){await run('terminal length 0');await run('terminal width 512');}
    const outputs={},errors=[];const commands=platform==='mikrotik'?rosCommands:ciscoCommands;
    for(const [key,original] of Object.entries(commands)) {
      // Running config also supplies capability evidence. It never enters the topology JSON.
      const command=platform==='mikrotik'&&key==='config'&&/version:\s*6\./.test(outputs.version)?'/export hide-sensitive':original;
      try{outputs[key]=await run(command);if(commandFailed(outputs[key]))errors.push(key);}catch{errors.push(key);break;}
    }
    const parsed=platform==='mikrotik'?parseMikrotik(outputs):parseCisco(outputs);
    if(!parsed.ports.length&&!parsed.model&&!parsed.os)throw new Error('NO_READ_ACCESS');
    return {...parsed,platform,status:errors.length?'partial':'online',errors,
      config:settings.saveConfig&&!commandFailed(outputs.config)?redactConfig(outputs.config):null};
  }catch(error){
    const status=mismatch?'host-key-changed':/authentication|NO_READ_ACCESS/i.test(error.message)?'auth-error':
      /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Timed out while waiting for handshake/i.test(error.message)?'unreachable':'collection-error';
    return {status,errors:[status]};
  }finally{stream?.close();client.end();}
}
