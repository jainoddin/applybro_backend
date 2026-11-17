const {test}=require('node:test'),assert=require('node:assert/strict'),{createHmac,randomUUID}=require('node:crypto');
const {BrowserReceiptService,verifyBrowserReceipt}=require('../dist/profile/browser-receipt.service');
test('Only authenticated owner plus signed current employer receipt creates an idempotent dashboard application',async()=>{
 const previous=process.env.PRIVATE_BROWSER_CALLBACK_KEY,key='33'.repeat(32);process.env.PRIVATE_BROWSER_CALLBACK_KEY=key;
 const rows=new Map(),db={jobApplication:{async findUnique({where}){return rows.get(where.id);},async upsert({where,create,update}){rows.set(where.id,rows.has(where.id)?{...rows.get(where.id),...update}:create);}}};const service=new BrowserReceiptService(db);
 const payload={taskId:randomUUID(),userId:'owner',signedAt:Date.now(),job:{url:'https://www.naukri.com/job-listings-fixture-123',title:'Frontend Engineer',company:'Fixture Company',score:85},confirmation:{url:'https://careers.example/complete?private=removed',text:'Your application has been submitted',at:new Date().toISOString()}};
 const signature=raw=>'sha256='+createHmac('sha256',key).update(raw).digest('hex');let raw=Buffer.from(JSON.stringify(payload));
 try{
  assert.equal(verifyBrowserReceipt(raw,signature(raw),key),true);await assert.rejects(()=>service.record('owner',raw,'sha256='+'0'.repeat(64),payload));await assert.rejects(()=>service.record('other-user',raw,signature(raw),payload));assert.equal(rows.size,0);
  await service.record('owner',raw,signature(raw),payload);await service.record('owner',raw,signature(raw),payload);assert.equal(rows.size,1);const row=rows.get(payload.taskId);assert.equal(row.status,'APPLIED');assert.equal(row.userId,'owner');assert.equal(row.matchReasons.receipt.url,'https://careers.example/complete');
  const expired={...payload,signedAt:Date.now()-600000};raw=Buffer.from(JSON.stringify(expired));await assert.rejects(()=>service.record('owner',raw,signature(raw),expired));assert.equal(rows.size,1);
  const native={...payload,taskId:randomUUID(),confirmation:{...payload.confirmation,url:'https://www.naukri.com/myapply/saveApply',text:'Applied to "Frontend Engineer"'}};raw=Buffer.from(JSON.stringify(native));await service.record('owner',raw,signature(raw),native);assert.equal(rows.size,2);
  for(const confirmation of [{...native.confirmation,url:'https://unrelated.example/myapply/saveApply'},{...native.confirmation,text:'Applied to "Different Role"'}]){const bad={...native,taskId:randomUUID(),confirmation};raw=Buffer.from(JSON.stringify(bad));await assert.rejects(()=>service.record('owner',raw,signature(raw),bad));}assert.equal(rows.size,2);
 }finally{if(previous===undefined)delete process.env.PRIVATE_BROWSER_CALLBACK_KEY;else process.env.PRIVATE_BROWSER_CALLBACK_KEY=previous;}
});
