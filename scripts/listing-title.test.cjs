const {test}=require('node:test'),assert=require('node:assert/strict');
const {validListingTitle}=require('../dist/jobs/listing-title');
const {CompanionService}=require('../dist/jobs/companion.service');
const {JobsService}=require('../dist/jobs/jobs.service');
test('action text is not a job title but legitimate titles remain valid',()=>{
 for(const title of ['Share negative feedback','Send feedback','Report this job','Apply now','Easy Apply','Show more','More','More options','0 notifications','3 new notifications total'])assert.equal(validListingTitle(title),false,title);
 for(const title of ['Full-Stack Engineer','Feedback Engineer','Software Engineer - Apply Platform'])assert.equal(validListingTitle(title),true,title);
});
test('feedback-only discovery performs no listing writes and does not claim an import',async()=>{
 let writes=0;const s=new CompanionService({user:{findUnique:async()=>({preferences:{titles:[]}})},$transaction:async()=>{writes++;}});
 s.task=async()=>({kind:'DISCOVER',stage:'OPENED',url:'https://www.linkedin.com/jobs/search/',portal:'LinkedIn',autoDiscover:true});
 await assert.rejects(()=>s.importJobs({userId:'fixture-owner'},'fixture-read',{jobs:[{url:'https://www.linkedin.com/jobs/view/123/',title:'Share negative feedback'}]}),/No supported job titles/);assert.equal(writes,0);
});
test('already imported action labels are excluded from job matches without deleting history',async()=>{
 const rows=['Share negative feedback','Full-Stack Engineer'].map((jobTitle,i)=>({id:String(i),jobTitle,companyName:'Fixture',matchScore:0,status:'WAITING_FOR_APPROVAL',matchReasons:{version:'browser-listing-v1',url:'https://www.linkedin.com/jobs/view/'+(i+123)+'/',source:'LinkedIn',location:'Remote'}}));
 const s=new JobsService({jobApplication:{findMany:async()=>rows},user:{findUnique:async()=>({preferences:{titles:[]},dailyApplyLimit:6})},$queryRaw:async()=>[]},{},{});
 const result=await s.getMatchedJobs('fixture-owner');assert.deepEqual(result.jobs.map(j=>j.title),['Full-Stack Engineer']);assert.equal(result.stats.applied,0);
});
