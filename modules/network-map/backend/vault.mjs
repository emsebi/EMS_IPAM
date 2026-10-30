import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function vault(directory) {
  let keyPromise;
  async function key(){return keyPromise??=(async()=>{
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const file=path.join(directory,'credentials.key');
    try{await fs.writeFile(file,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    const bytes=await fs.readFile(file);if(bytes.length!==32)throw new Error('Invalid discovery credential key.');return bytes;
  })().catch(e=>{keyPromise=null;throw e;});}
  return {
    async encrypt(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',await key(),iv);const out=Buffer.concat([c.update(value,'utf8'),c.final()]);return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),out.toString('base64')].join(':');},
    async decrypt(value){if(!value)return '';const [v,iv,tag,data]=value.split(':');if(v!=='v1')throw new Error('Invalid credential format.');const d=crypto.createDecipheriv('aes-256-gcm',await key(),Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString('utf8');}
  };
}
