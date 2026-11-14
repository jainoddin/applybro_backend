require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { LiveSources } = require('../dist/jobs/live-sources');
const { JobsService } = require('../dist/jobs/jobs.service');
const assert = require('node:assert/strict');
const prisma = new PrismaClient();
(async () => {
  let id;
  try {
    const user = await prisma.user.create({ data: { name:'Live feed validation', email:`feed-test-${Date.now()}@example.invalid`, skills:'React,TypeScript', preferences:{create:{titles:['Engineer'],locations:['India'],workModes:[],includeKeywords:[],excludeKeywords:[],avoidCompanies:[]}} } });
    id=user.id;
    const service = new JobsService(prisma,new LiveSources());
    const first=await service.discoverMoreJobs(id);
    assert.ok(first.jobs.length>0,'Expected live engineering jobs in India');
    const second=await service.discoverMoreJobs(id);
    assert.equal(first.jobs.length,second.jobs.length);
    const action=await service.applyJob(id,first.jobs[0].id);
    assert.equal(action.action,'OPEN_EMPLOYER_FORM');
    assert.equal((await service.getAppliedJobs(id)).length,0);
    console.log(JSON.stringify({liveMatches:first.jobs.length,persisted:second.jobs.length,duplicateFree:true,applicationAction:action.action,submitted:0,warnings:first.warnings}));
  } finally {
    if(id)await prisma.user.delete({where:{id}});
    await prisma.$disconnect();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
