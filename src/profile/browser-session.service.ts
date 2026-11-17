import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
import {seal,unseal} from '../agent/agent-policy';
import {verifyBrowserReceipt} from './browser-receipt.service';

export function portalSessionState(value:any,portal:string){
 const domain=portal==='NAUKRI'?'naukri.com':portal==='LINKEDIN'?'linkedin.com':null;
 if(!domain)throw new BadRequestException('Unsupported portal.');
 const belongs=(host:string)=>host===domain||host.endsWith('.'+domain);
 if(!value||!Array.isArray(value.cookies)||!Array.isArray(value.origins)||JSON.stringify(value).length>250000)throw new BadRequestException('Invalid portal session.');
 const cookies=value.cookies.filter((c:any)=>typeof c.domain==='string'&&belongs(c.domain.replace(/^\./,''))&&(c.expires===-1||c.expires*1000>Date.now()));
 const origins=value.origins.filter((o:any)=>{try{const u=new URL(o.origin);return u.protocol==='https:'&&belongs(u.hostname);}catch{return false;}});
 return {cookies,origins};
}
@Injectable()
export class BrowserSessionService{
 constructor(private readonly db:PrismaService){}
 async exchange(userId:string,raw:Buffer,signature:unknown,body:any){
  if(!process.env.PRIVATE_BROWSER_CALLBACK_KEY)throw new ServiceUnavailableException('Private browser storage authentication is not configured.');
  if(!verifyBrowserReceipt(raw,signature,process.env.PRIVATE_BROWSER_CALLBACK_KEY)||body?.userId!==userId)throw new ForbiddenException('Private browser authentication required.');
  if(!Number.isFinite(body.signedAt)||Math.abs(Date.now()-body.signedAt)>60000||!['load','save','clear'].includes(body.action)||!['NAUKRI','LINKEDIN'].includes(body.portal))throw new BadRequestException('Invalid session request.');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
   const rows:any[]=await tx.$queryRaw`SELECT "encrypted","updatedAt" FROM "AgentSession" WHERE "userId"=${userId}`;
   let state:any={cookies:[],origins:[]};
   if(rows[0]){try{state=unseal(rows[0].encrypted);}catch{throw new ServiceUnavailableException('Existing session encryption cannot be read; no stored session was replaced.');}}
   if(body.action==='load')return {state:portalSessionState(state,body.portal)};
   const fresh=body.action==='save'?portalSessionState(body.state,body.portal):{cookies:[],origins:[]};
   if(body.action==='save'&&!fresh.cookies.length&&!fresh.origins.length)throw new BadRequestException('No portal session to save.');
   const domain=body.portal==='NAUKRI'?'naukri.com':'linkedin.com';
   const belongs=(host:string)=>host===domain||host.endsWith('.'+domain);
   // Preserve all other employer sessions when updating just one portal.
   const other={cookies:(state.cookies||[]).filter((c:any)=>!belongs(String(c.domain||'').replace(/^\./,''))),
    origins:(state.origins||[]).filter((o:any)=>{try{return !belongs(new URL(o.origin).hostname);}catch{return false;}})};
   const merged={cookies:[...other.cookies,...fresh.cookies],origins:[...other.origins,...fresh.origins]};
   const encrypted=seal(merged),checked=body.portal==='NAUKRI'&&body.action==='save'?new Date():null;
   if(body.portal==='NAUKRI')await tx.$executeRaw`INSERT INTO "AgentSession"("userId","encrypted","revision","naukriCheckedAt") VALUES (${userId},${encrypted},1,${checked}) ON CONFLICT ("userId") DO UPDATE SET "encrypted"=EXCLUDED."encrypted","revision"="AgentSession"."revision"+1,"naukriCheckedAt"=EXCLUDED."naukriCheckedAt","updatedAt"=NOW()`;
   else await tx.$executeRaw`INSERT INTO "AgentSession"("userId","encrypted","revision") VALUES (${userId},${encrypted},1) ON CONFLICT ("userId") DO UPDATE SET "encrypted"=EXCLUDED."encrypted","revision"="AgentSession"."revision"+1,"updatedAt"=NOW()`;
   return {saved:body.action==='save',cleared:body.action==='clear'};
  },{maxWait:10000,timeout:20000});
 }
}
