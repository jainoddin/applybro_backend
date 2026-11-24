const {test}=require('node:test'),assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');
function fixture(){
 const user={id:'owner',activeMode:'AUTO_APPLY',autoApplyConsent:true,minMatchScore:50,skills:'React TypeScript NodeJS',subscription:{active:true,trialEnds:new Date(Date.now()+86400000)},preferences:{titles:['Full Stack Developer']}};
 const writes=[];
 const service=new CompanionService({user:{findUnique:async()=>user},jobApplication:{findFirst:async()=>null,upsert:async()=>{}},$executeRaw:async(s,...v)=>{writes.push(v);return 1;}});
 service.task=async()=>({kind:'INSPECT',stage:'OPENED',autoDiscover:true,url:'https://www.linkedin.com/jobs/view/123/'});
 service.create=async()=>{throw Error('Test must not queue an ineligible role');};
 return {service,writes};
}
test('a high keyword score cannot hide a role mismatch behind a threshold message',async()=>{
 const {service}=fixture();
 const result=await service.observeJob({userId:'owner'},{url:'https://www.linkedin.com/jobs/view/123/',title:'Security Engineer',description:'React TypeScript NodeJS '.repeat(12)},'inspection');
 assert.equal(result.prepared,false);assert.match(result.reason,/does not match your selected roles: Security Engineer/);assert.doesNotMatch(result.reason,/keyword coverage/);
});
test('a matching role with insufficient description evidence explains that specific gate',async()=>{
 const {service}=fixture();
 const result=await service.observeJob({userId:'owner'},{url:'https://www.linkedin.com/jobs/view/123/',title:'Full Stack Developer',description:'React development and working with the team. '.repeat(8)},'inspection');
 assert.equal(result.prepared,false);assert.match(result.reason,/fewer than three recognized technologies/);
});
