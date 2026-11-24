import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { trustedApplicationUrl, sameApplicationPage } from './live-sources';
import { experienceRange,minimumExperience,roleMatches,skillMatch } from './skill-match';
import { hasSubmissionEvidence } from './application-evidence';
import {validListingTitle} from './listing-title';
import {factsFor} from '../agent/agent-policy';
import {WhatsAppService} from '../agent/whatsapp.service';
import {answerableField} from '../agent/whatsapp-policy';
import {cleanObservation,checkedAction,knownFieldValue,requestDesktopPlan} from './desktop-planner';

export const portalUrls: Record<string,string> = {
  'Naukri.com':'https://www.naukri.com/mnjuser/profile',
  LinkedIn:'https://www.linkedin.com/feed/',
};
export function supportedBrowserUrl(value: string) {
  if (trustedApplicationUrl(value)) return true;
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password &&
    ['www.naukri.com','www.linkedin.com'].includes(u.hostname); } catch { return false; }
}
export function browserJobUrl(value:string){
 try{const u=new URL(value);return supportedBrowserUrl(value)&&(
   (u.hostname==='www.naukri.com'&&u.pathname.startsWith('/job-listings-'))||
   (u.hostname==='www.linkedin.com'&&/^\/jobs\/view\/\d+\/?$/.test(u.pathname))||trustedApplicationUrl(value));}catch{return false;}
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const ALLOWED:Record<string,string[]>={
 CREATED:['OPENED','FAILED','CANCELLED'], OPENED:['LOGIN_REQUIRED','VERIFIED','REVIEW_REQUIRED','BROWSER_CONFIRMED','FAILED','CANCELLED'],
 LOGIN_REQUIRED:['LOGIN_REQUIRED','VERIFIED','REVIEW_REQUIRED','FAILED','CANCELLED'],
 REVIEW_REQUIRED:['REVIEW_REQUIRED','SUBMITTING','BROWSER_CONFIRMED','FAILED','CANCELLED'],
 SUBMITTING:['BROWSER_CONFIRMED','UNKNOWN','FAILED'],
 UNKNOWN:['BROWSER_CONFIRMED','CANCELLED'],
};
@Injectable()
export class CompanionService {
 private plannerBusy=new Set<string>();
 constructor(private readonly prisma:PrismaService){}
 private async remaining(userId:string,limit:number){
   const day=new Date(Date.now()+19800000).toISOString().slice(0,10),from=new Date(day+'T00:00:00+05:30');
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='UNKNOWN',"updatedAt"=NOW(),"details"="details" || '{"message":"Submission outcome was not confirmed within 5 minutes."}'::jsonb WHERE "userId"=${userId} AND "kind"='APPLY' AND "stage"='SUBMITTING' AND "updatedAt" < NOW()-INTERVAL '5 minutes'`;
   const applications=await this.prisma.jobApplication.findMany({where:{userId,status:'APPLIED',appliedAt:{gte:from}}});
   const sent=applications.filter(app=>hasSubmissionEvidence(app)).length;
   const inFlight:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${userId} AND "kind"='APPLY' AND "stage" IN ('SUBMITTING','UNKNOWN') AND "updatedAt">=${from}`;
   const hosted:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "userId"=${userId} AND "state" IN ('SUBMITTING','UNKNOWN') AND "submitReservedAt">=${from}`;
   return Math.max(0,limit-sent-inFlight.length-hosted.length);
 }
 async pair(userId:string){
   const id=randomUUID(), token=randomBytes(32).toString('base64url'), hash=digest(token);
   const expires=new Date(Date.now()+7*86400000);
   // Re-pairing revokes previous devices and prevents cross-account task execution.
   await this.prisma.$transaction(async tx=>{
     await tx.$executeRaw`UPDATE "BrowserDevice" SET "revokedAt"=NOW() WHERE "userId"=${userId} AND "revokedAt" IS NULL`;
     await tx.$executeRaw`UPDATE "BrowserRun" SET "stage"='CANCELLED',"updatedAt"=NOW() WHERE "userId"=${userId} AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED')`;
     await tx.$executeRaw`INSERT INTO "BrowserDevice"("id","userId","tokenHash","expiresAt") VALUES (${id},${userId},${hash},${expires})`;
   });
   return {token,deviceId:id,expiresAt:expires.toISOString()};
 }
 async device(authorization:string){
   const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization||'')?.[1];
   if(!token)throw new UnauthorizedException('Companion pairing required.');
   const rows:any[]=await this.prisma.$queryRaw`SELECT * FROM "BrowserDevice" WHERE "tokenHash"=${digest(token)} AND "revokedAt" IS NULL AND "expiresAt">NOW()`;
   if(!rows[0])throw new UnauthorizedException('Companion pairing expired or revoked.');
   return rows[0];
 }
 async status(userId:string){
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='TIMED_OUT',"updatedAt"=NOW(),"details"="details" || '{"message":"Login check timed out. Open the portal and retry; no connection was confirmed."}'::jsonb WHERE "userId"=${userId} AND "kind"='VERIFY' AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED') AND "createdAt" < NOW()-INTERVAL '3 minutes'`;
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='UNKNOWN',"updatedAt"=NOW(),"details"="details" || '{"message":"Submission outcome not confirmed within 5 minutes."}'::jsonb WHERE "userId"=${userId} AND "kind"='APPLY' AND "stage"='SUBMITTING' AND "updatedAt" < NOW()-INTERVAL '5 minutes'`;
   const devices:any[]=await this.prisma.$queryRaw`SELECT "id","expiresAt" FROM "BrowserDevice" WHERE "userId"=${userId} AND "revokedAt" IS NULL AND "expiresAt">NOW() ORDER BY "createdAt" DESC`;
   const runs:any[]=await this.prisma.$queryRaw`SELECT "id","deviceId","kind","portal","stage","url","details","updatedAt" FROM "BrowserRun" WHERE "userId"=${userId} ORDER BY "updatedAt" DESC LIMIT 30`;
   const sessions:any[]=await this.prisma.$queryRaw`SELECT DISTINCT ON ("portal") "id","deviceId","kind","portal","stage","updatedAt" FROM "BrowserRun" WHERE "userId"=${userId} AND "kind"='VERIFY' ORDER BY "portal","updatedAt" DESC`;
   const activeAutoRuns:any[]=await this.prisma.$queryRaw`SELECT "id","stage","kind" FROM "BrowserRun" WHERE "userId"=${userId} AND "kind" IN ('APPLY','DISCOVER','INSPECT') AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN') AND ("details"->>'autoSubmit'='true' OR "details"->>'autoDiscover'='true') AND ("createdAt">NOW()-INTERVAL '24 hours' OR "stage" IN ('SUBMITTING','UNKNOWN'))`;
   const user=await this.prisma.user.findUnique({where:{id:userId},include:{subscription:true}});
   const hosted:any[]=await this.prisma.$queryRaw`SELECT "enabled" FROM "AgentPreference" WHERE "userId"=${userId}`;
   const blocker=process.env.COMPANION_AUTO_APPLY_ENABLED!=='true'?'Desktop processing is unavailable on this deployment.':!user?.subscription?.active||user.subscription.trialEnds<=new Date()?'Your plan has expired. Choose an active plan.':user.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent?'Save Auto-Apply ON in Get Started → Configure Applications first.':hosted[0]?.enabled?'Pause Hosted Agent before enabling this computer.':'';
   return {paired:!!devices.length,devices,runs,sessions,activeAutoRuns,desktop:{ready:!blocker,blocker,dailyLimit:user?.dailyApplyLimit||0}};
 }
 async revoke(userId:string){
   await this.prisma.$executeRaw`UPDATE "BrowserDevice" SET "revokedAt"=NOW() WHERE "userId"=${userId}`;
   return {revoked:true};
 }
 async disconnectPortal(userId:string,portal:string){
   if(!portalUrls[portal])throw new BadRequestException('Unsupported portal.');
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='DISCONNECTED',"updatedAt"=NOW() WHERE "userId"=${userId} AND "portal"=${portal} AND "kind"='VERIFY' AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','VERIFIED')`;
   return {disconnected:true};
 }
 async clearStale(userId:string){
    const count=await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='CANCELLED',"updatedAt"=NOW() WHERE "userId"=${userId} AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED')`;
    return {cleared:count};
  }
  async cancel(userId:string,id:string){
   const count=await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='CANCELLED',"updatedAt"=NOW() WHERE "id"=${id} AND "userId"=${userId} AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED')`;
   if(!count)throw new BadRequestException('Only an unsubmitted run can be cancelled. Check the employer outcome for a pending submission.');
   return {cancelled:true};
 }
 async create(userId:string,data:{kind?:string;portal?:string;applicationId?:string;autoSubmit?:boolean;autoDiscover?:boolean;autoPrepare?:boolean;resumeExisting?:boolean}){
   const devices:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserDevice" WHERE "userId"=${userId} AND "revokedAt" IS NULL AND "expiresAt">NOW() ORDER BY "createdAt" DESC LIMIT 1`;
   if(!devices[0])throw new BadRequestException('Install and pair the browser companion first.');
   const kind=data.kind;let portal=data.portal||'',url='',applicationId:string=null;let resumeId:string=null,reviewReason='';
   const autoSubmit=data.autoSubmit===true;
   if((autoSubmit||data.autoDiscover||data.autoPrepare)&&process.env.COMPANION_AUTO_APPLY_ENABLED!=='true')throw new BadRequestException('Automatic processing has moved to Hosted Agent. The local companion remains available for explicit manual tasks.');
   if(data.autoDiscover||data.autoPrepare){const user=await this.prisma.user.findUnique({where:{id:userId},include:{subscription:true}});if(user?.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent||!user.subscription?.active||user.subscription.trialEnds<=new Date())throw new BadRequestException('Auto-Apply is off or your plan has expired.');if(await this.remaining(userId,user.dailyApplyLimit)<=0)throw new BadRequestException('Daily application limit reached.');}
   if(kind==='VERIFY'||kind==='DISCOVER'){
     url=portalUrls[portal];if(!url)throw new BadRequestException('Browser sign-in check is supported for Naukri and LinkedIn. ATS forms do not need an account connection.');
     if(kind==='DISCOVER'){
       const preference=await this.prisma.jobPreference.findUnique({where:{userId}});
       const title=preference?.titles?.[0]||'software engineer';
       url=portal==='Naukri.com'?`https://www.naukri.com/${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-jobs`:`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(title)}`;
     }
   }else if(kind==='APPLY'||kind==='INSPECT'){
     const sub=await this.prisma.subscription.findUnique({where:{userId}});
     if(!sub?.active || sub.trialEnds<=new Date())throw new BadRequestException('Your plan has expired. Choose a plan before starting an application.');
     const app=await this.prisma.jobApplication.findFirst({where:{id:data.applicationId||'',userId}});
     const m:any=app?.matchReasons;
     if(!app||!validListingTitle(app.jobTitle)||!['official-feed-v1','browser-listing-v1'].includes(m?.version)||!browserJobUrl(m.url))throw new NotFoundException('Live employer application not found.');
     if(app.status==='APPLIED')throw new BadRequestException('This job already has a recorded submission.');
     const hosted:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "userId"=${userId} AND "applicationId"=${app.id} AND "state" IN ('QUEUED','RUNNING','WAITING_USER','SUBMITTING','UNKNOWN','CONFIRMED') LIMIT 1`;
     if(hosted.length)throw new BadRequestException('This job already has a hosted browser task. Open Hosted Agent to review it.');
     const files:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "Resume" WHERE "userId"=${userId} AND "fileBytes" IS NOT NULL ORDER BY "isDefault" DESC,"createdAt" DESC LIMIT 1`;
     resumeId=kind==='APPLY'?files[0]?.id||null:null;
     if(autoSubmit){
       const user=await this.prisma.user.findUnique({where:{id:userId}});
       if(user.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent)throw new BadRequestException('Enable Auto-Apply in your saved application settings.');
       if(!resumeId)throw new BadRequestException('Upload your resume file first.');
       if(await this.remaining(userId,user.dailyApplyLimit)<=0)throw new BadRequestException('Daily application limit reached.');
       if(app.matchScore<user.minMatchScore)throw new BadRequestException('This job is below your saved match threshold.');
       if(m.matchAssessed!==true)throw new BadRequestException('This job needs manual review; insufficient skill evidence for automatic matching.');
       if(typeof m.minimumYears==='number'&&m.minimumYears>0){
         const experience=experienceRange(user.experience||'');
         if(experience&&experience.maximum<m.minimumYears)throw new BadRequestException(`Employer requires at least ${m.minimumYears} years; saved experience does not meet that minimum.`);
         if(!experience||experience.minimum<m.minimumYears)reviewReason=`Confirm your exact experience meets the employer's ${m.minimumYears}-year minimum.`;
       }
     }
     url=m.url;portal=m.source;applicationId=app.id;
   }else throw new BadRequestException('Invalid browser task.');
   const pending:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${userId} AND "applicationId"=${applicationId} AND "stage" IN ('CREATED','OPENED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN') LIMIT 1`;
   if(applicationId&&pending.length){if(kind==='APPLY'&&data.resumeExisting===true)return {id:pending[0].id,url,kind,portal};throw new BadRequestException('A browser run already exists for this job. Resume or cancel it before retrying.');}
   const id=randomUUID(),deviceId=devices[0].id;
   const details=JSON.stringify({autoSubmit:kind==='APPLY'&&autoSubmit,autoDiscover:data.autoDiscover===true,autoPrepare:data.autoPrepare===true,resumeId,reviewReason});
   try{await this.prisma.$executeRaw`INSERT INTO "BrowserRun"("id","userId","deviceId","kind","portal","url","applicationId","details") VALUES (${id},${userId},${deviceId},${kind},${portal},${url},${applicationId},${details}::jsonb)`;}
   catch(error){if(error?.meta?.code==='23505')throw new BadRequestException('An active browser run already exists for this application.');throw error;}
   return {id,url,kind,portal};
 }
 private async expireReadTasks(device:any){
   // Read tasks have a 24-hour lifetime. Leaving expired CREATED rows active
   // makes import deduplication suppress those postings forever.
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='FAILED',"updatedAt"=NOW(),"details"="details" || '{"message":"This job read expired before completion. A fresh inspection can be queued; no application was submitted."}'::jsonb WHERE "userId"=${device.userId} AND "deviceId"=${device.id} AND "kind" IN ('DISCOVER','INSPECT') AND "stage" IN ('CREATED','OPENED','REVIEW_REQUIRED') AND "details"->>'autoDiscover'='true' AND ("details"->>'needsInput') IS DISTINCT FROM 'true' AND "createdAt"<NOW()-INTERVAL '24 hours'`;
 }
 async autoBatch(device:any){
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{subscription:true,preferences:true}});
   if(process.env.COMPANION_AUTO_APPLY_ENABLED!=='true')throw new BadRequestException('Desktop Auto-Apply is not enabled on this deployment.');
   if(!user||user.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent||!user.subscription?.active||user.subscription.trialEnds<=new Date())throw new BadRequestException('Enable Auto-Apply with an active plan first.');
   const hosted:any[]=await this.prisma.$queryRaw`SELECT "userId" FROM "AgentPreference" WHERE "userId"=${device.userId} AND "enabled"=true LIMIT 1`;
   if(hosted.length)throw new BadRequestException('Pause Hosted Agent before enabling desktop processing.');
   await this.expireReadTasks(device);
   const remaining=await this.remaining(device.userId,user.dailyApplyLimit);
   if(!remaining)return {runs:[],remaining:0,message:'Daily limit reached. Unconfirmed submissions also reserve a slot.'};
   const readyToSubmit:any[]=await this.prisma.$queryRaw`SELECT "id","kind","stage","portal" FROM "BrowserRun" WHERE "userId"=${device.userId} AND "deviceId"=${device.id} AND "stage"='REVIEW_REQUIRED' AND "kind"='APPLY' AND "details"->>'answerReady'='true' AND "createdAt">NOW()-INTERVAL '1 day' ORDER BY "updatedAt" ASC LIMIT 5`;
   if(readyToSubmit.length)return {runs:readyToSubmit,remaining,message:'Resuming applications with confirmed WhatsApp answers.'};
   // Never replay a click whose result is unknown, or silently restart a form needing input.
   const pending:any[]=await this.prisma.$queryRaw`SELECT "id","kind","stage","portal" FROM "BrowserRun" WHERE "userId"=${device.userId} AND "deviceId"=${device.id} AND "stage" IN ('CREATED','OPENED') AND ("details"->>'autoSubmit'='true' OR "details"->>'autoDiscover'='true') AND "createdAt">NOW()-INTERVAL '24 hours' ORDER BY "createdAt" ASC LIMIT 30`;
   if(pending.length)return {runs:pending,remaining};
   const settings:any[]=await this.prisma.$queryRaw`SELECT "selectedPortals" FROM "User" WHERE "id"=${device.userId}`;
   const selected=settings[0]?.selectedPortals;
   const portals=Array.isArray(selected)?selected.filter((p:string)=>!!portalUrls[p]):[];
   if(!portals.length)return {runs:[],remaining,message:'Select Naukri or LinkedIn in your saved preferences.'};
   const runs=[];
   for(const portal of portals){
     // Pairing cancels unfinished tasks on the previous device. Those searches
     // cannot run anymore and must not delay the newly paired browser.
     const recent:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${device.userId} AND "deviceId"=${device.id} AND "portal"=${portal} AND "kind"='DISCOVER' AND "stage"<>'CANCELLED' AND "createdAt">NOW()-INTERVAL '15 minutes' LIMIT 1`;
     if(recent.length)continue;
     runs.push(await this.create(device.userId,{kind:'DISCOVER',portal,autoDiscover:true}));
   }
   return {runs,remaining,message:runs.length?'Reading selected portal jobs.':'Waiting before the next discovery check.'};
 }
 async task(device:any,id:string){
   const rows:any[]=await this.prisma.$queryRaw`SELECT * FROM "BrowserRun" WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id}`;
   const run=rows[0];if(!run)throw new NotFoundException('Browser task not found.');
   const expiredRead=['DISCOVER','INSPECT'].includes(run.kind)&&Date.now()-new Date(run.createdAt).getTime()>86400000;
   if(expiredRead){
     await this.expireReadTasks(device);
     const refreshed:any[]=await this.prisma.$queryRaw`SELECT * FROM "BrowserRun" WHERE "id"=${run.id} AND "userId"=${device.userId} AND "deviceId"=${device.id}`;
     if(refreshed[0])Object.assign(run,refreshed[0]);
     // Let an existing local queue observe completion/pause, rather than
     // throwing forever on its expired head. Never release resume/profile.
     if(['FAILED','CANCELLED','INSPECTED','DISCOVERED'].includes(run.stage)||run.details?.needsInput===true)return {...run,autoSubmit:false,autoDiscover:false,autoPrepare:false,resume:null,profile:null,stopReason:'This read task has expired.'};
   }
   // A lost content-script response must not hold every other portal forever.
   // Only read-only discovery/inspection can expire here. Never infer the
   // outcome of an APPLY task, or dismiss a question explicitly needing input.
   if(['DISCOVER','INSPECT'].includes(run.kind)&&run.details?.autoDiscover===true&&['OPENED','REVIEW_REQUIRED'].includes(run.stage)&&run.details?.needsInput!==true&&Date.now()-new Date(run.updatedAt).getTime()>300000){
     // PostgreSQL NOW() keeps microseconds; JavaScript Date loses them. An
     // equality check against run.updatedAt never matched those live rows.
     // Recheck eligibility atomically using database time instead: a newer
     // report, completion, or request for user input must win this race.
     const expired:any[]=await this.prisma.$queryRaw`UPDATE "BrowserRun" SET "stage"='FAILED',"updatedAt"=NOW(),"details"="details" || '{"message":"This portal read stopped responding for 5 minutes. Other queued jobs can continue; no application was submitted by this check."}'::jsonb WHERE "id"=${run.id} AND "userId"=${device.userId} AND "deviceId"=${device.id} AND "kind" IN ('DISCOVER','INSPECT') AND "stage" IN ('OPENED','REVIEW_REQUIRED') AND "details"->>'autoDiscover'='true' AND ("details"->>'needsInput') IS DISTINCT FROM 'true' AND "updatedAt"<NOW()-INTERVAL '5 minutes' RETURNING *`;
     if(expired[0])Object.assign(run,expired[0]);
     else {const refreshed:any[]=await this.prisma.$queryRaw`SELECT * FROM "BrowserRun" WHERE "id"=${run.id} AND "userId"=${device.userId} AND "deviceId"=${device.id}`;if(refreshed[0])Object.assign(run,refreshed[0]);}
   }
   if(run.kind==='APPLY'&&run.details?.autoSubmit===true&&['OPENED','REVIEW_REQUIRED'].includes(run.stage)&&run.details?.needsInput!==true&&Date.now()-new Date(run.updatedAt).getTime()>300000){
     // An automatic preparation error can lose its browser report. Park this
     // pre-submit task for review, without marking it sent/failed or retrying.
     // A concurrent submission reservation must win the atomic stage check.
     const parked:any[]=await this.prisma.$queryRaw`UPDATE "BrowserRun" SET "stage"='REVIEW_REQUIRED',"updatedAt"=NOW(),"details"="details" || '{"needsInput":true,"message":"This application stopped reporting before submission was recorded. Check this job before resuming; other queued tasks can continue."}'::jsonb WHERE "id"=${run.id} AND "userId"=${device.userId} AND "deviceId"=${device.id} AND "kind"='APPLY' AND "stage" IN ('OPENED','REVIEW_REQUIRED') AND "details"->>'autoSubmit'='true' AND ("details"->>'needsInput') IS DISTINCT FROM 'true' AND "updatedAt"<NOW()-INTERVAL '5 minutes' RETURNING *`;
     if(parked[0])Object.assign(run,parked[0]);
     else {const refreshed:any[]=await this.prisma.$queryRaw`SELECT * FROM "BrowserRun" WHERE "id"=${run.id} AND "userId"=${device.userId} AND "deviceId"=${device.id}`;if(refreshed[0])Object.assign(run,refreshed[0]);}
   }
   if(['DISCONNECTED','TIMED_OUT'].includes(run.stage))throw new BadRequestException('Portal check ended. Start a new login check from ApplyBro.');
   if(Date.now()-new Date(run.createdAt).getTime()>86400000)throw new BadRequestException('Browser task expired. Start a new run.');
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{subscription:true}});
   const remainingSlots=await this.remaining(user.id,user.dailyApplyLimit);
   const autoAvailable=process.env.COMPANION_AUTO_APPLY_ENABLED==='true'&&user.activeMode==='AUTO_APPLY'&&user.autoApplyConsent&&user.subscription?.active&&user.subscription.trialEnds>new Date()&&remainingSlots>0;
   const files:any[]=run.kind==='APPLY'&&run.details?.resumeId?await this.prisma.$queryRaw`SELECT "fileName","fileBytes","mimeType" FROM "Resume" WHERE "userId"=${device.userId} AND "id"=${run.details.resumeId} AND "fileBytes" IS NOT NULL`:[];
   return {...run,aiPlannerEnabled:process.env.COMPANION_AI_PLANNER_ENABLED==='true',autoSubmit:run.details?.autoSubmit===true&&autoAvailable,autoDiscover:run.details?.autoDiscover===true&&autoAvailable,autoPrepare:run.details?.autoPrepare===true&&autoAvailable,stopReason:autoAvailable?'':remainingSlots===0?'Daily limit reached. Confirmed and unresolved submission attempts reserve the current daily slots. Check pending outcomes before starting more applications.':'Auto-Apply is off or the plan has expired.',reviewReason:run.details?.reviewReason||'',
     resume:files[0]?{fileName:files[0].fileName,mimeType:files[0].mimeType,base64:Buffer.from(files[0].fileBytes).toString('base64')}:null,
     profile:run.kind==='APPLY'?{name:user.name,email:user.email,phone:user.phone||'',linkedIn:user.linkedIn||'',portfolio:user.portfolio||'',currentTitle:user.currentTitle||'',experience:user.experience||''}:null};
 }
 async planApplication(device:any,id:string,body:any){
   if(process.env.COMPANION_AI_PLANNER_ENABLED!=='true')throw new BadRequestException('Desktop planner is not enabled.');
   if(this.plannerBusy.has(id))throw new BadRequestException('An application decision is already in progress.');
   this.plannerBusy.add(id);
   try{
     const task=await this.task(device,id);
     if(task.kind!=='APPLY'||!task.autoSubmit||task.reviewReason||!task.resume||!['OPENED','REVIEW_REQUIRED'].includes(task.stage))throw new BadRequestException(task.stopReason||'This application is not eligible for planning.');
     const observation=cleanObservation(body);
     if(observation.url!==task.url)throw new BadRequestException('Return to the selected application before planning.');
     const app=await this.prisma.jobApplication.findFirst({where:{id:task.applicationId,userId:device.userId}});
     if(!app||app.status==='APPLIED')throw new BadRequestException('This application is unavailable or already submitted.');
     const words=String(app.jobTitle).toLowerCase().match(/[a-z]{3,}/g)||[],page=observation.text.toLowerCase();
     if(!words.length||words.filter(w=>page.includes(w)).length/words.length<0.7||!page.includes(String(app.companyName).toLowerCase()))return {action:{kind:'ASK_USER',reason:'The selected job and employer could not be verified on this page.'}};
     const user=await this.prisma.user.findUnique({where:{id:device.userId}}),facts=factsFor(user);
     const count=Number(task.details?.plannerSteps||0);
     if(count>=36)return {action:{kind:'ASK_USER',reason:'This form needs review after 36 application steps.'}};
     let raw:any;
     if(observation.challenge)raw={kind:'ASK_USER'};
     else{
       // Fill only exact saved facts first; the model handles layout/navigation.
       const known=observation.fields.map(field=>({field,value:knownFieldValue(field,facts)})).find(x=>x.value);
       const upload=observation.fields.find(f=>!f.filled&&!f.disabled&&f.type==='file'&&/resume|\bcv\b/i.test(f.label)&&!/cover|photo|avatar/i.test(f.label));
       if(known)raw={kind:'FILL',element:known.field.id,fact:known.value.fact};
       else if(upload)raw={kind:'UPLOAD',element:upload.id};
       else {
         const unknown=observation.fields.find(f=>f.required&&!f.filled&&!f.disabled&&answerableField(f));
         raw=unknown?{kind:'ASK_USER',element:unknown.id}:await requestDesktopPlan(observation,facts,{title:app.jobTitle,company:app.companyName});
       }
     }
     let action:any=checkedAction(raw,observation,facts);
     if(action.kind==='ASK_USER'){
       const field=observation.fields[raw.element]||observation.fields.find(f=>f.required&&!f.filled&&answerableField(f));
       if(field&&answerableField(field)&&!field.filled){
         const context={url:task.url,company:app.companyName,title:app.jobTitle};
         const memory=task.details?.answers?.[field.label]?null:await new WhatsAppService(this.prisma).recalled(device.userId,field,context);
         const saved=task.details?.answers?.[field.label]||memory?.value;
         if(typeof saved==='string'&&saved&&(!field.options.length||field.options.some(x=>x.trim().toLowerCase()===saved.trim().toLowerCase())))action={kind:'FILL',element:field.id,value:saved,source:'USER_ANSWER'};
         else action={kind:'ASK_USER',element:field.id,field,reason:'Your answer is needed: '+field.label};
       }
     }
     const signature=digest(JSON.stringify({observation,kind:action.kind,element:action.element}));
     if(task.details?.plannerLast===signature)action={kind:'ASK_USER',reason:'The previous step did not change this form. Review it before continuing.'};
     // A concurrent cancellation, submission or another planner wins this race.
     const changed:any[]=await this.prisma.$queryRaw`UPDATE "BrowserRun" SET "details"="details" || ${JSON.stringify({plannerSteps:count+1,plannerLast:signature,message:'Application planner: '+action.kind})}::jsonb,"updatedAt"=NOW() WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id} AND "stage" IN ('OPENED','REVIEW_REQUIRED') AND COALESCE(("details"->>'plannerSteps')::int,0)=${count} RETURNING "id"`;
     if(!changed.length)throw new BadRequestException('This application changed while planning. No action was executed.');
     return {action,step:count+1};
   }finally{this.plannerBusy.delete(id);}
 }
 async applicationQuestion(device:any,id:string,body:any){
   const task=await this.task(device,id),field=body?.field;
   if(task.kind!=='APPLY'||task.stage!=='REVIEW_REQUIRED'||task.details?.needsInput!==true||!answerableField(field))throw new BadRequestException('No answerable application question is pending.');
   // Only the field recorded by the browser's parked report can be sent.
   if(!task.details?.missingFields?.some((x:any)=>x.label===field.label&&x.type===field.type))throw new BadRequestException('The application question changed.');
   if(task.details?.whatsappQuestionId)return {requested:true,delivery:'CHECK_TASK',message:'An answer request already exists for this task.'};
   const claimed:any[]=await this.prisma.$queryRaw`UPDATE "BrowserRun" SET "details"="details" || '{"whatsappQuestionId":"REQUESTING"}'::jsonb WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id} AND "stage"='REVIEW_REQUIRED' AND COALESCE("details"->>'whatsappQuestionId','')='' RETURNING "id"`;
   if(!claimed.length)return {requested:true,delivery:'CHECK_TASK',message:'An answer request is already being processed.'};
   const app=await this.prisma.jobApplication.findFirst({where:{id:task.applicationId,userId:device.userId}});
   const whatsapp=new WhatsAppService(this.prisma);
   const questionId=await whatsapp.ask({id,userId:device.userId,kind:'APPLY'},field,task.url,{url:task.url,company:app?.companyName,title:app?.jobTitle});
   if(!questionId){await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "details"="details" - 'whatsappQuestionId' WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id} AND "details"->>'whatsappQuestionId'='REQUESTING'`;return {requested:false,message:'WhatsApp is not ready for this account. Answer this question from the application task.'};}
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "details"="details" || ${JSON.stringify({whatsappQuestionId:questionId})}::jsonb WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id}`;
   const rows:any[]=await this.prisma.$queryRaw`SELECT "state" FROM "WhatsAppQuestion" WHERE "id"=${questionId} AND "userId"=${device.userId}`;
   return {requested:true,delivery:rows[0]?.state||'DELIVERY_UNKNOWN',message:rows[0]?.state==='ACCEPTED'?'WhatsApp accepted the answer request. Delivery is not yet confirmed.':'WhatsApp delivery is unconfirmed. This task remains paused.'};
 }
 async importJobs(device:any,id:string,data:any){
   const task=await this.task(device,id);
   if(task.kind!=='DISCOVER'||!['OPENED','REVIEW_REQUIRED'].includes(task.stage)||!Array.isArray(data.jobs)||data.jobs.length>30)throw new BadRequestException('Invalid discovery report.');
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{preferences:true}});
   const listings=new Map<string,any>();
   for(const row of data.jobs){
     if(typeof row.url!=='string'||!browserJobUrl(row.url)||new URL(row.url).origin!==new URL(task.url).origin||typeof row.title!=='string'||!row.title.trim())throw new BadRequestException('Invalid portal listing.');
     if(!validListingTitle(row.title))continue;
     const parsed=new URL(row.url);parsed.search='';parsed.hash='';const url=parsed.href;
     const jobId=digest(device.userId+':'+url);
     const metadata={version:'browser-listing-v1',url,source:task.portal,location:String(row.location||'See job details').slice(0,150),skills:[],reasons:['Live job link observed in your browser. Review the full job requirements before applying.'],checkedAt:new Date().toISOString()};
     listings.set(jobId,{id:jobId,url,jobTitle:row.title.slice(0,200),companyName:String(row.company||task.portal).slice(0,150),matchReasons:metadata});
   }
   // Thirty listings previously caused hundreds of sequential DB round trips,
   // outliving the companion's request deadline. Validate first, then save the
   // listing batch and inspection queue atomically with a fixed query count.
   const rows=[...listings.values()],payload=JSON.stringify(rows);
   if(!rows.length)throw new BadRequestException('No supported job titles were found. Portal action links were not imported as jobs.');
   const inspectionLimit=Math.min(15,user.dailyApplyLimit*3);
   const inspections=JSON.stringify(task.autoDiscover?rows.filter(row=>roleMatches(row.jobTitle,user.preferences?.titles||[])).map(row=>({id:randomUUID(),applicationId:row.id,url:row.url})):[]);
   return this.prisma.$transaction(async tx=>{
     const locked:any[]=await tx.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id} AND "stage" IN ('OPENED','REVIEW_REQUIRED') FOR UPDATE`;
     if(!locked.length)throw new BadRequestException('This discovery has finished or was cancelled.');
     await tx.$executeRaw`INSERT INTO "JobApplication" ("id","userId","jobTitle","companyName","portal","matchScore","matchReasons","applyMode","updatedAt")
       SELECT row.id,${device.userId},row."jobTitle",row."companyName",${task.portal==='Naukri.com'?'NAUKRI':'LINKEDIN'}::"PortalType",0,row."matchReasons",'ASSISTED_APPLY'::"ApplyMode",NOW()
       FROM jsonb_to_recordset(${payload}::jsonb) AS row(id text,"jobTitle" text,"companyName" text,"matchReasons" jsonb)
       ON CONFLICT ("id") DO UPDATE SET "jobTitle"=EXCLUDED."jobTitle","updatedAt"=NOW()`;
     const inspectRuns:any[]=await tx.$queryRaw`INSERT INTO "BrowserRun" ("id","userId","deviceId","kind","portal","url","applicationId","details")
       SELECT row.id,${device.userId},${device.id},'INSPECT',${task.portal},row.url,row."applicationId",'{"autoSubmit":false,"autoDiscover":true,"autoPrepare":false,"resumeId":null,"reviewReason":""}'::jsonb
       FROM jsonb_to_recordset(${inspections}::jsonb) AS row(id text,"applicationId" text,url text)
       WHERE EXISTS (SELECT 1 FROM "BrowserDevice" d JOIN "User" u ON u.id=d."userId" JOIN "Subscription" s ON s."userId"=u.id WHERE d.id=${device.id} AND d."userId"=${device.userId} AND d."revokedAt" IS NULL AND d."expiresAt">NOW() AND u."activeMode"='AUTO_APPLY' AND u."autoApplyConsent"=true AND s.active=true AND s."trialEnds">NOW())
       AND EXISTS (SELECT 1 FROM "JobApplication" a WHERE a.id=row."applicationId" AND a."userId"=${device.userId} AND a.status<>'APPLIED')
       AND NOT EXISTS (SELECT 1 FROM "BrowserRun" r WHERE r."userId"=${device.userId} AND r."applicationId"=row."applicationId" AND r.stage IN ('CREATED','OPENED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN'))
       AND NOT EXISTS (SELECT 1 FROM "AgentRun" a WHERE a."userId"=${device.userId} AND a."applicationId"=row."applicationId" AND a.state IN ('QUEUED','RUNNING','WAITING_USER','SUBMITTING','UNKNOWN','CONFIRMED'))
       ORDER BY (SELECT MAX(r."updatedAt") FROM "BrowserRun" r WHERE r."userId"=${device.userId} AND r."applicationId"=row."applicationId" AND r.kind='INSPECT' AND r.stage='INSPECTED') ASC NULLS FIRST,row."applicationId"
       LIMIT ${inspectionLimit}
       ON CONFLICT DO NOTHING RETURNING "id","kind","portal","url"`;
     if(task.autoDiscover)await tx.$executeRaw`UPDATE "BrowserRun" SET "stage"='DISCOVERED',"updatedAt"=NOW() WHERE "id"=${id}`;
     return {imported:rows.length,inspectRuns};
   },{timeout:10000});
 }
 async observeJob(device:any,data:any,inspectionId?:string){
   if(typeof data?.url!=='string'||!browserJobUrl(data.url)||typeof data.title!=='string'||!data.title.trim()||typeof data.description!=='string'||data.description.length<120||data.description.length>50000)throw new BadRequestException('A supported job page and its description are required.');
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{preferences:true,subscription:true}});
   if(user?.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent||!user.subscription?.active||user.subscription.trialEnds<=new Date())return {prepared:false,reason:'Auto-Apply is off or your plan has expired.'};
   let inspectedApplicationId:string=null;
   if(inspectionId){const run=await this.task(device,inspectionId);inspectedApplicationId=run.applicationId;if(run.kind!=='INSPECT'||!['CREATED','OPENED','REVIEW_REQUIRED'].includes(run.stage)||!run.autoDiscover||!(sameApplicationPage(run.url,data.url)||new URL(run.url).origin===new URL(data.url).origin&&new URL(run.url).pathname.replace(/\/$/,'')===new URL(data.url).pathname.replace(/\/$/,'')))throw new BadRequestException('Inspection belongs to another job or has ended.');}
   const parsed=new URL(data.url);parsed.search='';parsed.hash='';const url=parsed.href;
   const old=await this.prisma.jobApplication.findFirst({where:{userId:device.userId,...(inspectedApplicationId?{id:inspectedApplicationId}:{matchReasons:{path:['url'],equals:url}})}});
   const previous:any=old?.matchReasons||{};
   // Some LinkedIn layouts expose the global notifications H1 before the job
   // heading. Reuse only a previously observed title for this exact posting URL.
   const title=validListingTitle(data.title)?data.title:previous.url===url&&['browser-listing-v1','official-feed-v1'].includes(previous.version)&&validListingTitle(old?.jobTitle)?old.jobTitle:null;
   if(!title)throw new BadRequestException('The selected posting has no supported job title.');
   const match=skillMatch(user.skills||'',data.description),minimumYears=minimumExperience(data.description);
   const version=previous.version==='official-feed-v1'?'official-feed-v1':'browser-listing-v1';
   const metadata={...previous,version,url,source:parsed.hostname.includes('naukri')?'Naukri.com':parsed.hostname.includes('linkedin')?'LinkedIn':parsed.hostname.includes('lever')?'lever':'greenhouse',location:String(data.location||previous.location||'See employer listing').slice(0,160),matchAssessed:match.requested.length>=3,minimumYears,skills:match.matched,reasons:[match.requested.length>=3?`${match.matched.length} of ${match.requested.length} recognized technologies match your saved profile`:'Insufficient skill evidence; manual review required','Job description observed in your paired browser. Review all employer requirements.'],checkedAt:new Date().toISOString()};
   const jobId=old?.id||digest(device.userId+':'+url);
   await this.prisma.jobApplication.upsert({where:{id:jobId},create:{id:jobId,userId:device.userId,jobTitle:title.slice(0,200),companyName:String(data.company||metadata.source).slice(0,150),portal:metadata.source==='Naukri.com'?'NAUKRI':metadata.source==='LinkedIn'?'LINKEDIN':'ATS_DIRECT',matchScore:match.score,matchReasons:metadata,applyMode:'ASSISTED_APPLY'},update:{matchScore:match.score,matchReasons:metadata}});
   const selectedRole=roleMatches(title,user.preferences?.titles||[]);
   const eligible=selectedRole&&metadata.matchAssessed&&match.score>=user.minMatchScore;
   if(inspectionId)await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='INSPECTED',"updatedAt"=NOW() WHERE "id"=${inspectionId}`;
   let result:any={prepared:false,reason:eligible?'Job is ready for a browser application.':!selectedRole?`Observed job title does not match your selected roles: ${title.slice(0,160)}.`:!metadata.matchAssessed?'Job needs review: fewer than three recognized technologies were found in its description.':`Job needs review: keyword coverage ${match.score}% (saved minimum ${user.minMatchScore}%).`};
   if(old?.status==='APPLIED')result={prepared:false,reason:'This job already has a recorded submission.'};
   else if(eligible||!inspectionId&&roleMatches(title,user.preferences?.titles||[])){
     try{const nextRun=await this.create(device.userId,{kind:'APPLY',applicationId:jobId,autoSubmit:eligible,autoPrepare:true});result={prepared:true,nextRun,autoSubmit:eligible,reason:eligible?'Matched job. Preparing saved profile and resume.':'Preparing your resume for manual review; automatic submission criteria were not met.'};}catch(error){result={prepared:false,reason:typeof error.message==='string'?error.message:'Application needs review.'};}
   }
   if(inspectionId)await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='INSPECTED',"details"="details" || ${JSON.stringify({message:result.reason})}::jsonb,"updatedAt"=NOW() WHERE "id"=${inspectionId}`;
   return result;
 }
 async report(device:any,id:string,data:any){
   if(!data||typeof data.stage!=='string'||typeof data.url!=='string'||!supportedBrowserUrl(data.url))throw new BadRequestException('Invalid browser report.');
   const stage=data.stage;
   return this.prisma.$transaction(async tx=>{
     const rows:any[]=await tx.$queryRaw`SELECT * FROM "BrowserRun" WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id} FOR UPDATE`;
     const run=rows[0];if(!run)throw new NotFoundException('Browser task not found.');
     const employerAlias=sameApplicationPage(run.url,data.url);
     if(new URL(data.url).origin!==new URL(run.url).origin&&!employerAlias)throw new BadRequestException('Report must come from the task portal.');
     const jobPath=(value:string)=>new URL(value).pathname.replace(/\/(apply|thanks|thank-you|confirmation)\/?$/,'').replace(/\/$/,'');
     const isNaukriApplyReturn = new URL(data.url).hostname === 'www.naukri.com' && new URL(data.url).pathname.startsWith('/myapply/');
      if(run.kind==='APPLY'&&jobPath(data.url)!==jobPath(run.url)&&!employerAlias&&!isNaukriApplyReturn)throw new BadRequestException('The browser is on a different job. Return to the original application.');
     if(Date.now()-new Date(run.createdAt).getTime()>86400000)throw new BadRequestException('Browser task expired.');
     if(stage===run.stage&&['VERIFIED','BROWSER_CONFIRMED'].includes(stage))return {stage};
     if(!(ALLOWED[run.stage]||[]).includes(stage))throw new BadRequestException('Invalid browser task transition.');
     if(stage==='SUBMITTING'){
       if(run.kind!=='APPLY')throw new BadRequestException('This is not an application task.');
       const application=await tx.jobApplication.findFirst({where:{id:run.applicationId,userId:device.userId}});
       if(!application||application.status==='APPLIED')throw new BadRequestException('This application already has a submission or is unavailable.');
       await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${device.userId} FOR UPDATE`;
       const user=await tx.user.findUnique({where:{id:device.userId},include:{subscription:true}});
       if(!user.subscription?.active||user.subscription.trialEnds<=new Date())throw new BadRequestException('Your plan has expired.');
       if(run.details?.autoSubmit&&(user.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent))throw new BadRequestException('Auto-Apply was switched off. Review this application manually.');
       const day=new Date(Date.now()+19800000).toISOString().slice(0,10);
       const from=new Date(day+'T00:00:00+05:30');
       const submitted=await tx.jobApplication.findMany({where:{userId:device.userId,status:'APPLIED',appliedAt:{gte:from}}});
       const sent=submitted.filter(app=>hasSubmissionEvidence(app)).length;
       const pending:any[]=await tx.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${device.userId} AND "id"!=${run.id} AND "stage" IN ('SUBMITTING','UNKNOWN') AND "kind"='APPLY' AND "updatedAt">=${from}`;
       const hosted:any[]=await tx.$queryRaw`SELECT "id","applicationId" FROM "AgentRun" WHERE "userId"=${device.userId} AND "state" IN ('SUBMITTING','UNKNOWN') AND "submitReservedAt">=${from}`;
       if(hosted.some(x=>x.applicationId===run.applicationId))throw new BadRequestException('A hosted submission is already pending for this job.');
       if(sent+pending.length+hosted.length>=user.dailyApplyLimit)throw new BadRequestException('Daily application limit reached. Pending outcomes also count against the limit.');
     }
     if(stage==='VERIFIED'&&(run.kind!=='VERIFY'||data.evidence?.type!=='SIGNED_IN_MARKER'))throw new BadRequestException('Missing sign-in observation.');
     if(stage==='BROWSER_CONFIRMED'){
       if(run.kind!=='APPLY')throw new BadRequestException('This is not an application task.');
       if(!['SUBMITTING','UNKNOWN'].includes(run.stage))throw new BadRequestException('No submission attempt was recorded for this application.');
       const evidenceText=data.evidence?.text||data.confirmation||data.message||'';
       if(/already applied/i.test(evidenceText))throw new BadRequestException('An existing application is not a new submission.');
       if(!/(application (has been |was )?(submitted|received)|thank you for (applying|your application)|successfully applied|applied to \b)/i.test(evidenceText))throw new BadRequestException('Missing employer success message.');
       if(!data.evidence)data.evidence={type:'SUBMISSION_MESSAGE',text:evidenceText};
     }
     // Evidence is a browser observation, not a signed employer API receipt.
     const observed=new URL(data.url);
     const details={...run.details,answerReady:data.needsInput===true?false:run.details?.answerReady,message:String(data.message||'').slice(0,500),evidence:data.evidence?{type:String(data.evidence.type||'').slice(0,40),text:String(data.evidence.text||'').slice(0,400)}:null,missingFields:Array.isArray(data.missingFields)?data.missingFields.slice(0,10):run.details?.missingFields,needsInput:data.needsInput===true,parkedReason:data.needsInput===true?'WAITING_USER_INPUT':run.details?.parkedReason,parkedAt:data.needsInput===true?new Date().toISOString():run.details?.parkedAt,observedUrl:observed.origin+observed.pathname,observationSource:'USER_BROWSER',history:[...(Array.isArray(run.details?.history)?run.details.history:[]).slice(-19),{stage,at:new Date().toISOString()}]};
     await tx.$executeRaw`UPDATE "BrowserRun" SET "stage"=${stage},"details"=${JSON.stringify(details)}::jsonb,"updatedAt"=NOW() WHERE "id"=${id}`;
     if(stage==='BROWSER_CONFIRMED'){
       const app=await tx.jobApplication.findFirst({where:{id:run.applicationId,userId:device.userId}});
       if(!app)throw new NotFoundException('Application no longer exists.');
       await tx.jobApplication.update({where:{id:app.id},data:{status:'APPLIED',appliedAt:new Date(),matchReasons:{...(app.matchReasons as any),browserConfirmation:{runId:id,observedAt:new Date().toISOString(),text:details.evidence.text}}}});
     }
     return {stage};
   });
 }
}
