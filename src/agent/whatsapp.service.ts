import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createHmac,randomBytes,randomUUID} from 'crypto';
import {PrismaService} from '../prisma/prisma.service';
import {seal,unseal,tokenHash} from './agent-policy';
import {answerableField,answerMemoryIdentity,whatsAppPhone} from './whatsapp-policy';
import {WhatsAppOtpService} from './whatsapp-otp.service';

@Injectable()
export class WhatsAppService {
 constructor(private readonly db:PrismaService,private readonly otp?:WhatsAppOtpService){}
 configured(){return process.env.WHATSAPP_ENABLED==='true'&&['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN','WHATSAPP_API_VERSION','WHATSAPP_BUSINESS_NUMBER'].every(k=>!!process.env[k])&&!!(process.env.WHATSAPP_TEMPLATE_NAME||process.env.WHATSAPP_OTP_TEMPLATE_NAME);}
 private phoneHash(phone:string){return createHmac('sha256',process.env.WHATSAPP_APP_SECRET||'').update(phone).digest('hex');}
 async status(userId:string){
  if(!this.configured())return {configured:false,verified:false};
  const rows:any[]=await this.db.$queryRaw`SELECT "verifiedAt","reuseAnswers" FROM "WhatsAppContact" WHERE "userId"=${userId}`;
  return {configured:true,verified:!!rows[0]?.verifiedAt,reuseAnswers:rows[0]?.reuseAnswers===true};
 }
 async pair(userId:string,body:any){
  if(!this.configured())throw new ServiceUnavailableException('WhatsApp Business messaging is not configured yet.');
  if(body?.consent!==true)throw new BadRequestException('Consent is required for application questions on WhatsApp.');
  this.otp?.cancelUser(userId);
  let phone:string;try{phone=whatsAppPhone(body.phone);}catch(e){throw new BadRequestException(e.message);}
  const code=randomBytes(16).toString('hex'),hash=tokenHash(code),expires=new Date(Date.now()+300000);
  await this.db.$executeRaw`INSERT INTO "WhatsAppContact"("userId","phoneHash","encrypted","pairHash","pairExpires") VALUES (${userId},${this.phoneHash(phone)},${seal({phone})},${hash},${expires}) ON CONFLICT ("userId") DO UPDATE SET "phoneHash"=EXCLUDED."phoneHash","encrypted"=EXCLUDED."encrypted","pairHash"=EXCLUDED."pairHash","pairExpires"=EXCLUDED."pairExpires","verifiedAt"=NULL,"consentedAt"=NOW()`;
  const business=(process.env.WHATSAPP_BUSINESS_NUMBER||'').replace(/^\+/,'');
  if(!/^[1-9]\d{7,14}$/.test(business))throw new ServiceUnavailableException('Business WhatsApp number is invalid.');
  return {url:`https://wa.me/${business}?text=${encodeURIComponent('PAIR '+code)}`,expiresAt:expires};
 }
 async disconnect(userId:string){
  this.otp?.cancelUser(userId);
  await this.db.$transaction(async tx=>{
   await tx.$executeRaw`DELETE FROM "WhatsAppContact" WHERE "userId"=${userId}`;
   await tx.$executeRaw`UPDATE "WhatsAppQuestion" SET "state"='CANCELLED',"answer"=NULL,"encrypted"='' WHERE "userId"=${userId} AND "state" IN ('PENDING','SENDING','ACCEPTED','ANSWERED')`;
  });return {verified:false};
 }
 async reuseSettings(userId:string,body:any){
  if(typeof body?.enabled!=='boolean')throw new BadRequestException('Choose whether to save and reuse your application answers.');
  const changed=await this.db.$executeRaw`UPDATE "WhatsAppContact" SET "reuseAnswers"=${body.enabled} WHERE "userId"=${userId} AND "verifiedAt" IS NOT NULL`;
  if(!changed)throw new BadRequestException('Verify your WhatsApp number first.');
  return {reuseAnswers:body.enabled};
 }
 async listAnswers(userId:string){
  if(!this.configured())return {answers:[]};
  const rows:any[]=await this.db.$queryRaw`SELECT "key","encrypted","expiresAt","updatedAt" FROM "AgentAnswerMemory" WHERE "userId"=${userId} ORDER BY "updatedAt" DESC LIMIT 100`;
  return {answers:rows.map(row=>{const item=unseal(row.encrypted);return {key:row.key,question:item.field.label,value:item.value,scope:item.identity.scope,expiresAt:row.expiresAt,updatedAt:row.updatedAt};})};
 }
 async deleteAnswer(userId:string,key:unknown){
  if(typeof key!=='string'||!/^([a-f0-9]{64}|all)$/.test(key))throw new BadRequestException('Choose a saved answer.');
  if(key==='all')await this.db.$executeRaw`DELETE FROM "AgentAnswerMemory" WHERE "userId"=${userId}`;
  else await this.db.$executeRaw`DELETE FROM "AgentAnswerMemory" WHERE "userId"=${userId} AND "key"=${key}`;
  return {deleted:true};
 }
 async updateAnswer(userId:string,body:any){
  if(typeof body?.key!=='string'||!/^([a-f0-9]{64})$/.test(body.key)||typeof body.value!=='string'||!body.value.trim()||body.value.length>2000)throw new BadRequestException('Enter a valid saved answer.');
  const rows:any[]=await this.db.$queryRaw`SELECT "encrypted" FROM "AgentAnswerMemory" WHERE "userId"=${userId} AND "key"=${body.key}`;
  if(!rows[0])throw new BadRequestException('Saved answer was not found.');
  const item=unseal(rows[0].encrypted),identity=answerMemoryIdentity(item.field,item.context);
  if(!identity||identity.key!==body.key)throw new BadRequestException('This answer cannot be reused.');
  const expires=identity.volatile?new Date(Date.now()+30*86400000):null;
  await this.db.$executeRaw`UPDATE "AgentAnswerMemory" SET "encrypted"=${seal({...item,value:body.value.trim()})},"expiresAt"=${expires},"updatedAt"=NOW() WHERE "userId"=${userId} AND "key"=${body.key}`;
  return {updated:true};
 }
 async remember(userId:string,field:any,value:string,context:any){
  const identity=answerMemoryIdentity(field,context);if(!identity||typeof value!=='string'||!value.trim()||value.length>2000)return;
  const encrypted=seal({field,context,identity,value}),expires=identity.volatile?new Date(Date.now()+30*86400000):null;
  await this.db.$executeRaw`INSERT INTO "AgentAnswerMemory"("userId","key","encrypted","expiresAt") SELECT ${userId},${identity.key},${encrypted},${expires} FROM "WhatsAppContact" WHERE "userId"=${userId} AND "verifiedAt" IS NOT NULL AND "reuseAnswers"=TRUE ON CONFLICT ("userId","key") DO UPDATE SET "encrypted"=EXCLUDED."encrypted","expiresAt"=EXCLUDED."expiresAt","updatedAt"=NOW()`;
 }
 async recalled(userId:string,field:any,context:any){
  if(!this.configured())return null;const identity=answerMemoryIdentity(field,context);if(!identity)return null;
  const rows:any[]=await this.db.$queryRaw`SELECT m."encrypted" FROM "AgentAnswerMemory" m JOIN "WhatsAppContact" c ON c."userId"=m."userId" WHERE m."userId"=${userId} AND m."key"=${identity.key} AND (m."expiresAt" IS NULL OR m."expiresAt">NOW()) AND c."verifiedAt" IS NOT NULL AND c."reuseAnswers"=TRUE`;
  if(!rows[0])return null;const saved=unseal(rows[0].encrypted);
  return saved.identity?.key===identity.key&&typeof saved.value==='string'?{key:identity.key,value:saved.value}:null;
 }
 // Only the hosted worker calls this method; never let a client create arbitrary recipient messages.
 async ask(run:any,field:any,url:string,context:any={}){
  if(!this.configured()||!process.env.WHATSAPP_TEMPLATE_NAME||run.kind!=='APPLY'||!answerableField(field))return null;
  const contacts:any[]=await this.db.$queryRaw`SELECT "encrypted" FROM "WhatsAppContact" WHERE "userId"=${run.userId} AND "verifiedAt" IS NOT NULL`;
  if(!contacts[0])return null;
  const id=randomUUID(),expires=new Date(Date.now()+300000),data=seal({field,url,context:{url,company:context.company,title:context.title}});
  const active:any[]=await this.db.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "id"=${run.id} AND "userId"=${run.userId} AND "state"='WAITING_USER'`;
  if(!active[0])return null;
  await this.db.$executeRaw`INSERT INTO "WhatsAppQuestion"("id","runId","userId","encrypted","expiresAt") VALUES (${id},${run.id},${run.userId},${data},${expires})`;
  await this.db.$executeRaw`UPDATE "WhatsAppQuestion" SET "state"='SENDING' WHERE "id"=${id}`;
  try{
   const version=process.env.WHATSAPP_API_VERSION;if(!/^v\d+\.\d+$/.test(version||''))throw Error();
   const response=await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({messaging_product:'whatsapp',to:unseal(contacts[0].encrypted).phone,type:'template',template:{name:process.env.WHATSAPP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en_US'},components:[{type:'body',parameters:[{type:'text',text:field.label.slice(0,200)},{type:'text',text:id}]}]}})});
   const result:any=await response.json();const messageId=result.messages?.[0]?.id;
   if(!response.ok||typeof messageId!=='string')throw Error();
   await this.db.$executeRaw`UPDATE "WhatsAppQuestion" SET "state"='ACCEPTED',"messageId"=${messageId} WHERE "id"=${id} AND "state"='SENDING'`;
  }catch{await this.db.$executeRaw`UPDATE "WhatsAppQuestion" SET "state"='DELIVERY_UNKNOWN' WHERE "id"=${id} AND "state"='SENDING'`;}
  return id;
 }
 async inbound(body:any){
  if(!this.configured()||body?.object!=='whatsapp_business_account')return;
  for(const entry of body.entry||[])for(const change of entry.changes||[]){
   const value=change.value;if(value?.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID)continue;
   for(const message of value.messages||[]){
    if(message.type!=='text'||typeof message.id!=='string'||typeof message.from!=='string'||typeof message.text?.body!=='string')continue;
    const text=message.text.body.trim();if(!text||text.length>2000)continue;
    if(this.otp?.accept(message))continue;
    await this.db.$transaction(async tx=>{
     const inserted=await tx.$executeRaw`INSERT INTO "WhatsAppInbound"("id") VALUES (${message.id}) ON CONFLICT DO NOTHING`;if(!inserted)return;
     const phoneHash=this.phoneHash(message.from);
     const pairing=/^PAIR ([a-f0-9]{32})$/.exec(text);
     if(pairing){await tx.$executeRaw`UPDATE "WhatsAppContact" SET "verifiedAt"=NOW(),"pairHash"=NULL,"pairExpires"=NULL WHERE "phoneHash"=${phoneHash} AND "pairHash"=${tokenHash(pairing[1])} AND "pairExpires">NOW()`;return;}
     // A quoted reply is mandatory: no guessing among parallel application questions.
     if(typeof message.context?.id!=='string')return;
     const rows:any[]=await tx.$queryRaw`SELECT q."id" FROM "WhatsAppQuestion" q JOIN "WhatsAppContact" c ON c."userId"=q."userId" JOIN "AgentRun" r ON r."id"=q."runId" WHERE c."phoneHash"=${phoneHash} AND c."verifiedAt" IS NOT NULL AND q."messageId"=${message.context.id} AND q."state"='ACCEPTED' AND q."expiresAt">NOW() AND r."state"='WAITING_USER' FOR UPDATE OF q`;
     if(rows[0])await tx.$executeRaw`UPDATE "WhatsAppQuestion" SET "state"='ANSWERED',"answer"=${seal({value:text})},"answeredAt"=NOW() WHERE "id"=${rows[0].id} AND "state"='ACCEPTED'`;
    });
   }
  }
 }
}
