const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');
function fixture(kind,stage='REVIEW_REQUIRED',needsInput=false,raced=false){
 const row={id:'read-task',kind,stage,updatedAt:new Date(Date.now()-360000),createdAt:new Date(),details:{autoDiscover:true,needsInput}};
 let timeouts=0,reads=0;
 const db={user:{findUnique:async()=>({id:'owner',dailyApplyLimit:6,activeMode:'AUTO_APPLY',autoApplyConsent:true,subscription:{active:true,trialEnds:new Date(Date.now()+86400000)}})},jobApplication:{findMany:async()=>[]},$executeRaw:async()=>0,$queryRaw:async(strings)=>{
  const sql=strings.join('?');
  if(sql.startsWith('SELECT * FROM "BrowserRun"')){reads++;return [{...row,details:{...row.details},...(raced&&reads>1?{stage:'DISCOVERED'}:{})}];}
  if(sql.startsWith('UPDATE "BrowserRun"')){timeouts++;return raced?[]:[{...row,stage:'FAILED',details:{...row.details,message:'Portal read timed out'}}];}
  return [];
 }};
 return {run:()=>new CompanionService(db).task({id:'device',userId:'owner'},row.id),timeouts:()=>timeouts};
}
test('stalled automatic read expires so the existing companion can continue its queue',async()=>{for(const kind of ['DISCOVER','INSPECT']){const f=fixture(kind);assert.equal((await f.run()).stage,'FAILED');assert.equal(f.timeouts(),1);}});
test('pending employer answers and every APPLY stage remain untouched by read timeout',async()=>{for(const stage of ['CREATED','OPENED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN','BROWSER_CONFIRMED']){const f=fixture('APPLY',stage);assert.equal((await f.run()).stage,stage);assert.equal(f.timeouts(),0);}const f=fixture('DISCOVER','REVIEW_REQUIRED',true);assert.equal((await f.run()).stage,'REVIEW_REQUIRED');assert.equal(f.timeouts(),0);});
test('concurrent discovery completion wins over an older timeout observation',async()=>{const f=fixture('DISCOVER','REVIEW_REQUIRED',false,true);assert.equal((await f.run()).stage,'DISCOVERED');});
