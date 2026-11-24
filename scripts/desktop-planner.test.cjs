const {test}=require('node:test');const assert=require('node:assert/strict');
const {cleanObservation,checkedAction,knownFieldValue,requestDesktopPlan}=require('../dist/jobs/desktop-planner');
const {CompanionService}=require('../dist/jobs/companion.service');
const {WhatsAppService}=require('../dist/agent/whatsapp.service');
const field=(label,type='text',extra={})=>({id:0,tag:'INPUT',type,label,required:true,filled:false,disabled:false,options:[],href:'',...extra});
const observation=(fields)=>({url:'https://www.linkedin.com/jobs/view/123/',text:'Frontend Engineer at Example Employer',fields,challenge:false});
test('observation discards values, cookies, selectors and arbitrary model fill values',()=>{
 const input=cleanObservation({...observation([{...field('Email'),value:'private',selector:'body',cookies:'secret'}]),password:'secret'});
 assert.equal(JSON.stringify(input).includes('private'),false);assert.equal(JSON.stringify(input).includes('secret'),false);
 assert.deepEqual(checkedAction({kind:'FILL',element:0,fact:'email',value:'invented'},input,{email:'verified@example.invalid'}),{kind:'FILL',element:0,value:'verified@example.invalid'});
 assert.throws(()=>checkedAction({kind:'FILL',element:0,fact:'invented'},input,{email:'verified@example.invalid'}));
});
test('unknown choices, credentials, external links and submit disguised as CLICK are blocked',()=>{
 for(const f of [field('Password','password'),field('I agree','checkbox'),field('Resume','file')])assert.throws(()=>checkedAction({kind:'FILL',element:0,fact:'email'},observation([f]),{email:'x@example.invalid'}));
 assert.throws(()=>checkedAction({kind:'CLICK',element:0},observation([field('Apply','button',{tag:'BUTTON'})]),{}));
 assert.throws(()=>checkedAction({kind:'CLICK',element:0},observation([field('Next','',{tag:'A',href:'https://external.invalid/job'})]),{}));
 assert.throws(()=>checkedAction({kind:'UPLOAD',element:0},observation([field('Cover letter','file')]),{}));
 const captcha=observation([]);captcha.challenge=true;assert.equal(checkedAction({kind:'WAIT'},captcha,{}).kind,'ASK_USER');
});

test('invalid model element references are client validation failures rather than internal errors',()=>{
 for(const action of [{kind:'CLICK'},{kind:'CLICK',element:'0'},{kind:'CLICK',element:-1}]){
  assert.throws(()=>checkedAction(action,observation([field('Easy Apply','button',{tag:'BUTTON'})]),{}),e=>e.getStatus?.()===400&&/No action was executed/.test(e.message));
 }
});
test('dropdown facts require an exact option, not a substring or inferred choice',()=>{
 const f=field('Full name','select-one',{tag:'SELECT',options:['Other candidate']});
 assert.equal(knownFieldValue(f,{fullName:'Test'}),null);
 assert.throws(()=>checkedAction({kind:'FILL',element:0,fact:'fullName'},observation([f]),{fullName:'Test'}));
});
test('overall experience cannot become technology experience and salary units cannot be guessed',()=>{
 assert.equal(knownFieldValue(field('Years of Java experience'),{experience:'2 years 0 months'}),null);
 assert.equal(knownFieldValue(field('Total work experience in years'),{experience:'2 years 0 months'}).value,'2');
 assert.equal(knownFieldValue(field('Expected annual salary'),{expectedCtc:'45000 monthly'}),null);
 assert.equal(knownFieldValue(field('Expected salary'),{expectedCtc:'45000'}),null);
});
test('model request uses existing server configuration and never trusts model success or raw values',async()=>{
 const old={key:process.env.CLOUD_AGENT_API_KEY,model:process.env.CLOUD_AGENT_MODEL};Object.assign(process.env,{CLOUD_AGENT_API_KEY:'fixture-secret',CLOUD_AGENT_MODEL:'fixture-model'});
 try{
  let sent;const raw=await requestDesktopPlan(observation([]),{}, {title:'Frontend Engineer',company:'Example Employer'},async(url,options)=>{sent=JSON.parse(options.body);assert.equal(url.includes('fixture-secret'),false);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"kind":"CONFIRMED"}'}]}}]})};});
  assert.throws(()=>checkedAction(raw,observation([]),{}));assert.match(sent.systemInstruction.parts[0].text,/untrusted/);
  await assert.rejects(requestDesktopPlan(observation([]),{},{},async()=>({ok:false,status:429})),/HTTP 429/);
 }finally{for(const [name,value] of [['CLOUD_AGENT_API_KEY',old.key],['CLOUD_AGENT_MODEL',old.model]])value===undefined?delete process.env[name]:process.env[name]=value;}
});
function fixture(){
 const run={id:'run',kind:'APPLY',stage:'REVIEW_REQUIRED',url:'https://www.linkedin.com/jobs/view/123/',applicationId:'app',autoSubmit:true,resume:{fileName:'fixture.pdf'},details:{}};
 const app={id:'app',jobTitle:'Frontend Engineer',companyName:'Example Employer',status:'WAITING_FOR_APPROVAL'};
 const db={user:{findUnique:async()=>({name:'Test Candidate',email:'verified@example.invalid'})},jobApplication:{findFirst:async()=>app},$queryRaw:async(parts,...values)=>{if(parts.join('?').startsWith('UPDATE')){if(!['OPENED','REVIEW_REQUIRED'].includes(run.stage)||Number(run.details.plannerSteps||0)!==values[4])return [];Object.assign(run.details,JSON.parse(values[0]));return [{id:run.id}];}return [];}};
 const service=new CompanionService(db);service.task=async(device,id)=>{assert.equal(device.userId,'owner');assert.equal(id,'run');return run;};return {run,app,service};
}

test('unique Easy Apply uses its observed numeric id without a model call',async()=>{
 const old=process.env.COMPANION_AI_PLANNER_ENABLED;process.env.COMPANION_AI_PLANNER_ENABLED='true';
 try{const {service}=fixture();const obs=observation([field('Save','button',{tag:'BUTTON'}),field('Easy Apply','button',{id:1,tag:'BUTTON'})]);
  const result=await service.planApplication({id:'device',userId:'owner'},'run',obs);assert.deepEqual(result.action,{kind:'CLICK',element:1,reason:undefined});
 }finally{old===undefined?delete process.env.COMPANION_AI_PLANNER_ENABLED:process.env.COMPANION_AI_PLANNER_ENABLED=old;}
});

test('planner diagnostics contain only application controls and counts, never candidate facts',async()=>{
 const old=process.env.COMPANION_AI_PLANNER_ENABLED;process.env.COMPANION_AI_PLANNER_ENABLED='true';
 try{const {run,service}=fixture();const obs=observation([field('Email'),field('Private Candidate Menu','button',{id:1,tag:'BUTTON'}),field('Easy Apply','button',{id:2,tag:'BUTTON'})]);
  await service.planApplication({id:'device',userId:'owner'},'run',obs);
  assert.deepEqual(run.details.plannerObservation,{fieldCount:3,requiredUnfilled:3,controls:[{label:'Easy Apply',disabled:false,external:false}]});
  assert.equal(JSON.stringify(run.details).includes('verified@example.invalid'),false);assert.equal(JSON.stringify(run.details).includes('Private Candidate Menu'),false);
 }finally{old===undefined?delete process.env.COMPANION_AI_PLANNER_ENABLED:process.env.COMPANION_AI_PLANNER_ENABLED=old;}
});
test('device planner refuses expired eligibility, wrong job identity and post-submit replay',async()=>{
 const old=process.env.COMPANION_AI_PLANNER_ENABLED;process.env.COMPANION_AI_PLANNER_ENABLED='true';
 try{const {run,service}=fixture();const device={id:'device',userId:'owner'};
  run.autoSubmit=false;await assert.rejects(service.planApplication(device,'run',observation([])),/eligible/);run.autoSubmit=true;
  assert.equal((await service.planApplication(device,'run',{...observation([]),text:'Unrelated job'})).action.kind,'ASK_USER');
  for(const stage of ['SUBMITTING','UNKNOWN','CANCELLED','BROWSER_CONFIRMED']){run.stage=stage;await assert.rejects(service.planApplication(device,'run',observation([])),/eligible/);}
 }finally{old===undefined?delete process.env.COMPANION_AI_PLANNER_ENABLED:process.env.COMPANION_AI_PLANNER_ENABLED=old;}
});
test('repeated unchanged step is parked instead of looping and saved answers are reused exactly',async()=>{
 const old=process.env.COMPANION_AI_PLANNER_ENABLED;process.env.COMPANION_AI_PLANNER_ENABLED='true';
 try{const {service}=fixture(),device={id:'device',userId:'owner'},obs=observation([field('Email')]);
  assert.equal((await service.planApplication(device,'run',obs)).action.kind,'FILL');
  assert.equal((await service.planApplication(device,'run',obs)).action.kind,'ASK_USER');
 }finally{old===undefined?delete process.env.COMPANION_AI_PLANNER_ENABLED:process.env.COMPANION_AI_PLANNER_ENABLED=old;}
});

test('a portal placeholder is not sufficient employer identity for planning',async()=>{
 const old=process.env.COMPANION_AI_PLANNER_ENABLED;process.env.COMPANION_AI_PLANNER_ENABLED='true';
 try{const {app,service}=fixture();app.companyName='LinkedIn';
  const result=await service.planApplication({id:'device',userId:'owner'},'run',{...observation([]),text:'Frontend Engineer LinkedIn'});
  assert.equal(result.action.kind,'ASK_USER');assert.match(result.action.reason,/employer name/);
 }finally{old===undefined?delete process.env.COMPANION_AI_PLANNER_ENABLED:process.env.COMPANION_AI_PLANNER_ENABLED=old;}
});

test('reinspection persists the actual employer and never overwrites it with a portal hostname',async()=>{
 for(const supplied of ['Example Employer','www.linkedin.com']){
  let saved;
  const old={id:'app',companyName:supplied==='Example Employer'?'LinkedIn':'Existing Employer',status:'WAITING_FOR_APPROVAL',matchReasons:{version:'browser-listing-v1',url:'https://www.linkedin.com/jobs/view/123/'}};
  const db={user:{findUnique:async()=>({id:'owner',activeMode:'AUTO_APPLY',autoApplyConsent:true,subscription:{active:true,trialEnds:new Date(Date.now()+86400000)},skills:'React Node.js TypeScript',minMatchScore:50,preferences:{titles:['Accountant']}})},jobApplication:{findFirst:async()=>old,upsert:async data=>{saved=data;}}};
  await new CompanionService(db).observeJob({id:'device',userId:'owner'},{url:old.matchReasons.url,title:'Frontend Engineer',company:supplied,description:'React Node.js TypeScript engineers build tested accessible applications and maintain reliable web services. '.repeat(3)});
  if(supplied==='Example Employer'){assert.equal(saved.update.companyName,'Example Employer');assert.equal(saved.update.matchReasons.companyObserved,true);}
  else {assert.equal('companyName' in saved.update,false);assert.equal(saved.update.matchReasons.companyObserved,false);}
 }
});
test('saved WhatsApp answer is scoped to the exact question and consumed without asking again',async()=>{
 const old=process.env.COMPANION_AI_PLANNER_ENABLED;process.env.COMPANION_AI_PLANNER_ENABLED='true';
 try{const {run,service}=fixture();run.details.answers={'Notice period in days':'30'};
  const result=await service.planApplication({id:'device',userId:'owner'},'run',observation([field('Notice period in days')]));
  assert.deepEqual(result.action,{kind:'FILL',element:0,value:'30',source:'USER_ANSWER'});
  const other=fixture();other.run.details.answers={'Notice period in months':'1'};
  const recalled=WhatsAppService.prototype.recalled;WhatsAppService.prototype.recalled=async()=>null;
  try{const question=await other.service.planApplication({id:'device',userId:'owner'},'run',observation([field('Notice period in days')]));assert.equal(question.action.kind,'ASK_USER');assert.equal(question.action.field.label,'Notice period in days');}finally{WhatsAppService.prototype.recalled=recalled;}
 }finally{old===undefined?delete process.env.COMPANION_AI_PLANNER_ENABLED:process.env.COMPANION_AI_PLANNER_ENABLED=old;}
});
test('WhatsApp questions are claimed once, scoped to the parked field and report API acceptance accurately',async()=>{
 const {run,service}=fixture();run.details={needsInput:true,missingFields:[field('Notice period in days')]};
 let claimed=false,sent=0;service.prisma.$queryRaw=async(parts)=>{
  const sql=parts.join('?');if(sql.startsWith('UPDATE')){if(claimed)return [];claimed=true;return [{id:'run'}];}return [{state:'ACCEPTED'}];
 };service.prisma.$executeRaw=async()=>1;
 const original=WhatsAppService.prototype.ask;WhatsAppService.prototype.ask=async()=>{sent++;return 'question-id';};
 try{const device={id:'device',userId:'owner'};
  await assert.rejects(service.applicationQuestion(device,'run',{field:field('Current salary')}),/question changed/);
  const [one,two]=await Promise.all([service.applicationQuestion(device,'run',{field:field('Notice period in days')}),service.applicationQuestion(device,'run',{field:field('Notice period in days')})]);
  assert.equal(sent,1);assert.equal([one,two].filter(r=>r.delivery==='ACCEPTED').length,1);assert.match(one.delivery==='ACCEPTED'?one.message:two.message,/not yet confirmed/);
 }finally{WhatsAppService.prototype.ask=original;}
});
