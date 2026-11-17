const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const naukri=host=>host==='naukri.com'||host.endsWith('.naukri.com');
class PrivateSessionStore{
 constructor({key=process.env.NAUKRI_SESSION_KEY,dir=process.env.NAUKRI_SESSION_DIR||path.resolve(__dirname,'../secrets/browser-sessions')}={}){this.key=/^[a-f0-9]{64}$/i.test(key||'')?Buffer.from(key,'hex'):null;this.dir=dir;}
 ownerKey(owner){return createHash('sha256').update(String(owner)).digest('hex');}
 async save(owner,state){if(!this.key)return false;const id=this.ownerKey(owner),now=Date.now(),filtered={cookies:(state.cookies||[]).filter(c=>naukri(c.domain.replace(/^\./,''))&&(c.expires===-1||c.expires*1000>now)),origins:(state.origins||[]).filter(o=>{try{const u=new URL(o.origin);return u.protocol==='https:'&&naukri(u.hostname);}catch{return false;}})};const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(JSON.stringify({state:filtered,expiresAt:now+30*86400000}),'utf8'),cipher.final()]);await fs.mkdir(this.dir,{recursive:true,mode:0o700});const file=path.join(this.dir,id+'.enc'),temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';await fs.writeFile(temp,Buffer.concat([iv,cipher.getAuthTag(),data]),{mode:0o600,flag:'wx'});await fs.rename(temp,file);return true;}
 async load(owner){if(!this.key)return null;try{const id=this.ownerKey(owner),all=await fs.readFile(path.join(this.dir,id+'.enc')),cipher=createDecipheriv('aes-256-gcm',this.key,all.subarray(0,12));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(all.subarray(12,28));const item=JSON.parse(Buffer.concat([cipher.update(all.subarray(28)),cipher.final()]).toString('utf8'));if(item.expiresAt<=Date.now()){await this.remove(owner);return null;}return item.state;}catch{return null;}}
 async remove(owner){await fs.unlink(path.join(this.dir,this.ownerKey(owner)+'.enc')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
module.exports={PrivateSessionStore};
