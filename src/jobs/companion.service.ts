import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { trustedApplicationUrl, sameApplicationPage } from './live-sources';
import { minimumExperience,roleMatches,skillMatch } from './skill-match';
import { hasSubmissionEvidence } from './application-evidence';

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
 constructor(private readonly prisma:PrismaService){}
 private async remaining(userId:string,limit:number){
   const day=new Date(Date.now()+19800000).toISOString().slice(0,10),from=new Date(day+'T00:00:00+05:30');
   await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='UNKNOWN',"updatedAt"=NOW(),"details"="details" || '{"message":"Submission outcome was not confirmed within 5 minutes."}'::jsonb WHERE "userId"=${userId} AND "kind"='APPLY' AND "stage"='SUBMITTING' AND "updatedAt" < NOW()-INTERVAL '5 minutes'`;
   const applications=await this.prisma.jobApplication.findMany({where:{userId,status:'APPLIED',appliedAt:{gte:from}}});
   const sent=applications.filter(app=>hasSubmissionEvidence(app)).length;
   const inFlight:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${userId} AND "kind"='APPLY' AND "stage"='SUBMITTING' AND "updatedAt">NOW()-INTERVAL '5 minutes'`;
   const hosted:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "userId"=${userId} AND "state"='SUBMITTING' AND "submitReservedAt">NOW()-INTERVAL '5 minutes'`;
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
    const count=await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='CANCELLED',"updatedAt"=NOW() WHERE "userId"=${userId} AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED','UNKNOWN')`;
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
     if(!app||!['official-feed-v1','browser-listing-v1'].includes(m?.version)||!browserJobUrl(m.url))throw new NotFoundException('Live employer application not found.');
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
         const years=(user.experience||'').match(/\d+/g)?.map(Number)||[];
         const lower=years[0]??0,upper=years.length>1?years[1]:/\+/.test(user.experience||'')?Infinity:lower;
         if(upper<m.minimumYears)throw new BadRequestException(`Employer requires at least ${m.minimumYears} years; saved experience does not meet that minimum.`);
         if(lower<m.minimumYears)reviewReason=`Confirm you meet the employer's ${m.minimumYears}-year minimum. Your saved experience is a range.`;
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
 async autoBatch(device:any){
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{subscription:true,preferences:true}});
   if(process.env.COMPANION_AUTO_APPLY_ENABLED!=='true')throw new BadRequestException('Desktop Auto-Apply is not enabled on this deployment.');
   if(!user||user.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent||!user.subscription?.active||user.subscription.trialEnds<=new Date())throw new BadRequestException('Enable Auto-Apply with an active plan first.');
   const hosted:any[]=await this.prisma.$queryRaw`SELECT "userId" FROM "AgentPreference" WHERE "userId"=${device.userId} AND "enabled"=true LIMIT 1`;
   if(hosted.length)throw new BadRequestException('Pause Hosted Agent before enabling desktop processing.');
   const remaining=await this.remaining(device.userId,user.dailyApplyLimit);
   if(!remaining)return {runs:[],remaining:0,message:'Daily limit reached. Unconfirmed submissions also reserve a slot.'};
   // Never replay a click whose result is unknown, or silently restart a form needing input.
   const pending:any[]=await this.prisma.$queryRaw`SELECT "id","kind","stage","portal" FROM "BrowserRun" WHERE "userId"=${device.userId} AND "deviceId"=${device.id} AND "stage" IN ('CREATED','OPENED') AND ("details"->>'autoSubmit'='true' OR "details"->>'autoDiscover'='true') AND "createdAt">NOW()-INTERVAL '24 hours' ORDER BY "createdAt" ASC LIMIT 30`;
   if(pending.length)return {runs:pending,remaining};
   const settings:any[]=await this.prisma.$queryRaw`SELECT "selectedPortals" FROM "User" WHERE "id"=${device.userId}`;
   const selected=settings[0]?.selectedPortals;
   const portals=Array.isArray(selected)?selected.filter((p:string)=>!!portalUrls[p]):[];
   if(!portals.length)return {runs:[],remaining,message:'Select Naukri or LinkedIn in your saved preferences.'};
   const runs=[];
   for(const portal of portals){
     const recent:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${device.userId} AND "portal"=${portal} AND "kind"='DISCOVER' AND "createdAt">NOW()-INTERVAL '15 minutes' LIMIT 1`;
     if(recent.length)continue;
     runs.push(await this.create(device.userId,{kind:'DISCOVER',portal,autoDiscover:true}));
   }
   return {runs,remaining,message:runs.length?'Reading selected portal jobs.':'Waiting before the next discovery check.'};
 }
 async task(device:any,id:string){
   const rows:any[]=await this.prisma.$queryRaw`SELECT * FROM "BrowserRun" WHERE "id"=${id} AND "userId"=${device.userId} AND "deviceId"=${device.id}`;
   const run=rows[0];if(!run)throw new NotFoundException('Browser task not found.');
   if(['DISCONNECTED','TIMED_OUT'].includes(run.stage))throw new BadRequestException('Portal check ended. Start a new login check from ApplyBro.');
   if(Date.now()-new Date(run.createdAt).getTime()>86400000)throw new BadRequestException('Browser task expired. Start a new run.');
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{subscription:true}});
   const autoAvailable=process.env.COMPANION_AUTO_APPLY_ENABLED==='true'&&user.activeMode==='AUTO_APPLY'&&user.autoApplyConsent&&user.subscription?.active&&user.subscription.trialEnds>new Date()&&await this.remaining(user.id,user.dailyApplyLimit)>0;
   const files:any[]=run.kind==='APPLY'&&run.details?.resumeId?await this.prisma.$queryRaw`SELECT "fileName","fileBytes","mimeType" FROM "Resume" WHERE "userId"=${device.userId} AND "id"=${run.details.resumeId} AND "fileBytes" IS NOT NULL`:[];
   return {...run,autoSubmit:run.details?.autoSubmit===true&&autoAvailable,autoDiscover:run.details?.autoDiscover===true&&autoAvailable,autoPrepare:run.details?.autoPrepare===true&&autoAvailable,stopReason:autoAvailable?'':'Auto-Apply is off, the plan expired, or the daily limit was reached.',reviewReason:run.details?.reviewReason||'',
     resume:files[0]?{fileName:files[0].fileName,mimeType:files[0].mimeType,base64:Buffer.from(files[0].fileBytes).toString('base64')}:null,
     profile:run.kind==='APPLY'?{name:user.name,email:user.email,phone:user.phone||'',linkedIn:user.linkedIn||'',portfolio:user.portfolio||'',currentTitle:user.currentTitle||'',experience:user.experience||''}:null};
 }
 async importJobs(device:any,id:string,data:any){
   const task=await this.task(device,id);
   if(task.kind!=='DISCOVER'||!['OPENED','REVIEW_REQUIRED'].includes(task.stage)||!Array.isArray(data.jobs)||data.jobs.length>30)throw new BadRequestException('Invalid discovery report.');
   let imported=0;const inspectRuns=[];
   const user=await this.prisma.user.findUnique({where:{id:device.userId},include:{preferences:true}});
   for(const row of data.jobs){
     if(typeof row.url!=='string'||!browserJobUrl(row.url)||new URL(row.url).origin!==new URL(task.url).origin||typeof row.title!=='string'||!row.title.trim())throw new BadRequestException('Invalid portal listing.');
     const parsed=new URL(row.url);parsed.search='';parsed.hash='';const url=parsed.href;
     const jobId=digest(device.userId+':'+url);
     const metadata={version:'browser-listing-v1',url,source:task.portal,location:String(row.location||'See job details').slice(0,150),skills:[],reasons:['Live job link observed in your browser. Review the full job requirements before applying.'],checkedAt:new Date().toISOString()};
     await this.prisma.jobApplication.upsert({where:{id:jobId},create:{id:jobId,userId:device.userId,jobTitle:row.title.slice(0,200),companyName:String(row.company||task.portal).slice(0,150),portal:task.portal==='Naukri.com'?'NAUKRI':'LINKEDIN',matchScore:0,matchReasons:metadata,applyMode:'ASSISTED_APPLY'},update:{jobTitle:row.title.slice(0,200)}});imported++;
     if(task.autoDiscover&&inspectRuns.length<Math.min(15,user.dailyApplyLimit*3)&&roleMatches(row.title,user.preferences?.titles||[])){
       try{inspectRuns.push(await this.create(device.userId,{kind:'INSPECT',applicationId:jobId,autoDiscover:true}));}catch{}
     }
   }
   if(task.autoDiscover)await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='DISCOVERED',"updatedAt"=NOW() WHERE "id"=${id}`;
   return {imported,inspectRuns};
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
   const match=skillMatch(user.skills||'',data.description),minimumYears=minimumExperience(data.description);
   const version=previous.version==='official-feed-v1'?'official-feed-v1':'browser-listing-v1';
   const metadata={...previous,version,url,source:parsed.hostname.includes('naukri')?'Naukri.com':parsed.hostname.includes('linkedin')?'LinkedIn':parsed.hostname.includes('lever')?'lever':'greenhouse',location:String(data.location||previous.location||'See employer listing').slice(0,160),matchAssessed:match.requested.length>=3,minimumYears,skills:match.matched,reasons:[match.requested.length>=3?`${match.matched.length} of ${match.requested.length} recognized technologies match your saved profile`:'Insufficient skill evidence; manual review required','Job description observed in your paired browser. Review all employer requirements.'],checkedAt:new Date().toISOString()};
   const jobId=old?.id||digest(device.userId+':'+url);
   await this.prisma.jobApplication.upsert({where:{id:jobId},create:{id:jobId,userId:device.userId,jobTitle:data.title.slice(0,200),companyName:String(data.company||metadata.source).slice(0,150),portal:metadata.source==='Naukri.com'?'NAUKRI':metadata.source==='LinkedIn'?'LINKEDIN':'ATS_DIRECT',matchScore:match.score,matchReasons:metadata,applyMode:'ASSISTED_APPLY'},update:{matchScore:match.score,matchReasons:metadata}});
   const eligible=roleMatches(data.title,user.preferences?.titles||[])&&metadata.matchAssessed&&match.score>=user.minMatchScore;
   if(inspectionId)await this.prisma.$executeRaw`UPDATE "BrowserRun" SET "stage"='INSPECTED',"updatedAt"=NOW() WHERE "id"=${inspectionId}`;
   let result:any={prepared:false,reason:eligible?'Job is ready for a browser application.':`Job needs review: keyword coverage ${match.score}% (saved minimum ${user.minMatchScore}%).`};
   if(old?.status==='APPLIED')result={prepared:false,reason:'This job already has a recorded submission.'};
   else if(eligible||!inspectionId&&roleMatches(data.title,user.preferences?.titles||[])){
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
       const evidenceText=data.evidence?.text||data.confirmation||data.message||'';
       if(!/(application (has been |was )?(submitted|received)|thank you for (applying|your application)|successfully applied|applied to \b|applied on naukri|already applied|^applied)/i.test(evidenceText))throw new BadRequestException('Missing employer success message.');
       if(!data.evidence)data.evidence={type:'SUBMISSION_MESSAGE',text:evidenceText};
     }
     // Evidence is a browser observation, not a signed employer API receipt.
     const observed=new URL(data.url);
     const details={...run.details,message:String(data.message||'').slice(0,500),evidence:data.evidence?{type:String(data.evidence.type||'').slice(0,40),text:String(data.evidence.text||'').slice(0,400)}:null,observedUrl:observed.origin+observed.pathname,observationSource:'USER_BROWSER',history:[...(Array.isArray(run.details?.history)?run.details.history:[]).slice(-19),{stage,at:new Date().toISOString()}]};
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
