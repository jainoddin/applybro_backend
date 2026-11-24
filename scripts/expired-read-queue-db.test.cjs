// All fixture writes shadow the live relation with a private TEMP table and roll back.
const {test}=require('node:test'),assert=require('node:assert/strict');
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {CompanionService}=require('../dist/jobs/companion.service');
test('expired-read cleanup frees abandoned reads and preserves applications, questions and other devices',{skip:process.env.APPLYBRO_TEMP_DB_TEST!=='true'},async()=>{
 const db=new PrismaClient(),rollback=new Error('ROLLBACK_FIXTURE');
 try{await db.$transaction(async tx=>{
  await tx.$executeRaw`CREATE TEMP TABLE "BrowserRun" (LIKE public."BrowserRun" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`;
  for(const [id,kind,stage,input,age,device] of [['old','INSPECT','CREATED',false,48,'fixture-device'],['fresh','INSPECT','CREATED',false,1,'fixture-device'],['question','DISCOVER','REVIEW_REQUIRED',true,48,'fixture-device'],['uncertain','APPLY','UNKNOWN',false,48,'fixture-device'],['submitting','APPLY','SUBMITTING',false,48,'fixture-device'],['other','INSPECT','CREATED',false,48,'other-device']]){
   await tx.$executeRaw`INSERT INTO "BrowserRun" (id,"userId","deviceId",kind,portal,url,stage,details,"createdAt") VALUES (${id},'fixture-owner',${device},${kind},'LinkedIn','https://www.linkedin.com/jobs/view/123/',${stage},${JSON.stringify({autoDiscover:true,needsInput:input})}::jsonb,NOW()-(${age}*INTERVAL '1 hour'))`;
  }
  const service=new CompanionService(tx);await service.expireReadTasks({id:'fixture-device',userId:'fixture-owner'});
  const rows=await tx.$queryRaw`SELECT id,stage FROM "BrowserRun" ORDER BY id`;
  assert.deepEqual(Object.fromEntries(rows.map(r=>[r.id,r.stage])),{fresh:'CREATED',old:'FAILED',other:'CREATED',question:'REVIEW_REQUIRED',submitting:'SUBMITTING',uncertain:'UNKNOWN'});
  const task=await service.task({id:'fixture-device',userId:'fixture-owner'},'old');assert.equal(task.stage,'FAILED');assert.equal(task.resume,null);
  console.log('TEMP DB: only abandoned read expired; pending answers, fresh reads, other devices and submission outcomes preserved; rollback enforced.');
  throw rollback;
 },{timeout:20000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}
});
