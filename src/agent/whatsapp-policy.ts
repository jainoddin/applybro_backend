import {createHash,createHmac,timingSafeEqual} from 'crypto';

export function validWhatsAppSignature(raw:Buffer,signature:unknown,secret:string){
 if(!secret||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const expected=createHmac('sha256',secret).update(raw).digest();
 return timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
export function whatsAppPhone(value:unknown){
 if(typeof value!=='string'||!/^\+[1-9]\d{7,14}$/.test(value))throw Error('Enter your WhatsApp number with country code, for example +91…');
 return value.slice(1);
}
export function answerableField(field:any){
 return !!field&&['INPUT','TEXTAREA','SELECT'].includes(String(field.tag||'').toUpperCase())&&!['file','password','hidden','checkbox','submit','button'].includes(String(field.type||'').toLowerCase())&&typeof field.label==='string'&&field.label.trim().length>2&&!/password|otp|one.time|captcha|verification|security.code|social.security|credit.card|bank.account/i.test(field.label);
}
export function matchingQuestionField(saved:any,current:any[],url:string){
 if(saved.url!==url)return null;
 const fields=current.filter(f=>answerableField(f)&&!f.filled&&f.id===saved.field.id&&f.label===saved.field.label&&f.type===saved.field.type&&f.frame===saved.field.frame);
 return fields.length===1?fields[0]:null;
}
export function answerMemoryIdentity(field:any,context:{url:string;company?:string;title?:string}){
 if(!answerableField(field)||/consent|agree|certif|attest|criminal|disabil|ethnic|religion|veteran|gender|race|signature/i.test(field.label))return null;
 const question=field.label.normalize('NFKC').toLowerCase().replace(/[\s*]+/g,' ').trim();
 if(question.length<6)return null;
 let origin:string;try{const u=new URL(context.url);if(u.protocol!=='https:')return null;origin=u.origin;}catch{return null;}
 // Only plainly personal facts are portable between employers. Preserve the exact wording and units.
 const personal=/\b(notice period|current (city|location|locality|salary|ctc)|where do you live in|key\s?skills|expected (salary|ctc)|undergraduate|degree|college|university|graduation|email address|phone number|mobile number|postal code)\b/.test(question)&&!/\b(this|our) (company|role|job)|why|willing|relocat|sponsor|authoriz|visa|experience/.test(question);
 const scope=personal?'personal':origin+'|'+String(context.company||'').trim().toLowerCase()+'|'+String(context.title||'').trim().toLowerCase();
 if(!personal&&(!context.company||!context.title))return null;
 const key=createHash('sha256').update(JSON.stringify({version:1,question,scope,type:field.type,tag:field.tag})).digest('hex');
 return {key,question,scope,volatile:/salary|ctc|notice period/.test(question)};
}
