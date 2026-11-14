import { BadRequestException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { randomBytes,randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { minimumExperience } from '../jobs/skill-match';
import { approvedUrl,factsFor,seal,tokenHash,unseal,localPilotEnabled } from './agent-policy';

@Injectable()
export class CloudAgentService {
 constructor(private readonly db:PrismaService,private readonly jobs:JobsService){}
 async config(){
  const issues=[];if(process.env.CLOUD_AGENT_ENABLED!=='true')issues.push('Server-side agent is not enabled by the operator.');
  const localPilot=localPilotEnabled();
  if((!process.env.RESEND_API_KEY||!process.env.CLOUD_AGENT_EMAIL_FROM)&&!localPilot)issues.push('Verification email sender is not configured.');
  if(!/^[a-f0-9]{64}$/i.test(process.env.CLOUD_AGENT_ENCRYPTION_KEY||''))issues.push('Private session encryption is not configured.');
  if(!process.env.CLOUD_AGENT_MODEL||!(process.env.CLOUD_AGENT_API_KEY||process.env.GEMINI_API_KEYS))issues.push('Vision model configuration is missing.');
  try{const u=new URL(process.env.CLOUD_AGENT_PUBLIC_ORIGIN||'');if(u.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(u.hostname)&&u.protocol==='http:'))throw Error();}catch{issues.push('A valid HTTPS website origin is required for action links.');}
  const hosts=(process.env.CLOUD_AGENT_ALLOWED_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean);if(!hosts.length)issues.push('No employer sites have been enabled for this deployment.');
  const heart:any[]=await this.db.$queryRaw`SELECT "updatedAt","modelReady" FROM "AgentHeartbeat" ORDER BY "updatedAt" DESC LIMIT 1`;
  const workerOnline=!!heart[0]&&Date.now()-new Date(heart[0].updatedAt).getTime()<90000;
  if(!workerOnline)issues.push('Hosted browser worker is offline.');
  if(!heart[0]?.modelReady)issues.push('AI model connection has not passed the worker startup check.');
  return {ready:!issues.length,issues,workerOnline,allowedHosts:hosts,emailConfigured:!!(process.env.RESEND_API_KEY&&process.env.CLOUD_AGENT_EMAIL_FROM),handoffMinutes:5,localPilot};
 }
 async owned(userId:string,id:string){const rows:any[]=await this.db.$queryRaw`SELECT * FROM "AgentRun" WHERE "id"=${id} AND "userId"=${userId}`;if(!rows[0])throw new NotFoundException('Agent task not found.');return rows[0];}
 async status(userId:string){
  const runs:any[]=await this.db.$queryRaw`SELECT r."id",r."state",r."reason",r."steps",r."createdAt",r."updatedAt",r."interactiveUntil",r."handoffExpires",r."confirmation",a."jobTitle",a."companyName" FROM "AgentRun" r JOIN "JobApplication" a ON a."id"=r."applicationId" WHERE r."userId"=${userId} ORDER BY r."createdAt" DESC LIMIT 30`;
  const preferences:any[]=await this.db.$queryRaw`SELECT "enabled","consentedAt" FROM "AgentPreference" WHERE "userId"=${userId}`;
  const notices:any[]=await this.db.$queryRaw`SELECT DISTINCT ON (n."runId") n."runId",n."state",n."expiresAt" FROM "AgentNotice" n JOIN "AgentRun" r ON r."id"=n."runId" WHERE r."userId"=${userId} ORDER BY n."runId",n."createdAt" DESC`;
  const matches=await this.jobs.getMatchedJobs(userId);
  const user=await this.db.user.findUnique({where:{id:userId},select:{minMatchScore:true}});
  const candidateJobs=matches.jobs.filter(job=>job.status!=='APPLIED'&&job.matchAssessed&&job.matchScore>=(user?.minMatchScore??70)&&approvedUrl(job.applicationUrl)).slice(0,50).map(job=>({id:job.id,title:job.title,company:job.company,score:job.matchScore}));
  const events:any[]=await this.db.$queryRaw`SELECT e."runId",e."kind",e."message",e."createdAt" FROM "AgentEvent" e JOIN "AgentRun" r ON r."id"=e."runId" WHERE r."userId"=${userId} ORDER BY e."createdAt" DESC LIMIT 100`;
  return {config:await this.config(),enabled:preferences[0]?.enabled===true,runs,notices,candidateJobs,events};
 }
 async settings(userId:string,body:any){
  if(typeof body?.enabled!=='boolean')throw new BadRequestException('Choose whether hosted automation is enabled.');
  if(body.enabled&&body.consent!==true)throw new BadRequestException('Explicit hosted browser and AI-processing consent is required.');
  if(body.enabled){const c=await this.config();if(!c.ready)throw new ServiceUnavailableException(c.issues.join(' '));await this.checkCandidate(userId);}
  const enabled=body.enabled,consentedAt=enabled?new Date():null;
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
  if(enabled){
   await tx.user.update({where:{id:userId},data:{activeMode:'APPROVE_FIRST',autoApplyConsent:false}});
   await tx.$executeRaw`UPDATE "BrowserRun" SET "stage"='CANCELLED',"details"="details" || '{"message":"Switched to hosted browser processing."}'::jsonb,"updatedAt"=NOW() WHERE "userId"=${userId} AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED') AND ("details"->>'autoSubmit'='true' OR "details"->>'autoDiscover'='true' OR "details"->>'autoPrepare'='true')`;
  }
  await tx.$executeRaw`INSERT INTO "AgentPreference"("userId","enabled","consentedAt") VALUES (${userId},${enabled},${consentedAt}) ON CONFLICT ("userId") DO UPDATE SET "enabled"=EXCLUDED."enabled","consentedAt"=EXCLUDED."consentedAt","nextRunAt"=NOW(),"updatedAt"=NOW()`;
  if(!enabled)await tx.$executeRaw`UPDATE "AgentRun" SET "state"='CANCELLED',"reason"='Hosted automation disabled by user.',"screen"=NULL,"interactiveUntil"=NULL,"updatedAt"=NOW() WHERE "userId"=${userId} AND "state" IN ('QUEUED','RUNNING','WAITING_USER') AND "submitReservedAt" IS NULL`;
  });
  return this.status(userId);
 }
 async checkCandidate(userId:string){
  const user=await this.db.user.findUnique({where:{id:userId},include:{subscription:true}});
  if(!user?.subscription?.active||user.subscription.trialEnds<=new Date())throw new BadRequestException('An active plan is required.');
  if(String(user.name||'').trim().split(/\s+/).length<2||!user.phone)throw new BadRequestException('Save your full candidate name and phone in Profile first.');
  const files:any[]=await this.db.$queryRaw`SELECT "id" FROM "Resume" WHERE "userId"=${userId} AND "fileBytes" IS NOT NULL ORDER BY "isDefault" DESC,"createdAt" DESC LIMIT 1`;
  if(!files[0])throw new BadRequestException('Upload the actual private resume file first.');
  return {user,resumeId:files[0].id};
 }
 async enqueue(userId:string,applicationId:string){
  const pref:any[]=await this.db.$queryRaw`SELECT "enabled" FROM "AgentPreference" WHERE "userId"=${userId}`;if(!pref[0]?.enabled)throw new BadRequestException('Enable hosted automation with consent first.');
  const {user,resumeId}=await this.checkCandidate(userId);
  const job=await this.db.jobApplication.findFirst({where:{id:applicationId,userId}}),meta:any=job?.matchReasons;
  if(!job||job.status==='APPLIED'||!meta?.matchAssessed||job.matchScore<user.minMatchScore)throw new BadRequestException('This job needs review or does not meet the saved match threshold.');
  if(!approvedUrl(meta.url))throw new BadRequestException('This employer site has not been enabled for the hosted agent.');
  const minimum=typeof meta.minimumYears==='number'?meta.minimumYears:minimumExperience('');
  const exact=String(user.experience||'').match(/^\s*(\d+(?:\.\d+)?)\s*(years?|yrs?)?\s*$/i);
  if(minimum>0&&(!exact||Number(exact[1])<minimum))throw new BadRequestException('Confirm the exact experience required by this employer before auto-applying.');
  const companion:any[]=await this.db.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${userId} AND "applicationId"=${applicationId} AND "kind"='APPLY' AND "stage" IN ('CREATED','OPENED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN') LIMIT 1`;
  if(companion.length)throw new BadRequestException('An existing companion application must be resolved or cancelled first.');
  const id=randomUUID();try{await this.db.$executeRaw`INSERT INTO "AgentRun"("id","userId","applicationId","resumeId","url") VALUES (${id},${userId},${applicationId},${resumeId},${meta.url})`;}catch(e){if(e?.meta?.code==='23505')throw new BadRequestException('This application already has a hosted task.');throw e;}
  return {id,state:'QUEUED'};
 }
 async queueMatches(userId:string){
  const config=await this.config();if(!config.ready)throw new ServiceUnavailableException(config.issues.join(' '));
  const {user}=await this.checkCandidate(userId);let data=await this.jobs.getMatchedJobs(userId);if(!data.jobs.length)data=await this.jobs.discoverMoreJobs(userId);
  const pending:any[]=await this.db.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "userId"=${userId} AND "state" IN ('QUEUED','RUNNING','WAITING_USER','SUBMITTING','UNKNOWN')`;
  const today=new Date(new Date(Date.now()+19800000).toISOString().slice(0,10)+'T00:00:00+05:30');
  const sent=await this.db.jobApplication.findMany({where:{userId,status:'APPLIED',appliedAt:{gte:today}}});
  const confirmed=sent.filter(a=>{const m:any=a.matchReasons;return m?.providerReceipt||m?.browserConfirmation||m?.agentConfirmation;}).length;
  const budget=Math.min(localPilotEnabled()?1:Infinity,Math.max(0,user.dailyApplyLimit-pending.length-confirmed));
  const queued=[],skipped=[];for(const job of data.jobs.filter(x=>x.status!=='APPLIED').slice(0,50)){if(queued.length>=budget)break;try{queued.push(await this.enqueue(userId,job.id));}catch(e){skipped.push({jobId:job.id,reason:e.message});}}
  return {queued,skipped,applied:0};
 }
 async queueOne(userId:string,applicationId:unknown){
  if(typeof applicationId!=='string'||!applicationId||applicationId.length>128)throw new BadRequestException('Choose a valid saved job.');
  const config=await this.config();if(!config.ready)throw new ServiceUnavailableException(config.issues.join(' '));
  return {queued:[await this.enqueue(userId,applicationId)],skipped:[],applied:0};
 }
 async pause(run:any,reason:string){
  const token=randomBytes(32).toString('base64url'),hash=tokenHash(token),expires=new Date(Date.now()+300000),noticeId=randomUUID();
  const user=await this.db.user.findUnique({where:{id:run.userId},select:{email:true}});
  const origin=process.env.CLOUD_AGENT_PUBLIC_ORIGIN||'';let link='';try{const u=new URL(origin);if(u.protocol==='https:'||u.hostname==='localhost'||u.hostname==='127.0.0.1')link=u.origin+'/agent/action?run='+encodeURIComponent(run.id)+'&token='+token;}catch{}
  await this.db.$transaction(async tx=>{
   const changed=await tx.$executeRaw`UPDATE "AgentRun" SET "state"='WAITING_USER',"reason"=${reason.slice(0,600)},"handoffHash"=${hash},"handoffExpires"=${expires},"handoffUsedAt"=NULL,"interactiveUntil"=NULL,"updatedAt"=NOW() WHERE "id"=${run.id} AND "state"='RUNNING'`;
   if(changed&&link)await tx.$executeRaw`INSERT INTO "AgentNotice"("id","runId","encrypted","expiresAt") VALUES (${noticeId},${run.id},${seal({to:user.email,link,reason:reason.slice(0,300)})},${expires})`;
  });
 }
 async redeem(userId:string,id:string,token:string){
  if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))throw new BadRequestException('Invalid action link.');
  const hash=tokenHash(token),until=new Date(Date.now()+300000);
  const n=await this.db.$executeRaw`UPDATE "AgentRun" SET "handoffUsedAt"=NOW(),"interactiveUntil"=${until} WHERE "id"=${id} AND "userId"=${userId} AND "state"='WAITING_USER' AND "handoffHash"=${hash} AND "handoffUsedAt" IS NULL AND "handoffExpires">NOW()`;
  if(!n)throw new BadRequestException('This action link expired or was already used. Open the task from your signed-in dashboard.');await this.restoreIfNeeded(userId,id);return {interactiveUntil:until};
 }
 private async restoreIfNeeded(userId:string,id:string){await this.db.$executeRaw`UPDATE "AgentRun" SET "state"='QUEUED',"reason"='Restore private browser for user action.',"leaseOwner"=NULL WHERE "id"=${id} AND "userId"=${userId} AND "state"='WAITING_USER' AND "submitReservedAt" IS NULL AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW())`;}
 async unlock(userId:string,id:string){const run=await this.owned(userId,id);if(run.state!=='WAITING_USER')throw new BadRequestException('This task is not waiting for user input.');const until=new Date(Date.now()+300000);await this.db.$executeRaw`UPDATE "AgentRun" SET "interactiveUntil"=${until} WHERE "id"=${id} AND "userId"=${userId}`;await this.restoreIfNeeded(userId,id);return {interactiveUntil:until};}
 async screen(userId:string,id:string){const r=await this.owned(userId,id);if(r.state!=='WAITING_USER'||!r.interactiveUntil||r.interactiveUntil<new Date())throw new BadRequestException('Unlock this task to view its private browser.');return {version:r.screenVersion,image:r.screen?unseal(r.screen).image:null,fields:r.fields,reason:r.reason,origin:new URL(r.url).origin,width:1280,height:900,interactiveUntil:r.interactiveUntil};}
 async control(userId:string,id:string,body:any){
  const r=await this.owned(userId,id);if(r.state!=='WAITING_USER'||!r.interactiveUntil||r.interactiveUntil<new Date()||!r.leaseUntil||r.leaseUntil<new Date())throw new BadRequestException('The interactive browser is unavailable or control expired.');
  if(!Number.isInteger(body?.version)||body.version!==r.screenVersion)throw new BadRequestException('The page changed. Refresh the browser image before acting.');
  if(!['CLICK','TYPE','UPLOAD','SCROLL','CONTINUE'].includes(body.kind))throw new BadRequestException('Unsupported user action.');
  if(body.kind==='CLICK'&&(!Number.isFinite(body.x)||!Number.isFinite(body.y)||body.x<0||body.x>1280||body.y<0||body.y>900))throw new BadRequestException('Invalid coordinates.');
  if(body.kind==='TYPE'&&(!Number.isInteger(body.element)||typeof body.value!=='string'||body.value.length>2000))throw new BadRequestException('Choose a field and enter a value.');
  if(body.kind==='UPLOAD'&&!Number.isInteger(body.element))throw new BadRequestException('Choose the resume field.');
  const payload={kind:body.kind,x:body.x,y:body.y,element:body.element,value:body.value,direction:body.direction==='up'?'up':'down'};
  const commandId=randomUUID(),expires=new Date(Date.now()+120000);
  await this.db.$executeRaw`INSERT INTO "AgentCommand"("id","runId","encrypted","screenVersion","expiresAt") VALUES (${commandId},${id},${seal(payload)},${r.screenVersion},${expires})`;
  return {queued:true};
 }
 async cancel(userId:string,id:string){const r=await this.owned(userId,id);if(['SUBMITTING','UNKNOWN','CONFIRMED'].includes(r.state))throw new BadRequestException('Submission may already have occurred. Verify its outcome before retrying.');await this.db.$executeRaw`UPDATE "AgentRun" SET "state"='CANCELLED',"screen"=NULL,"interactiveUntil"=NULL,"updatedAt"=NOW() WHERE "id"=${id} AND "userId"=${userId}`;return {cancelled:true};}
 async reserve(id:string,leaseOwner?:string){
  return this.db.$transaction(async tx=>{
   const rows:any[]=await tx.$queryRaw`SELECT * FROM "AgentRun" WHERE "id"=${id} FOR UPDATE`;const run=rows[0];if(!run||!['RUNNING','WAITING_USER'].includes(run.state)||run.submitReservedAt)throw Error('Submission is not retryable.');
   if(leaseOwner&&(run.leaseOwner!==leaseOwner||!run.leaseUntil||run.leaseUntil<new Date()))throw Error('The worker no longer owns this task.');
   if(!run.resumeUploaded)throw Error('The private resume upload must complete before submission.');
   await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${run.userId} FOR UPDATE`;
   const user=await tx.user.findUnique({where:{id:run.userId},include:{subscription:true}}),pref:any[]=await tx.$queryRaw`SELECT "enabled" FROM "AgentPreference" WHERE "userId"=${run.userId}`;
   if(!pref[0]?.enabled||!user.subscription?.active||user.subscription.trialEnds<=new Date())throw Error('Consent or plan is no longer active.');
   const application=await tx.jobApplication.findFirst({where:{id:run.applicationId,userId:run.userId}}),metadata:any=application?.matchReasons;
   if(!application||application.status==='APPLIED'||!metadata?.matchAssessed||application.matchScore<user.minMatchScore)throw Error('Application eligibility changed; review required.');
   const counterpart:any[]=await tx.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${run.userId} AND "applicationId"=${run.applicationId} AND "kind"='APPLY' AND "stage" IN ('CREATED','OPENED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN') LIMIT 1`;
   if(counterpart.length)throw Error('A companion task for this job must be resolved before hosted submission.');
   const from=new Date(new Date(Date.now()+19800000).toISOString().slice(0,10)+'T00:00:00+05:30');
   const sent=await tx.jobApplication.findMany({where:{userId:run.userId,status:'APPLIED',appliedAt:{gte:from}}});
   const count=sent.filter(a=>{const m:any=a.matchReasons;return m?.providerReceipt||m?.browserConfirmation||m?.agentConfirmation;}).length;
   const pending:any[]=await tx.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "userId"=${run.userId} AND "state" IN ('SUBMITTING','UNKNOWN') AND "submitReservedAt">=${from}`;
   const browser:any[]=await tx.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${run.userId} AND "kind"='APPLY' AND "stage" IN ('SUBMITTING','UNKNOWN') AND "updatedAt">=${from}`;
   if(count+pending.length+browser.length>=user.dailyApplyLimit)throw Error('Daily submission limit reached.');
   await tx.$executeRaw`UPDATE "AgentRun" SET "state"='SUBMITTING',"submitReservedAt"=NOW(),"screen"=NULL,"interactiveUntil"=NULL,"updatedAt"=NOW() WHERE "id"=${id}`;
  });
 }
 async confirm(id:string,text:string,url:string){
  if(!/(application (has been |was )?(submitted|received)|thank you for (applying|your application)|successfully applied)/i.test(text)||!approvedUrl(url))throw Error('Missing supported employer confirmation.');
  await this.db.$transaction(async tx=>{const rows:any[]=await tx.$queryRaw`SELECT * FROM "AgentRun" WHERE "id"=${id} FOR UPDATE`;const r=rows[0];if(!r||!['SUBMITTING','UNKNOWN'].includes(r.state))throw Error('No recorded submission attempt.');const a=await tx.jobApplication.findFirst({where:{id:r.applicationId,userId:r.userId}});const evidence={runId:id,observedAt:new Date().toISOString(),text:text.slice(0,400),url:new URL(url).origin+new URL(url).pathname,source:'HOSTED_BROWSER'};await tx.jobApplication.update({where:{id:a.id},data:{status:'APPLIED',applyMode:'AUTO_APPLY',appliedAt:new Date(),matchReasons:{...(a.matchReasons as any),agentConfirmation:evidence}}});await tx.$executeRaw`UPDATE "AgentRun" SET "state"='CONFIRMED',"confirmation"=${JSON.stringify(evidence)}::jsonb,"screen"=NULL,"interactiveUntil"=NULL,"reason"='Employer confirmation observed.',"updatedAt"=NOW() WHERE "id"=${id}`;});
 }
}
