const {test}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('playwright');
const {CompanyNavigation,publicHttps,findEmployerJob}=require('./company-navigation.cjs');const {OneJob,workflowPage}=require('./naukri-workflow.cjs');
const job={consent:true,url:'https://www.naukri.com/job-listings-company-fixture-123',title:'Frontend Engineer',company:'Fixture Company',applyMode:'COMPANY'};
const material={facts:{fullName:'Fixture Candidate',email:'candidate@example.invalid'},resume:{fileName:'fixture.pdf',mimeType:'application/pdf',fileBase64:Buffer.from('%PDF fixture').toString('base64')}};
test('Observed company popup is enrolled even when its initial navigation did not record an origin',async()=>{
 const {browser,page}=await fixture({popup:true});try{
  const task=new OneJob(page,material,job,{allowNetwork:async value=>publicHttps(value),passRoute:route=>route.fallback(),openProfile:async()=>{},syncResume:async()=>{},plan});
  const permit=task.navigation.permitNavigation.bind(task.navigation);let missed=false;task.navigation.permitNavigation=(url,method)=>{if(!missed&&url.startsWith('https://careers.fixture.example/')){missed=true;return true;}return permit(url,method);};
  task.start();await task.task;assert.equal(missed,true);assert.equal(task.externalIdentity,true);assert.equal(task.navigation.allowed(task.page.url()),true);assert.equal(task.state,'WAITING_USER');assert.equal(task.uploaded,true);assert.equal(task.submitted,false);
 }finally{await browser.close();}
});
test('Generic homepage follows real careers and matching job links without sending applicant data',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 try{const context=await browser.newContext();const requests=[];await context.route('**/*',route=>{requests.push(route.request().method());const path=new URL(route.request().url()).pathname;return route.fulfill({contentType:'text/html',body:path==='/'?'<h1>Fixture Company</h1><a href="/careers">Careers</a>':path==='/careers'?'<h1>Fixture Company careers</h1><a href="/careers/frontend">Frontend Engineer</a>':'<h1>Frontend Engineer</h1><h2>Fixture Company</h2><input name=email>'});});const page=await context.newPage();await page.goto('https://careers.fixture.example/');const nav=new CompanyNavigation(workflowPage);nav.begin(job.url);nav.permitNavigation(page.url());nav.finish();assert.equal(await findEmployerJob(page,job,nav),true);assert.equal(new URL(page.url()).pathname,'/careers/frontend');assert.equal(await page.locator('input').inputValue(),'');assert.ok(requests.every(method=>method==='GET'));}finally{await browser.close();}
});
test('Company destinations require listing handoff, HTTPS and a bounded redirect chain',()=>{
 const nav=new CompanyNavigation(workflowPage);assert.equal(nav.permitNavigation('https://careers.example/job'),false);nav.begin(job.url);
 for(const value of ['http://example.com','https://127.0.0.1','https://169.254.169.254','https://[::1]','https://u:p@example.com','https://example.com:444'])assert.equal(nav.permitNavigation(value),false);
 assert.equal(nav.permitNavigation('https://careers.example/job','POST'),false);assert.equal(nav.permitNavigation('https://careers.example/job'),true);nav.finish();assert.equal(nav.allowed('https://careers.example/apply'),true);assert.equal(nav.allowed('https://elsewhere.example/apply'),false);
 assert.throws(()=>nav.begin('https://www.naukri.com/mnjuser/profile'));
 const bounded=new CompanyNavigation(workflowPage);bounded.begin(job.url);for(let i=0;i<5;i++)assert.equal(bounded.permitNavigation('https://step'+i+'.example/job'),true);assert.equal(bounded.permitNavigation('https://step6.example/job'),false);
});
async function fixture({popup=false,mismatch=false}={}){
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});const context=await browser.newContext();
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:new URL(route.request().url()).hostname==='www.naukri.com'?`<main><h1>Frontend Engineer</h1><h2>Fixture Company</h2><a ${popup?'target="_blank" rel="noopener"':''} href="https://careers.fixture.example/apply/one">Apply on company site</a></main>`:`<main><h1>Frontend Engineer</h1><h2>${mismatch?'Unrelated Employer':'Fixture Company'}</h2><form onsubmit="event.preventDefault();window.sent=(window.sent||0)+1;document.getElementById('receipt').textContent='Your application has been submitted'"><section id="one"><label>Email<input name="email" type="email" required></label><label>Resume / CV<input name="resume" type="file" required></label><button type="button" onclick="document.getElementById('one').hidden=true;document.getElementById('two').hidden=false">Continue</button></section><section id="two" hidden><label>Expected salary INR per year<input name="salary" required></label><button type="submit">Submit application</button></section></form><div id="receipt" role="alert"></div></main>`}));
 const page=await context.newPage();await page.goto(job.url);return {browser,page};
}
const plan=async observation=>{
 const email=observation.fields.find(f=>f.type==='email');if(email&&!email.filled)return {kind:'FILL',element:email.id,fact:'email'};
 const resume=observation.fields.find(f=>f.type==='file');if(resume&&!resume.filled)return {kind:'UPLOAD',element:resume.id};
 const salary=observation.fields.find(f=>/salary/i.test(f.label));if(salary&&!salary.filled)return {kind:'ASK_USER',element:salary.id,reason:'Expected salary is not provided.'};
 return {kind:observation.fields.some(f=>f.tag==='BUTTON'&&/^Continue$/.test(f.label))?'CLICK':'SUBMIT',element:observation.fields.find(f=>f.tag==='BUTTON').id};
};
for(const popup of [false,true])test(`Company ${popup?'popup':'same-tab'} fills facts, uploads resume, pauses on unknown question, and confirms exactly once`,async()=>{
 const {browser,page}=await fixture({popup});let nativeUploads=0;const errors=[];
 try{
  const task=new OneJob(page,material,job,{allowNetwork:async value=>publicHttps(value),passRoute:route=>route.fallback(),openProfile:async()=>{},syncResume:async()=>{nativeUploads++;},plan,execute:async(...args)=>{try{return await require('./cloud-browser.cjs').execute(...args);}catch(e){errors.push(e.message);throw e;}}});
  task.start();await task.task;assert.equal(task.state,'WAITING_USER',task.message);assert.equal(task.external,true);assert.equal(task.uploaded,true);assert.equal(nativeUploads,1);assert.equal(new URL(task.page.url()).hostname,'careers.fixture.example');
  assert.equal(await task.page.locator('input[type=file]').evaluate(e=>e.files[0].name),'fixture.pdf');assert.equal(await task.page.locator('input[type=email]').inputValue(),material.facts.email);assert.equal(await task.page.evaluate(()=>window.sent||0),0);
  const salary=task.status().questions.find(q=>/salary/i.test(q.label));await task.answer({version:task.version,answers:[{id:salary.id,value:'800000'}]});await task.task;
  assert.equal(task.state,'CONFIRMED',task.message+' '+errors.join('; '));assert.equal(await task.page.evaluate(()=>window.sent),1);assert.equal(nativeUploads,1);task.start();assert.equal(await task.page.evaluate(()=>window.sent),1);
 }finally{await browser.close();}
});
test('Mismatched employer destination receives neither candidate facts nor resume',async()=>{
 const {browser,page}=await fixture({mismatch:true});try{
  const task=new OneJob(page,material,job,{allowNetwork:async value=>publicHttps(value),passRoute:route=>route.fallback(),openProfile:async()=>{},syncResume:async()=>{},plan});task.start();await task.task;
  assert.equal(task.state,'WAITING_USER');assert.match(task.message,/no verified matching job/);assert.equal(task.uploaded,false);assert.equal(await task.page.locator('input[type=email]').inputValue(),'');assert.equal(await task.page.locator('input[type=file]').evaluate(e=>e.files.length),0);assert.equal(task.submitted,false);
 }finally{await browser.close();}
});
test('Known embedded ATS form is verified, filled and confirmed in its own frame',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});try{
  const context=await browser.newContext();await context.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return route.fulfill({contentType:'text/html',body:host==='www.naukri.com'?'<h1>Frontend Engineer</h1><h2>Fixture Company</h2><a href="https://careers.fixture.example/job">Apply on company site</a>':host==='boards.greenhouse.io'?'<h1>Frontend Engineer</h1><form onsubmit="event.preventDefault();window.sent=(window.sent||0)+1;document.getElementById(\'receipt\').textContent=\'Thank you for applying\'"><label>Email<input type=email required></label><label>Resume<input type=file required></label><button>Submit application</button></form><h2 id=receipt></h2>':'<h1>Careers</h1><h2>Fixture Company</h2><iframe src="https://boards.greenhouse.io/embed/job_app?for=fixture&token=one"></iframe>'});});const page=await context.newPage();await page.goto(job.url);let saved=0;
  const task=new OneJob(page,material,job,{allowNetwork:async value=>publicHttps(value),passRoute:route=>route.fallback(),openProfile:async()=>{},syncResume:async()=>{},plan,onConfirmed:async receipt=>{assert.match(receipt.confirmation.text,/Thank you for applying/);saved++;return {recorded:true};}});task.start();await task.task;
  assert.equal(task.state,'CONFIRMED',task.message);assert.equal(saved,1);assert.equal(await task.page.frames().find(f=>f.url().includes('greenhouse.io')).evaluate(()=>window.sent),1);
 }finally{await browser.close();}
});
