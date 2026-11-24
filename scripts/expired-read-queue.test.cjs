const {test}=require('node:test'),assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');

test('expired read heads return their terminal stage without releasing profile or resume',async()=>{
 const original={id:'old-read',userId:'owner',deviceId:'device',kind:'INSPECT',stage:'CREATED',createdAt:new Date(Date.now()-2*86400000),updatedAt:new Date(),details:{autoDiscover:true}};
 let expired=false,reads=0;
 const service=new CompanionService({$executeRaw:async()=>{expired=true;return 1;},$queryRaw:async()=>{reads++;return [{...original,stage:expired?'FAILED':'CREATED'}];},user:{findUnique:async()=>{throw Error('No profile should be read');}}});
 const result=await service.task({id:'device',userId:'owner'},'old-read');
 assert.equal(reads,2);assert.equal(result.stage,'FAILED');assert.equal(result.autoDiscover,false);assert.equal(result.profile,null);assert.equal(result.resume,null);
});

test('expired read with pending input remains paused instead of being replayed',async()=>{
 const row={id:'old-question',kind:'DISCOVER',stage:'REVIEW_REQUIRED',createdAt:new Date(Date.now()-2*86400000),details:{autoDiscover:true,needsInput:true}};
 const service=new CompanionService({$executeRaw:async()=>0,$queryRaw:async()=>[row]});
 const result=await service.task({id:'device',userId:'owner'},row.id);assert.equal(result.stage,'REVIEW_REQUIRED');assert.equal(result.details.needsInput,true);assert.equal(result.autoSubmit,false);
});

test('expired-read cleanup is scoped and cannot update any application task',async()=>{
 let sql='',values=[];const service=new CompanionService({$executeRaw:async(s,...v)=>{sql=s.join('?');values=v;}});
 await service.expireReadTasks({id:'device',userId:'owner'});
 assert.match(sql,/"kind" IN \('DISCOVER','INSPECT'\)/);assert.match(sql,/"createdAt"<NOW\(\)-INTERVAL '24 hours'/);assert.match(sql,/needsInput/);assert.deepEqual(values,['owner','device']);
});
