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

test('global notification headings use the previously observed title for the exact same job URL',async()=>{
 const {service}=fixture();let queued=false;
 service.prisma.jobApplication.findFirst=async()=>({id:'posting',jobTitle:'Full Stack Engineer',status:'WAITING_FOR_APPROVAL',matchReasons:{version:'browser-listing-v1',url:'https://www.linkedin.com/jobs/view/123/'}});
 service.create=async(_user,data)=>{queued=true;assert.equal(data.autoSubmit,true);return {id:'application'};};
 const result=await service.observeJob({userId:'owner'},{url:'https://www.linkedin.com/jobs/view/123/',title:'0 notifications',description:'React TypeScript NodeJS '.repeat(12)},'inspection');
 assert.equal(queued,true);assert.equal(result.prepared,true);
});

test('notification heading cannot borrow a title from a different posting or unverified data',async()=>{
 for(const matchReasons of [{version:'browser-listing-v1',url:'https://www.linkedin.com/jobs/view/456/'},{version:'unverified',url:'https://www.linkedin.com/jobs/view/123/'}]){
  const {service}=fixture();service.prisma.jobApplication.findFirst=async()=>({id:'posting',jobTitle:'Full Stack Engineer',matchReasons});
  await assert.rejects(()=>service.observeJob({userId:'owner'},{url:'https://www.linkedin.com/jobs/view/123/',title:'0 notifications',description:'React TypeScript NodeJS '.repeat(12)},'inspection'),/no supported job title/);
 }
});
