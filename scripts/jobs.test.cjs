const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JobsService } = require('../dist/jobs/jobs.service');
const { trustedApplicationUrl } = require('../dist/jobs/live-sources');
const listing = { key:'greenhouse:example:123', title:'Frontend Engineer', company:'Example', location:'India', url:'https://job-boards.greenhouse.io/example/jobs/123', description:'TypeScript React Node.js', source:'greenhouse' };
function fixture() {
  const rows = []; let updates = 0;
  const prisma = { $queryRaw:async()=>[], $executeRaw:async()=>1, user: { findUnique:async()=>({id:'u',skills:'React,TypeScript,Node.js',preferences:{titles:['Frontend Engineer'],locations:['India']}}),update:async()=>{updates++;} },
    jobApplication: { findMany:async()=>rows, findFirst:async({where})=>rows.find(r=>r.id===where.id && r.userId===where.userId),
      upsert:async({create,update,where})=>{const old=rows.find(r=>r.id===where.id); if(old)Object.assign(old,update); else rows.push(create);},
      update:async()=>{updates++;} } };
  return {rows, get updates(){return updates;},service:new JobsService(prisma,{discover:async()=>({jobs:[listing],warnings:[]})})};
}
test('trusted URLs reject spoofed hosts and unsafe schemes',()=>{
  assert.equal(trustedApplicationUrl(listing.url),true);
  for(const url of ['http://jobs.lever.co/x','https://jobs.lever.co.evil.test/x','javascript:alert(1)','https://user:password@jobs.lever.co/x'])assert.equal(trustedApplicationUrl(url),false);
});
test('discovery persists real listings, deduplicates and does not submit',async()=>{
  const f=fixture(); await f.service.discoverMoreJobs('u'); const data=await f.service.discoverMoreJobs('u');
  assert.equal(f.rows.length,1); assert.equal(data.jobs.length,1); assert.equal(data.stats.applied,0);assert.equal(data.jobs[0].matchScore,100);
  assert.equal(f.rows[0].status,'WAITING_FOR_APPROVAL');
  const action=await f.service.applyJob('u',f.rows[0].id);
  assert.equal(action.action,'OPEN_EMPLOYER_FORM');assert.equal(action.success,false);assert.equal(f.updates,0);
  await assert.rejects(()=>f.service.applyJob('other',f.rows[0].id));
});
test('generated records and unconfirmed applied states never count as submissions',async()=>{
  const f=fixture();f.rows.push({id:'fake',userId:'u',matchReasons:[],status:'APPLIED'});
  assert.equal((await f.service.getMatchedJobs('u')).jobs.length,0);
  await assert.rejects(()=>f.service.applyJob('u','fake'));
  await assert.rejects(()=>f.service.connectPortal('u','NAUKRI'));
  await assert.rejects(()=>f.service.toggleAutoApply('u',true));
  assert.equal((await f.service.runAutoApplyBatch('u')).appliedCount,0);
  assert.equal(f.updates,0);
});
