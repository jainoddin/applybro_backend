import {BadRequestException,Injectable} from '@nestjs/common';
import {createHmac,randomUUID} from 'crypto';
import {PrismaService} from '../prisma/prisma.service';
import {unseal} from './agent-policy';
type PendingOtp={userId:string;sessionId:string;phoneHash:string;expiresAt:number;messageId?:string;answer?:Buffer;timer:ReturnType<typeof setTimeout>};
@Injectable()
export class WhatsAppOtpService{
 private pending=new Map<string,PendingOtp>();
 constructor(private readonly db:PrismaService){}
 configured(){return process.env.WHATSAPP_ENABLED==='true'&&['WHATSAPP_OTP_TEMPLATE_NAME','WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_APP_SECRET'].every(k=>!!process.env[k])&&/^v\d+\.\d+$/.test(process.env.WHATSAPP_API_VERSION||'');}
 private remove(id:string){const item=this.pending.get(id);if(item){clearTimeout(item.timer);item.answer?.fill(0);this.pending.delete(id);}}
 async ask(userId:string,body:any){
  if(body?.origin!=='https://www.naukri.com'||!/^[-a-f0-9]{36}$/.test(body?.sessionId||''))throw new BadRequestException('A private Naukri login session is required.');
  if(!this.configured())return {state:'UNAVAILABLE',message:'WhatsApp OTP template/channel is not configured.'};
  for(const [id,item]of this.pending)if(item.userId===userId&&item.sessionId===body.sessionId&&item.expiresAt>Date.now())return {id,state:'ACCEPTED',expiresAt:item.expiresAt};
  const contacts:any[]=await this.db.$queryRaw`SELECT "encrypted","phoneHash" FROM "WhatsAppContact" WHERE "userId"=${userId} AND "verifiedAt" IS NOT NULL`;
  if(!contacts[0])return {state:'UNAVAILABLE',message:'Verify your WhatsApp number in Settings first.'};
  const id=randomUUID(),expiresAt=Date.now()+300000,timer=setTimeout(()=>this.remove(id),300000);timer.unref();const item:PendingOtp={userId,sessionId:body.sessionId,phoneHash:contacts[0].phoneHash,expiresAt,timer};this.pending.set(id,item);
  try{
   const response=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({messaging_product:'whatsapp',to:unseal(contacts[0].encrypted).phone,type:'template',template:{name:process.env.WHATSAPP_OTP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en_US'},components:[{type:'body',parameters:[{type:'text',text:'Naukri login verification'},{type:'text',text:id}]}]}})});
   const result:any=await response.json();if(!response.ok||typeof result.messages?.[0]?.id!=='string')throw Error();item.messageId=result.messages[0].id;return {id,state:'ACCEPTED',expiresAt};
  }catch{this.remove(id);return {state:'UNAVAILABLE',message:'WhatsApp OTP request could not be confirmed. Use the website OTP field.'};}
 }
 accept(message:any){
  const entry=[...this.pending].find(([,item])=>item.messageId&&item.messageId===message.context?.id);if(!entry)return false;const [id,item]=entry;
  if(item.expiresAt<=Date.now()){this.remove(id);return true;}
  const hash=createHmac('sha256',process.env.WHATSAPP_APP_SECRET||'').update(String(message.from||'')).digest('hex'),value=String(message.text?.body||'').trim();
  if(hash!==item.phoneHash||item.answer||!/^\d{4,8}$/.test(value))return true;
  item.answer=Buffer.from(value,'utf8');return true;
 }
 poll(userId:string,body:any){const item=this.pending.get(body?.id);if(!item||item.userId!==userId||item.sessionId!==body.sessionId)return {state:'EXPIRED'};if(item.expiresAt<=Date.now()){this.remove(body.id);return {state:'EXPIRED'};}if(!item.answer)return {state:'WAITING',expiresAt:item.expiresAt};const value=item.answer.toString('utf8');this.remove(body.id);return {state:'ANSWERED',value};}
 cancel(userId:string,body:any){const item=this.pending.get(body?.id);if(item?.userId===userId&&item.sessionId===body.sessionId)this.remove(body.id);return {cancelled:true};}
 cancelUser(userId:string){for(const [id,item]of this.pending)if(item.userId===userId)this.remove(id);}
}
