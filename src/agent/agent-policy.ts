import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'crypto';
import { isIP } from 'net';
export const terminalStates=new Set(['CONFIRMED','FAILED','CANCELLED','SKIPPED']);
export function agentKey(){const raw=process.env.CLOUD_AGENT_ENCRYPTION_KEY||'';if(!/^[a-f0-9]{64}$/i.test(raw))throw Error('Cloud agent encryption key is not configured.');return Buffer.from(raw,'hex');}
export function seal(value:any){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',agentKey(),iv);const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
export function unseal(value:string){const all=Buffer.from(value,'base64');const cipher=createDecipheriv('aes-256-gcm',agentKey(),all.subarray(0,12));cipher.setAuthTag(all.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(all.subarray(28)),cipher.final()]).toString('utf8'));}
export const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function approvedUrl(value:string,hosts=(process.env.CLOUD_AGENT_ALLOWED_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean)){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&hosts.includes(u.hostname)&&!/(^|\.)(linkedin\.com)$/.test(u.hostname);}catch{return false;}
}
export function publicAddress(value:string){
 if(isIP(value)===4){const p=value.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0)||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19));}
 if(isIP(value)===6)return /^[23][0-9a-f]{3}:/i.test(value)&&!/^2001:(db8|0:|10:|20:)/i.test(value);
 return false;
}
export function factsFor(user:any){const parts=String(user.name||'').trim().split(/\s+/);return {fullName:user.name||'',firstName:parts[0]||'',lastName:parts.length>1?parts.slice(1).join(' '):'',email:user.email||'',phone:user.phone||'',linkedIn:user.linkedIn||'',portfolio:user.portfolio||'',currentTitle:user.currentTitle||'',skills:user.skills||'',experience:user.experience||'',expectedCtc:user.expectedCtc||'',noticePeriod:user.noticePeriod||'',workAuthorization:user.workAuthorization||''};}
const bindings:Record<string,RegExp>={fullName:/full name|your name|^name$/,firstName:/first|given name/,lastName:/last|family|surname/,email:/email/,phone:/phone|mobile/,linkedIn:/linkedin/,portfolio:/portfolio|personal website/,currentTitle:/current.*title|current.*role/,skills:/skills|technologies/,experience:/experience/,expectedCtc:/expected.*(salary|ctc|compensation)/,noticePeriod:/notice|availability/,workAuthorization:/work authoriz|visa status/};
export function factValue(key:string,field:{label:string;type?:string},facts:Record<string,string>){
 if(!bindings[key]||!bindings[key].test(field.label.toLowerCase())||!facts[key]||['password','file','checkbox','radio'].includes(field.type||''))throw Error('This field needs a verified user answer.');
 if(key==='experience'&&/\d\s*[-–+]\s*\d?/.test(facts[key]))throw Error('Exact experience needs a user answer.');return facts[key];
}
export function validateAction(action:any){
 if(!action||!['FILL','UPLOAD','CLICK','SUBMIT','SCROLL','WAIT','ASK_USER','SKIP'].includes(action.kind))throw Error('Invalid agent action.');
 if(['FILL','UPLOAD','CLICK','SUBMIT'].includes(action.kind)&&(!Number.isInteger(action.element)||action.element<0||action.element>500))throw Error('Invalid page element.');
 if(action.kind==='FILL'&&typeof action.fact!=='string')throw Error('Missing fact reference.');
 return action;
}
