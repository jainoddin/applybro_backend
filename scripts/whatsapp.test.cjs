const {test}=require('node:test');const assert=require('node:assert/strict');const {createHmac}=require('node:crypto');
const {validWhatsAppSignature,whatsAppPhone,answerableField,matchingQuestionField}=require('../dist/agent/whatsapp-policy');
const {answerMemoryIdentity}=require('../dist/agent/whatsapp-policy');
test('Personal answers match exact wording and units across employers; company answers remain scoped',()=>{
 const field={tag:'INPUT',type:'text',label:'Notice period in days'},one={url:'https://one.example/job',company:'One',title:'Developer'},two={url:'https://two.example/job',company:'Two',title:'Developer'};
 assert.equal(answerMemoryIdentity(field,one).key,answerMemoryIdentity({...field,id:99,label:'  NOTICE PERIOD IN DAYS * '},two).key);
 assert.notEqual(answerMemoryIdentity(field,one).key,answerMemoryIdentity({...field,label:'Notice period in months'},one).key);
 assert.notEqual(answerMemoryIdentity({...field,label:'Expected salary INR per year'},one).key,answerMemoryIdentity({...field,label:'Expected salary USD per year'},one).key);
 const employer={...field,label:'Why do you want to join our company?'};
 assert.notEqual(answerMemoryIdentity(employer,one).key,answerMemoryIdentity(employer,two).key);
 assert.equal(answerMemoryIdentity(field,one).volatile,true);
 const locality={...field,label:'Where do you live in Hyderabad?'};
 assert.equal(answerMemoryIdentity(locality,one).key,answerMemoryIdentity(locality,two).key);
 assert.notEqual(answerMemoryIdentity(locality,one).key,answerMemoryIdentity({...locality,label:'Where do you live in Bengaluru?'},two).key);
 for(const label of ['Enter OTP code','Password','I agree to the terms','Disability status'])assert.equal(answerMemoryIdentity({...field,label},one),null);
});
test('Answer memory storage is encrypted and every lookup/delete is scoped to the requesting user',async()=>{
 const {WhatsAppService}=require('../dist/agent/whatsapp.service'),{unseal}=require('../dist/agent/agent-policy');const old=process.env.CLOUD_AGENT_ENCRYPTION_KEY;process.env.CLOUD_AGENT_ENCRYPTION_KEY='22'.repeat(32);
 let record;const deletes=[];const field={tag:'INPUT',type:'text',label:'Notice period in days'},context={url:'https://employer.example/job',company:'One',title:'Developer'};
 const db={async $executeRaw(parts,...values){const sql=parts.join('?');if(sql.includes('INSERT INTO "AgentAnswerMemory"')){assert.ok(sql.includes('"reuseAnswers"=TRUE'));record={user:values[0],key:values[1],encrypted:values[2],expires:values[3]};}else deletes.push(values);return 1;},async $queryRaw(parts,...values){assert.ok(parts.join('?').includes('"verifiedAt" IS NOT NULL'));return record?.user===values[0]&&record?.key===values[1]?[{encrypted:record.encrypted}]:[];}};
 const service=new WhatsAppService(db);service.configured=()=>true;
 try{await service.remember('owner',field,'30',context);assert.equal(unseal(record.encrypted).value,'30');assert.ok(record.expires instanceof Date);assert.equal((await service.recalled('owner',field,context)).value,'30');assert.equal(await service.recalled('different-user',field,context),null);assert.equal(await service.recalled('owner',{...field,label:'Notice period in months'},context),null);await service.deleteAnswer('owner',record.key);assert.equal(deletes[0][0],'owner');assert.equal(deletes[0][1],record.key);}finally{if(old===undefined)delete process.env.CLOUD_AGENT_ENCRYPTION_KEY;else process.env.CLOUD_AGENT_ENCRYPTION_KEY=old;}
});
test('Webhook validates exact raw bytes and rejects forged or missing signatures',()=>{
 const raw=Buffer.from('{"entry":[]}'),secret='test-secret',sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(validWhatsAppSignature(raw,sig,secret),true);assert.equal(validWhatsAppSignature(Buffer.from('{ "entry":[]}'),sig,secret),false);
 for(const bad of [undefined,'',sig+'0','sha256=abc'])assert.equal(validWhatsAppSignature(raw,bad,secret),false);
 assert.equal(validWhatsAppSignature(raw,sig,''),false);
});
test('Only explicit international numbers; secrets and challenge fields never become answer questions',()=>{
 assert.equal(whatsAppPhone('+919876543210'),'919876543210');assert.throws(()=>whatsAppPhone('9876543210'));
 for(const label of ['Password','Enter OTP code','CAPTCHA answer','Bank account number'])assert.equal(answerableField({tag:'INPUT',type:'text',label}),false);
 assert.equal(answerableField({tag:'INPUT',type:'password',label:'Answer'}),false);
 assert.equal(answerableField({tag:'INPUT',type:'text',label:'Notice period in days'}),true);
});
test('Reply is valid only for exact current job URL and field identity, including frame and label',()=>{
 const field={id:12,frame:0,tag:'INPUT',type:'text',label:'Notice period in days'},url='https://example.com/job/one',saved={field,url};
 assert.equal(matchingQuestionField(saved,[field],url),field);
 for(const changed of [{...field,id:13},{...field,frame:1},{...field,label:'Current salary'},{...field,type:'password'}])assert.equal(matchingQuestionField(saved,[changed],url),null);
 assert.equal(matchingQuestionField(saved,[field],'https://example.com/job/two'),null);
 assert.equal(matchingQuestionField(saved,[field,field],url),null);
});
test('Inbound answers require quoted context and matching verified sender; duplicate events are consumed once',async()=>{
 const {WhatsAppService}=require('../dist/agent/whatsapp.service');const {unseal}=require('../dist/agent/agent-policy');
 const env={...process.env};Object.assign(process.env,{WHATSAPP_ENABLED:'true',WHATSAPP_ACCESS_TOKEN:'fixture',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_APP_SECRET:'test-secret',WHATSAPP_VERIFY_TOKEN:'fixture',WHATSAPP_TEMPLATE_NAME:'fixture',WHATSAPP_API_VERSION:'v23.0',WHATSAPP_BUSINESS_NUMBER:'15551234567',CLOUD_AGENT_ENCRYPTION_KEY:'11'.repeat(32)});
 const seen=new Set();let answer=null;let writes=0;
 const senderHash=createHmac('sha256','test-secret').update('919876543210').digest('hex');
 const db={async $transaction(fn){return fn(this);},async $executeRaw(parts,...values){const sql=parts.join('?');if(sql.includes('INSERT INTO "WhatsAppInbound"')){if(seen.has(values[0]))return 0;seen.add(values[0]);return 1;}if(sql.includes('"answer"=')){writes++;answer=values[0];return 1;}return 0;},async $queryRaw(parts,...values){assert.ok(parts.join('?').includes('"expiresAt">NOW()'));return values[0]===senderHash&&values[1]==='outgoing-question'&&!answer?[{id:'question-one'}]:[];}};
 const service=new WhatsAppService(db);
 const incoming=(id,from,context)=>({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123'},messages:[{id,from,type:'text',text:{body:'30 days'},context}]}}]}]});
 try{
  await service.inbound(incoming('wrong-sender','919999999999',{id:'outgoing-question'}));assert.equal(answer,null);
  await service.inbound(incoming('unquoted','919876543210',undefined));assert.equal(answer,null);
  await service.inbound(incoming('good','919876543210',{id:'outgoing-question'}));assert.deepEqual(unseal(answer),{value:'30 days'});
  await service.inbound(incoming('good','919876543210',{id:'outgoing-question'}));assert.equal(writes,1);
 }finally{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});

test('a quoted browser answer resumes only its parked job and enables exact-question reuse',async()=>{
 const {WhatsAppService}=require('../dist/agent/whatsapp.service'),{seal}=require('../dist/agent/agent-policy');
 const previous={...process.env};Object.assign(process.env,{WHATSAPP_ENABLED:'true',WHATSAPP_ACCESS_TOKEN:'fixture',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_APP_SECRET:'fixture',WHATSAPP_VERIFY_TOKEN:'fixture',WHATSAPP_TEMPLATE_NAME:'fixture',WHATSAPP_API_VERSION:'v23.0',WHATSAPP_BUSINESS_NUMBER:'15551234567',CLOUD_AGENT_ENCRYPTION_KEY:'11'.repeat(32)});
 const field={id:1,tag:'INPUT',type:'text',label:'Notice period in days'};let updated,remembered;
 const db={$transaction:async fn=>fn(db),$executeRaw:async(parts,...values)=>{if(parts.join('?').includes('UPDATE "BrowserRun"'))updated=JSON.parse(values[0]);return 1;},$queryRaw:async(parts,...values)=>{
  const sql=parts.join('?');if(sql.includes('FROM "WhatsAppQuestion"')){assert.ok(sql.includes("q.\"state\"='ACCEPTED'"));assert.ok(sql.includes('q."expiresAt">NOW()'));return [{id:'q',runId:'run',userId:'owner',encrypted:seal({field,fields:[field],context:{url:'https://employer.invalid/job',title:'Engineer',company:'Example'}})}];}
  assert.ok(sql.includes('"userId"='));assert.ok(sql.includes("\"stage\"='REVIEW_REQUIRED'"));return [{id:'run',details:{needsInput:true,whatsappQuestionId:'q'}}];
 }};
 const service=new WhatsAppService(db);service.remember=async(...args)=>{remembered=args;};
 try{await service.inbound({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123'},messages:[{id:'reply',from:'919876543210',type:'text',text:{body:'30'},context:{id:'quoted-message'}}]}}]}]});
  assert.equal(updated.answers[field.label],'30');assert.equal(updated.answerReady,true);assert.equal(updated.needsInput,false);assert.equal(updated.whatsappQuestionId,null);assert.equal(remembered[0],'owner');assert.equal(remembered[2],'30');
 }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
test('HTTP webhook preserves raw bytes, accepts authentic delivery and rejects tampered payloads',async()=>{
 require('reflect-metadata');const {Module}=require('@nestjs/common');const {NestFactory}=require('@nestjs/core');
 const {WhatsAppController}=require('../dist/agent/whatsapp.controller');const {WhatsAppService}=require('../dist/agent/whatsapp.service');const {AuthGuard}=require('../dist/auth/auth.guard');
 const previous=process.env.WHATSAPP_APP_SECRET;process.env.WHATSAPP_APP_SECRET='http-test';let received=0;
 const {AuthService}=require('../dist/auth/auth.service');
 const {WhatsAppOtpService}=require('../dist/agent/whatsapp-otp.service');
 class FixtureModule{};Module({controllers:[WhatsAppController],providers:[{provide:WhatsAppOtpService,useValue:{}},{provide:WhatsAppService,useValue:{async inbound(){received++;}}},{provide:AuthService,useValue:{async verify(){throw Error('Unauthorized');}}},{provide:AuthGuard,useValue:{canActivate(){return false;}}}]})(FixtureModule);
 // AuthGuard dependencies are not needed for public webhook routes.
 let app;try{
  app=await NestFactory.create(FixtureModule,{rawBody:true,logger:false,abortOnError:false});app.useBodyParser('json',{limit:'8mb'});await app.listen(0,'127.0.0.1');
  const url=await app.getUrl(),body='{ "object":"whatsapp_business_account", "entry": [] }',signature='sha256='+createHmac('sha256','http-test').update(body).digest('hex');
  const response=await fetch(url+'/agent/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':signature},body});assert.equal(response.status,201);assert.equal(received,1);
  const invalid=await fetch(url+'/agent/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':signature},body:JSON.stringify(JSON.parse(body))});assert.equal(invalid.status,403);assert.equal(received,1);
 }finally{if(app)await app.close();if(previous===undefined)delete process.env.WHATSAPP_APP_SECRET;else process.env.WHATSAPP_APP_SECRET=previous;}
});
