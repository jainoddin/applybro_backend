const {test}=require('node:test'),assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');
test('all observed candidates reach the database before the inspection cap is applied',async()=>{
 let insertSql='',insertValues=[];
 const db={user:{findUnique:async()=>({dailyApplyLimit:6,preferences:{titles:['Full Stack Developer']}})},$executeRaw:async()=>1,$queryRaw:async(s,...v)=>{
  const sql=s.join('?');if(sql.includes('FOR UPDATE'))return [{id:'discovery'}];
  if(sql.includes('INSERT INTO "BrowserRun"')){insertSql=sql;insertValues=v;return [];}
  throw Error('Unexpected query');
 }};
 db.$transaction=async callback=>callback(db);
 const service=new CompanionService(db);
 service.task=async()=>({kind:'DISCOVER',stage:'OPENED',autoDiscover:true,portal:'Naukri.com',url:'https://www.naukri.com/full-stack-developer-jobs'});
 await service.importJobs({userId:'owner',id:'device'},'discovery',{jobs:Array.from({length:30},(_,i)=>({url:'https://www.naukri.com/job-listings-fixture-'+i,title:'Full Stack Developer',company:'Fixture Employer'}))});
 const payload=insertValues.find(v=>typeof v==='string'&&v.startsWith('[{'));
 assert.equal(JSON.parse(payload).length,30);
 assert.match(insertSql,/ORDER BY[\s\S]*MAX\(r\."updatedAt"\)[\s\S]*NULLS FIRST/);
 assert.ok(insertSql.indexOf('LIMIT ?')>insertSql.indexOf('AND NOT EXISTS'));
 assert.equal(insertValues.at(-1),15);
});
