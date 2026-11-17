const {test}=require('node:test');const assert=require('node:assert/strict');
const {hasSubmissionEvidence}=require('../dist/jobs/application-evidence');
const {JobsService}=require('../dist/jobs/jobs.service');
const confirmed={id:'real',status:'APPLIED',appliedAt:new Date(),jobTitle:'Developer',companyName:'Company',matchReasons:{source:'verified-private-browser',receipt:{text:'Application submitted',url:'https://www.linkedin.com/jobs/view/4473712688/',at:new Date().toISOString()}}};
test('fabricated APPLIED status and empty confirmations are excluded',()=>{assert.equal(hasSubmissionEvidence({...confirmed,matchReasons:['Excellent match']}),false);assert.equal(hasSubmissionEvidence({...confirmed,matchReasons:{browserConfirmation:true}}),false);assert.equal(hasSubmissionEvidence(confirmed),true);});
test('dashboard reads never seed jobs or mark applications sent',async()=>{const fake={...confirmed,id:'fake',matchReasons:['sample']};const db={jobApplication:{findMany:async()=>[fake,confirmed]},user:{findUnique:async()=>({preferences:{titles:[]}})},$queryRaw:async()=>[]};const service=new JobsService(db,{},{});const result=await service.getMatchedJobs('owner');assert.equal(result.stats.applied,1);assert.equal(result.stats.inProgress,0);assert.equal(result.unverifiedRecords,1);assert.equal((await service.getAppliedJobs('owner')).length,1);});

