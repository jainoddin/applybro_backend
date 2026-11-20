// Opt-in real PostgreSQL regression. All writes shadow public tables with a
// connection-private TEMP table and are rolled back. No live tasks are changed.
const {test}=require('node:test'),assert=require('node:assert/strict');
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {CompanionService}=require('../dist/jobs/companion.service');
test('microsecond read timeout recovers without overriding newer reports or any application',{skip:process.env.APPLYBRO_TEMP_DB_TEST!=='true'},async()=>{
 const db=new PrismaClient(),rollback=new Error('ROLLBACK_FIXTURE');
 try{await db.$transaction(async tx=>{
  await tx.$executeRaw`CREATE TEMP TABLE "BrowserRun" (LIKE public."BrowserRun" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`;
  const service=new CompanionService({user:{findUnique:async()=>({id:'fixture-owner',dailyApplyLimit:6})},$queryRaw:(...args)=>tx.$queryRaw(...args)});
  service.remaining=async()=>5;
  const device={id:'fixture-device',userId:'fixture-owner'};
  async function reset(kind='DISCOVER',stage='OPENED',needsInput=false){
   await tx.$executeRaw`DELETE FROM "BrowserRun"`;
   await tx.$executeRaw`INSERT INTO "BrowserRun" (id,"userId","deviceId",kind,portal,url,stage,details,"updatedAt") VALUES ('fixture-read','fixture-owner','fixture-device',${kind},'LinkedIn','https://www.linkedin.com/jobs/search/',${stage},${JSON.stringify({autoDiscover:true,needsInput})}::jsonb,date_trunc('second',NOW())-INTERVAL '6 minutes'+INTERVAL '0.216230 second')`;
  }
  for(const kind of ['DISCOVER','INSPECT']){
   await reset(kind);
   const [row]=await tx.$queryRaw`SELECT "updatedAt" FROM "BrowserRun"`;
   const [legacy]=await tx.$queryRaw`SELECT "updatedAt"=${row.updatedAt} AS matched FROM "BrowserRun"`;
   assert.equal(legacy.matched,false,'reproduce millisecond Date vs microsecond DB mismatch');
   assert.equal((await service.task(device,'fixture-read')).stage,'FAILED');
  }
  for(const [kind,stage,input] of [['APPLY','OPENED',false],['APPLY','SUBMITTING',false],['APPLY','UNKNOWN',false],['DISCOVER','REVIEW_REQUIRED',true]]){
   await reset(kind,stage,input);assert.equal((await service.task(device,'fixture-read')).stage,stage);
  }
  for(const race of ['progress','complete','question']){
   await reset();let first=true;
   const raced=new CompanionService({user:{findUnique:async()=>({id:'fixture-owner',dailyApplyLimit:6})},$queryRaw:async(...args)=>{
    const result=await tx.$queryRaw(...args);
    if(first&&args[0].join('?').startsWith('SELECT * FROM "BrowserRun"')){
     first=false;
     if(race==='progress')await tx.$executeRaw`UPDATE "BrowserRun" SET "updatedAt"=NOW()`;
     if(race==='complete')await tx.$executeRaw`UPDATE "BrowserRun" SET stage='DISCOVERED'`;
     if(race==='question')await tx.$executeRaw`UPDATE "BrowserRun" SET details=details||'{"needsInput":true}'::jsonb`;
    }
    return result;
   }});raced.remaining=async()=>5;
   const result=await raced.task(device,'fixture-read');assert.equal(result.stage,race==='complete'?'DISCOVERED':'OPENED');
   if(race==='question')assert.equal(result.details.needsInput,true);
  }
  for(const stage of ['OPENED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN']){
   await reset('APPLY',stage);await tx.$executeRaw`UPDATE "BrowserRun" SET details=details||'{"autoSubmit":true}'::jsonb`;
   const result=await service.task(device,'fixture-read');
   assert.equal(result.stage,['OPENED','REVIEW_REQUIRED'].includes(stage)?'REVIEW_REQUIRED':stage);
   assert.equal(result.details.needsInput,['OPENED','REVIEW_REQUIRED'].includes(stage));
  }
  await reset('APPLY','REVIEW_REQUIRED');await tx.$executeRaw`UPDATE "BrowserRun" SET details=details||'{"autoSubmit":true}'::jsonb`;
  let first=true;
  const submitting=new CompanionService({user:{findUnique:async()=>({id:'fixture-owner',dailyApplyLimit:6})},$queryRaw:async(...args)=>{
   const result=await tx.$queryRaw(...args);
   if(first&&args[0].join('?').startsWith('SELECT * FROM "BrowserRun"')){first=false;await tx.$executeRaw`UPDATE "BrowserRun" SET stage='SUBMITTING',"updatedAt"=NOW()`;}
   return result;
  }});submitting.remaining=async()=>5;
  assert.equal((await submitting.task(device,'fixture-read')).stage,'SUBMITTING','concurrent reservation cannot be parked as a preparation error');
  console.log('TEMP DB WATCHDOG: reproduced microsecond mismatch; DISCOVER/INSPECT recover; APPLY/UNKNOWN/questions and concurrent updates preserved; rollback enforced.');
  throw rollback;
 },{timeout:30000});}catch(error){if(error!==rollback)throw error;}finally{await db.$disconnect();}
});
