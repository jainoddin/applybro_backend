require('dotenv').config();
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const {NestFactory}=require('@nestjs/core');const {AppModule}=require('../dist/app.module');
const {PrismaService}=require('../dist/prisma/prisma.service');const {CloudAgentService}=require('../dist/agent/agent.service');
const {approvedUrl,agentKey,seal,unseal,factsFor,terminalStates}=require('../dist/agent/agent-policy');
const {observe,execute,plan,allowNetwork,submitLike,element,targetAt}=require('./cloud-browser.cjs');
const {claim,heartbeat,recover}=require('./cloud-queue.cjs');
const {reviewWindow,waitForReview}=require('./agent-pacing.cjs');
const {profileUrl,profileState,syncResume,isNaukriJob}=require('./naukri-flow.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const owner=randomUUID();let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function main(){
 if(process.env.CLOUD_AGENT_ENABLED!=='true'){console.log('Hosted agent disabled. Configure it before starting the worker.');return;}
 agentKey();
 const app=await NestFactory.createApplicationContext(AppModule,{logger:['error','warn']});const db=app.get(PrismaService),service=app.get(CloudAgentService);
 const browser=process.env.CLOUD_AGENT_BROWSER_WS?await chromium.connect(process.env.CLOUD_AGENT_BROWSER_WS):await chromium.launch({headless:true,...(process.env.CLOUD_AGENT_CHROME_PATH?{executablePath:process.env.CLOUD_AGENT_CHROME_PATH}:{})});
 const get=async id=>(await db.$queryRaw`SELECT * FROM "AgentRun" WHERE "id"=${id}`)[0];
 const event=async(id,kind,message)=>{const eid=randomUUID();await db.$executeRaw`INSERT INTO "AgentEvent"("id","runId","kind","message") VALUES (${eid},${id},${kind},${String(message).slice(0,600)})`;};
 const update=async(id,state,reason)=>{await db.$executeRaw`UPDATE "AgentRun" SET "state"=${state},"reason"=${String(reason).slice(0,600)},"updatedAt"=NOW() WHERE "id"=${id} AND "leaseOwner"=${owner} AND "state" NOT IN ('CANCELLED','CONFIRMED')`;};
 async function run(initial){
  let context,page,observation,history=[],blocked='',lastShot=0;const privateFields=[];
  const reviewDuration=reviewWindow();let reviewUntil=0;
  const privateImage=()=>page.screenshot({type:'png',mask:[...page.frames().map(frame=>frame.locator('input[type="password"],input[autocomplete="one-time-code"],input[name*="otp" i]')),...privateFields.filter(f=>page.frames()[f.frame]).map(f=>element(page,f.id,f.frame))]});
  const user=await db.user.findUnique({where:{id:initial.userId}}),facts=factsFor(user);
  const expectedJob=await db.jobApplication.findFirst({where:{id:initial.applicationId,userId:initial.userId}});
  const resumes=await db.$queryRaw`SELECT "fileName","fileBytes","mimeType" FROM "Resume" WHERE "userId"=${initial.userId} AND "id"=${initial.resumeId}`;
  const resume=resumes[0];
  const timer=setInterval(()=>heartbeat(db,initial.id,initial.userId,owner).catch(()=>{}),10000);
  const saveSession=async()=>{if(!context||(await get(initial.id))?.leaseOwner!==owner)return;const encrypted=seal(await context.storageState());await db.$executeRaw`INSERT INTO "AgentSession"("userId","encrypted") VALUES (${initial.userId},${encrypted}) ON CONFLICT ("userId") DO UPDATE SET "encrypted"=EXCLUDED."encrypted","updatedAt"=NOW()`;};
  const uploadSaved=async()=>{await db.$executeRaw`UPDATE "AgentRun" SET "resumeUploaded"=TRUE WHERE "id"=${initial.id}`;};
  const screen=async()=>{
   observation=await observe(page);const image=await privateImage().catch(()=>null);
   if(image)await db.$executeRaw`UPDATE "AgentRun" SET "screen"=${seal({image:image.toString('base64')})},"url"=${new URL(page.url()).origin+new URL(page.url()).pathname},"fields"=${JSON.stringify(observation.fields.filter(x=>['INPUT','TEXTAREA','SELECT'].includes(x.tag)).map(x=>({id:x.id,label:x.label,type:x.type})))}::jsonb,"screenVersion"="screenVersion"+1,"updatedAt"=NOW() WHERE "id"=${initial.id}`;
  };
  async function waitForUser(reason,preserveGrant=false){
   await saveSession();if(preserveGrant)await update(initial.id,'WAITING_USER',reason);else await service.pause(initial,reason);await screen();let since=Date.now();
   while(!stopping){
    const r=await get(initial.id);if(!r||terminalStates.has(r.state)||r.leaseOwner!==owner)return false;
    if(r.state==='SUBMITTING'||r.state==='UNKNOWN')return true;
    const commands=await db.$queryRaw`DELETE FROM "AgentCommand" WHERE "id" IN (SELECT "id" FROM "AgentCommand" WHERE "runId"=${initial.id} ORDER BY "createdAt" LIMIT 1) RETURNING *`;
    if(commands[0]){
     const command=commands[0];if(command.expiresAt<new Date()||command.screenVersion!==r.screenVersion){await event(r.id,'CONTROL_EXPIRED','The page changed; user action was discarded.');}
     else{
      try{
      const c=unseal(command.encrypted);observation=await observe(page);
      if(c.kind==='CONTINUE'){await db.$executeRaw`UPDATE "AgentRun" SET "steps"=0 WHERE "id"=${r.id}`;history=[];await update(r.id,'RUNNING','User requested continuation.');return true;}
      if(c.kind==='TYPE'){const field=observation.fields.find(x=>x.id===c.element);if(!field||!['INPUT','TEXTAREA'].includes(field.tag)||field.type==='file')throw Error('Choose an editable field.');await element(page,c.element,field.frame).fill(c.value);privateFields.push({id:c.element,frame:field.frame});}
      if(c.kind==='UPLOAD')await execute(page,observation,{kind:'UPLOAD',element:c.element},{facts,resume,reserve:()=>service.reserve(r.id,owner),onUpload:uploadSaved});
      if(c.kind==='SCROLL')await page.mouse.wheel(0,c.direction==='up'?-600:600);
      if(c.kind==='CLICK'){
       const target=await targetAt(page,c.x,c.y);
       if(target?.tag==='A'&&!approvedUrl(target.href))throw Error('This destination is not enabled for the hosted browser.');
       if(target&&target.tag!=='A'&&submitLike(target)&&!(target.verification&&!/apply|application/i.test(target.label))){if(!r.resumeUploaded)throw Error('Attach the stored resume before submission.');await service.reserve(r.id,owner);}
       await page.mouse.click(c.x,c.y);
      }
      since=Date.now();await sleep(500);await screen();
      }catch{await event(r.id,'CONTROL_ERROR','User action could not be completed. Refresh the private browser and retry.');}
     }
    }else{if(Date.now()-lastShot>2500){await screen();lastShot=Date.now();}await sleep(500);}
    if(Date.now()-since>300000){await saveSession();await event(r.id,'WAITING','No user action within five minutes; browser saved and closed. Reopen the task to reconnect.');return false;}
   }
   return false;
  }
  try{
   if(!resume?.fileBytes)throw Error('The task private resume is unavailable.');
   const sessions=await db.$queryRaw`SELECT "encrypted" FROM "AgentSession" WHERE "userId"=${initial.userId}`;
   context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:false,serviceWorkers:'block',...(sessions[0]?{storageState:unseal(sessions[0].encrypted)}:{})});
   context.on('page',popup=>{page=popup;});page=await context.newPage();
   await context.route('**/*',async route=>{
    const request=route.request();if(!await allowNetwork(request.url()))return route.abort();
    if(request.isNavigationRequest()&&request.frame().parentFrame()===null&&!approvedUrl(request.url())){try{blocked='External site requires approval: '+new URL(request.url()).hostname;}catch{blocked='Unsupported navigation.';}return route.abort();}
    return route.continue();
   });
   if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
   const jobUrl=expectedJob.matchReasons?.url||initial.url;
   if(isNaukriJob(jobUrl)){
    await page.goto(profileUrl,{waitUntil:'domcontentloaded',timeout:30000});
    while(!(await profileState(page)).signedIn){
     if(!await waitForUser('Sign in to Naukri in this private cloud browser, complete OTP/CAPTCHA, then Continue. Your local Naukri login is separate.'))return;
     await page.goto(profileUrl,{waitUntil:'domcontentloaded',timeout:30000});
    }
    // Native Apply uses Naukri's portal resume. Upload our actual stored file
    // first, and require a new success receipt before allowing any submission.
    let synced=false;
    for(let attempt=0;attempt<2&&!synced;attempt++){
     try{await syncResume(page,resume);await uploadSaved();await saveSession();await event(initial.id,'RESUME','Stored ApplyBro resume uploaded to the private Naukri profile; fresh portal upload receipt observed.');synced=true;}
     catch(e){if(!await waitForUser(e.message))return;await page.goto(profileUrl,{waitUntil:'domcontentloaded',timeout:30000});}
    }
    if(!synced){await update(initial.id,'FAILED','Naukri resume synchronization was not confirmed. No submission attempted.');return;}
   }
   await page.goto(jobUrl,{waitUntil:'domcontentloaded',timeout:30000});
   reviewUntil=Date.now()+reviewDuration;
   await event(initial.id,'REVIEW','Review window selected: '+reviewDuration/1000+' seconds. Form completion and verification may take longer.');
   if(initial.reason==='Restore private browser for user action.'){
    if(!await waitForUser('Browser restored. Verify the portal session and complete the pending question.',true))return;
   }
   while(!stopping){
    let r=await get(initial.id);if(!r||terminalStates.has(r.state)||r.leaseOwner!==owner)break;
    const pref=await db.$queryRaw`SELECT "enabled" FROM "AgentPreference" WHERE "userId"=${initial.userId}`;
    if(!pref[0]?.enabled&&r.state!=='SUBMITTING'){await update(r.id,'CANCELLED','User disabled hosted automation.');break;}
    if(r.state==='SUBMITTING'||r.state==='UNKNOWN'){
     const until=Date.now()+30000;let evidence='';while(Date.now()<until&&!stopping){observation=await observe(page);if(observation.confirmation){evidence=observation.confirmation;break;}await sleep(1000);}
     if(evidence)await service.confirm(r.id,evidence,page.url());else await update(r.id,'UNKNOWN','Submission outcome not confirmed. Do not retry automatically. Check the employer response.');break;
    }
    if(r.steps>=40){if(!await waitForUser('Agent reached its action budget. Review the current page before continuing.'))break;continue;}
    if(blocked){const reason=blocked;blocked='';if(!await waitForUser(reason))break;continue;}
    observation=await observe(page);
    if(observation.challenge){if(!await waitForUser('Portal login, OTP or CAPTCHA requires your action.'))break;continue;}
    const image=await privateImage();
    const action=await plan(observation,image,facts,history,{title:expectedJob.jobTitle,company:expectedJob.companyName,url:initial.url});
    if((await get(initial.id))?.leaseOwner!==owner)break;
    history.push({kind:action.kind,element:action.element,reason:String(action.reason||'').slice(0,200)});
    if(action.kind==='ASK_USER'){if(!await waitForUser(String(action.reason||'An employer question requires a verified answer.')))break;continue;}
    if(action.kind==='SKIP'){await update(r.id,'SKIPPED',String(action.reason||'Job not suitable.'));break;}
    if(action.kind==='SUBMIT'&&Date.now()<reviewUntil){
     await update(r.id,'RUNNING','Reviewing application before submission.');
     await event(r.id,'REVIEW','Form prepared; waiting for the review window before a fresh page check.');
     const ready=await waitForReview(reviewUntil,{sleep,active:async()=>{
      const current=await get(r.id);if(stopping||current?.state!=='RUNNING'||current?.leaseOwner!==owner)return false;
      const prefs=await db.$queryRaw`SELECT "enabled" FROM "AgentPreference" WHERE "userId"=${initial.userId}`;
      return prefs[0]?.enabled===true;
     }});
     if(!ready)break;
     // Re-observe and re-plan after waiting; never click a stale submit target.
     continue;
    }
    if(history.length>=4&&history.slice(-4).every(x=>x.kind===action.kind&&x.element===action.element)){await waitForUser('The agent repeated an action without progress. Review this page.');break;}
    try{await execute(page,observation,action,{facts,resume,resumeUploaded:r.resumeUploaded,reserve:()=>service.reserve(r.id,owner),onUpload:uploadSaved,expectedTitle:expectedJob.jobTitle});}
    catch(e){const fresh=await get(r.id);if(/Daily submission limit reached/.test(e.message)){const day=new Date(Date.now()+19800000+86400000).toISOString().slice(0,10),next=new Date(day+'T00:00:00+05:30');await db.$executeRaw`UPDATE "AgentRun" SET "state"='QUEUED',"nextAttemptAt"=${next},"reason"='Daily limit reached; resumes on the next India-calendar day.' WHERE "id"=${r.id} AND "leaseOwner"=${owner}`;break;}if(fresh.state==='SUBMITTING'){await update(r.id,'UNKNOWN','Submission control was activated but its outcome is uncertain. Do not retry.');break;}if(!await waitForUser(e.message))break;continue;}
    await db.$executeRaw`UPDATE "AgentRun" SET "steps"="steps"+1,"url"=${new URL(page.url()).origin+new URL(page.url()).pathname},"updatedAt"=NOW() WHERE "id"=${r.id}`;
    await event(r.id,'ACTION',action.kind+' completed.');await saveSession();await sleep(1200);
   }
  }catch(e){const r=await get(initial.id);if(e.retryable&&r?.state==='RUNNING'&&!r.submitReservedAt&&r.retryCount<3){const next=new Date(Date.now()+60000*2**r.retryCount);await db.$executeRaw`UPDATE "AgentRun" SET "state"='QUEUED',"retryCount"="retryCount"+1,"nextAttemptAt"=${next},"reason"='Model temporarily unavailable; bounded retry scheduled before submission.' WHERE "id"=${initial.id} AND "leaseOwner"=${owner}`;}else await update(initial.id,r?.state==='SUBMITTING'?'UNKNOWN':'FAILED','Browser or model service unavailable. No automatic retry after a possible submission.');}
  finally{clearInterval(timer);await saveSession().catch(()=>{});await context?.close().catch(()=>{});await db.$executeRaw`UPDATE "AgentRun" SET "state"=CASE WHEN "state"='RUNNING' AND "submitReservedAt" IS NULL THEN 'QUEUED' WHEN "state"='SUBMITTING' THEN 'UNKNOWN' ELSE "state" END,"leaseOwner"=NULL,"leaseUntil"=NULL,"screen"=NULL,"interactiveUntil"=NULL WHERE "id"=${initial.id} AND "leaseOwner"=${owner}`;await db.$executeRaw`DELETE FROM "AgentUserLease" WHERE "userId"=${initial.userId} AND "runId"=${initial.id} AND "owner"=${owner}`;}
 }
 async function notices(){
  await db.$executeRaw`UPDATE "AgentNotice" SET "state"='EXPIRED',"encrypted"='' WHERE "state"='PENDING' AND "expiresAt"<NOW()`;
  if(!process.env.RESEND_API_KEY||!process.env.CLOUD_AGENT_EMAIL_FROM)return;
  const rows=await db.$queryRaw`SELECT n.* FROM "AgentNotice" n JOIN "AgentRun" r ON r."id"=n."runId" WHERE n."state"='PENDING' AND n."attempts"<3 AND n."expiresAt">NOW() AND r."state"='WAITING_USER' ORDER BY n."createdAt" LIMIT 3`;
  for(const notice of rows){try{const data=unseal(notice.encrypted);const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':notice.id},signal:AbortSignal.timeout(10000),body:JSON.stringify({from:process.env.CLOUD_AGENT_EMAIL_FROM,to:[data.to],subject:'ApplyBro: your application needs verification',text:`Your application needs a portal login, verification, or an employer answer. Open ApplyBro to review the request.\n\nContinue securely (link valid for five minutes):\n${data.link}\n\nSign in to ApplyBro before entering verification details. Never reply with passwords or OTPs.`})});if(response.ok)await db.$executeRaw`UPDATE "AgentNotice" SET "state"='SENT',"sentAt"=NOW(),"encrypted"='' WHERE "id"=${notice.id}`;else await db.$executeRaw`UPDATE "AgentNotice" SET "attempts"="attempts"+1 WHERE "id"=${notice.id}`;}catch{await db.$executeRaw`UPDATE "AgentNotice" SET "attempts"="attempts"+1 WHERE "id"=${notice.id}`;}}
 }
 const active=new Set();let tick=0,modelReady=false,modelProbes=0,nextProbeAt=0;
 async function probeModel(){let context;try{context=await browser.newContext();const page=await context.newPage();await page.setContent('<main><h1>Synthetic fixture</h1><label>Email<input name=email type=email></label></main>');await plan(await observe(page),await page.screenshot(),{email:'fixture@example.invalid'},[],{title:'Synthetic fixture',company:'No employer'});modelReady=true;}catch{console.log('Vision startup check unavailable; no employer tasks will run.');}finally{await context?.close();}}
 try{while(!stopping){
  if(!modelReady&&modelProbes<3&&Date.now()>=nextProbeAt){modelProbes++;await probeModel();nextProbeAt=Date.now()+60000*modelProbes;}
  await db.$executeRaw`INSERT INTO "AgentHeartbeat"("id","modelReady") VALUES (${owner},${modelReady}) ON CONFLICT ("id") DO UPDATE SET "modelReady"=EXCLUDED."modelReady","updatedAt"=NOW()`;
  await recover(db);
  await db.$executeRaw`DELETE FROM "AgentCommand" WHERE "expiresAt"<NOW()`;
  await db.$executeRaw`UPDATE "AgentNotice" SET "state"='EXPIRED',"encrypted"='' WHERE "state"='PENDING' AND "expiresAt"<NOW()`;
  if(!modelReady){await sleep(1000);continue;}
  if(tick++%15===0){await notices();const prefs=await db.$queryRaw`UPDATE "AgentPreference" SET "nextRunAt"=NOW()+INTERVAL '6 hours' WHERE "enabled"=TRUE AND "nextRunAt"<=NOW() RETURNING "userId"`;for(const pref of prefs)try{await service.queueMatches(pref.userId);}catch{}}
  while(active.size<Math.min(4,Math.max(1,Number(process.env.CLOUD_AGENT_CONCURRENCY)||1))){
   const rows=await claim(db,owner);
   if(!rows[0])break;const promise=run(rows[0]).catch(()=>{});active.add(promise);promise.finally(()=>active.delete(promise));
  }
  await sleep(1000);
 }}finally{await Promise.allSettled([...active]);await browser.close();await app.close();}
}
main().catch(e=>{console.error('Hosted worker could not start:',e.code||e.name);process.exitCode=1;});
