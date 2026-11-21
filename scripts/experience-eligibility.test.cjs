const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');
function fixture(experience,minimumYears){
 const inserted=[];
 const user={id:'owner',experience,activeMode:'AUTO_APPLY',autoApplyConsent:true,dailyApplyLimit:5,minMatchScore:70};
 const db={user:{findUnique:async()=>user},subscription:{findUnique:async()=>({active:true,trialEnds:new Date(Date.now()+86400000)})},jobApplication:{findFirst:async()=>({id:'app',jobTitle:'Full Stack Developer',status:'WAITING_FOR_APPROVAL',matchScore:85,matchReasons:{version:'browser-listing-v1',url:'https://www.naukri.com/job-listings-fixture-123',source:'Naukri.com',matchAssessed:true,minimumYears}}),findMany:async()=>[]},$queryRaw:async(strings)=>{const sql=strings.join('?');return sql.includes('FROM "BrowserDevice"')?[{id:'device'}]:sql.includes('FROM "Resume"')?[{id:'resume'}]:[];},$executeRaw:async(strings,...values)=>{if(strings.join('?').includes('INSERT INTO "BrowserRun"'))inserted.push(JSON.parse(values.at(-1)));return 1;}};
 return {create:()=>new CompanionService(db).create('owner',{kind:'APPLY',applicationId:'app',autoSubmit:true}),inserted};
}
test('2 years 0 months satisfies a 2-year requirement rather than becoming a zero-year range',async()=>{process.env.COMPANION_AUTO_APPLY_ENABLED='true';const f=fixture('2 years 0 months',2);await f.create();assert.equal(f.inserted[0].reviewReason,'');});
test('months add to years and do not become the maximum of a range',async()=>{const f=fixture('2 years 6 months',2.5);await f.create();assert.equal(f.inserted[0].reviewReason,'');});
test('exact experience below an employer minimum is rejected',async()=>{const f=fixture('2 years 0 months',3);await assert.rejects(f.create,/does not meet/);assert.equal(f.inserted.length,0);});
test('a real experience range crossing the minimum still needs review',async()=>{const f=fixture('1–3 years',2);await f.create();assert.match(f.inserted[0].reviewReason,/Confirm/);});
test('missing experience is never assumed eligible',async()=>{const f=fixture('',2);await f.create();assert.match(f.inserted[0].reviewReason,/experience/i);});
test('open-ended experience cannot prove an unconfirmed higher minimum',async()=>{const f=fixture('2+ years',5);await f.create();assert.match(f.inserted[0].reviewReason,/Confirm/);});
