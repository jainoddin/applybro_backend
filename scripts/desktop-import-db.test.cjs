// Opt-in PostgreSQL integration. All writes use connection-private TEMP tables
// inside a rolled-back transaction. No user rows or employer sites are changed.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {CompanionService}=require('../dist/jobs/companion.service');
test('30-job import is atomic, deduplicated, bounded and preserves submission evidence',{skip:process.env.APPLYBRO_TEMP_DB_TEST!=='true'},async()=>{
 const db=new PrismaClient(),rollback=new Error('ROLLBACK_FIXTURE');
 try{
  await db.$transaction(async tx=>{
   await tx.$executeRaw`CREATE TEMP TABLE "JobApplication" (LIKE public."JobApplication" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`;
   await tx.$executeRaw`CREATE TEMP TABLE "BrowserRun" (LIKE public."BrowserRun" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`;
   await tx.$executeRaw`CREATE TEMP TABLE "User" (id text PRIMARY KEY,"activeMode" text,"autoApplyConsent" boolean) ON COMMIT DROP`;
   await tx.$executeRaw`CREATE TEMP TABLE "BrowserDevice" (id text,"userId" text,"revokedAt" timestamptz,"expiresAt" timestamptz) ON COMMIT DROP`;
   await tx.$executeRaw`CREATE TEMP TABLE "Subscription" ("userId" text,active boolean,"trialEnds" timestamptz) ON COMMIT DROP`;
   await tx.$executeRaw`CREATE TEMP TABLE "AgentRun" ("userId" text,"applicationId" text,state text) ON COMMIT DROP`;
   await tx.$executeRaw`INSERT INTO "User" VALUES ('fixture-owner','AUTO_APPLY',true)`;
   await tx.$executeRaw`INSERT INTO "BrowserDevice" VALUES ('fixture-device','fixture-owner',NULL,NOW()+INTERVAL '1 day')`;
   await tx.$executeRaw`INSERT INTO "Subscription" VALUES ('fixture-owner',true,NOW()+INTERVAL '1 day')`;
   await tx.$executeRaw`INSERT INTO "BrowserRun" (id,"userId","deviceId",kind,portal,url,stage) VALUES ('fixture-search','fixture-owner','fixture-device','DISCOVER','Naukri.com','https://www.naukri.com/full-stack-developer-jobs','OPENED')`;
   const jobs=Array.from({length:30},(_,i)=>({title:'Full Stack Developer '+i,url:'https://www.naukri.com/job-listings-fixture-'+i,company:'Fixture Employer'}));
   const jobId=i=>createHash('sha256').update('fixture-owner:'+jobs[i].url).digest('hex');
   await tx.$executeRaw`INSERT INTO "JobApplication" (id,"userId","jobTitle","companyName",portal,"matchScore","matchReasons","applyMode",status,"updatedAt") VALUES (${jobId(0)},'fixture-owner','Old title','Fixture Employer','NAUKRI',88,'{"confirmation":"fixture evidence"}','ASSISTED_APPLY','APPLIED',NOW())`;
   await tx.$executeRaw`INSERT INTO "BrowserRun" (id,"userId","deviceId",kind,portal,url,"applicationId",stage) VALUES ('uncertain','fixture-owner','fixture-device','APPLY','Naukri.com',${jobs[1].url},${jobId(1)},'UNKNOWN')`;
   await tx.$executeRaw`INSERT INTO "AgentRun" VALUES ('fixture-owner',${jobId(2)},'QUEUED')`;
   let statements=0;
   const adapter={user:{findUnique:async()=>({dailyApplyLimit:6,preferences:{titles:['Full Stack Developer']}})},$transaction:async fn=>fn({$queryRaw:async(...args)=>{statements++;return tx.$queryRaw(...args);},$executeRaw:async(...args)=>{statements++;return tx.$executeRaw(...args);}})};
   const service=new CompanionService(adapter);
   service.task=async()=>({kind:'DISCOVER',stage:'OPENED',portal:'Naukri.com',url:'https://www.naukri.com/full-stack-developer-jobs',autoDiscover:true});
   const device={id:'fixture-device',userId:'fixture-owner'};
   await assert.rejects(()=>service.importJobs(device,'fixture-search',{jobs:[jobs[0],{title:'Invalid portal',url:'https://example.invalid/steal'}]}),/Invalid portal listing/);
   assert.equal(statements,0,'validate the entire payload before writing any listing');
   // A repeated card must not make ON CONFLICT update the same row twice.
   const result=await service.importJobs(device,'fixture-search',{jobs:[...jobs.slice(0,29),jobs[0]]});
   assert.equal(result.imported,29);assert.equal(result.inspectRuns.length,12);assert.equal(statements,4);
   const [preserved]=await tx.$queryRaw`SELECT status,"matchScore","matchReasons" FROM "JobApplication" WHERE id=${jobId(0)}`;
   assert.equal(preserved.status,'APPLIED');assert.equal(preserved.matchScore,88);assert.equal(preserved.matchReasons.confirmation,'fixture evidence');
   const [search]=await tx.$queryRaw`SELECT stage FROM "BrowserRun" WHERE id='fixture-search'`;
   assert.equal(search.stage,'DISCOVERED');
   await assert.rejects(()=>service.importJobs(device,'fixture-search',{jobs}),/finished or was cancelled/);
   await tx.$executeRaw`UPDATE "BrowserRun" SET stage='OPENED' WHERE id='fixture-search'`;
   await tx.$executeRaw`UPDATE "User" SET "autoApplyConsent"=false WHERE id='fixture-owner'`;
   const stopped=await service.importJobs(device,'fixture-search',{jobs:[jobs[29]]});
   assert.equal(stopped.inspectRuns.length,0,'withdrawn consent cannot start more inspection tasks');
   console.log('TEMP DB IMPORT: 29 unique cards; 12 inspections; 4 transaction queries; existing applied/unknown/hosted jobs not requeued; rollback enforced.');
   throw rollback;
  },{timeout:30000});
 }catch(error){if(error!==rollback)throw error;}
 finally{await db.$disconnect();}
});
