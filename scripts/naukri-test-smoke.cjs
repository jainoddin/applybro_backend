// Synthetic official-origin pages: no real credentials or applications.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {NaukriTestService}=require('../dist/naukri-test/naukri-test.service');
async function fixture(mode){
 const service=new NaukriTestService();
 service.launch=async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
  const create=browser.newContext.bind(browser);
  browser.newContext=async(options)=>{const context=await create(options);const newPage=context.newPage.bind(context);
   context.newPage=async()=>{const page=await newPage();await page.route('**/*',route=>{
    if(mode==='blocked')return route.fulfill({status:403,body:'Access denied'});
    const profile=route.request().url().includes('/mnjuser/profile');
    const html=profile?(mode==='success'?'<h1 data-field="name">Fixture Candidate</h1><h2>Resume</h2><h2>Education</h2><input type="file">':'<h1>Not authenticated</h1>'):`<input type="email"><input type="password"><button onclick="document.body.innerHTML='${mode==='challenge'?'<input name=otp>':'Login response'}'">Login</button>`;
    return route.fulfill({contentType:'text/html',body:html});
   });return page;};return context;};return browser;
 };return service;
}
(async()=>{
 process.env.NAUKRI_LOGIN_TEST_ENABLED='false';const disabled=new NaukriTestService();await assert.rejects(()=>disabled.start('fixture'));
 process.env.NAUKRI_LOGIN_TEST_ENABLED='true';
 for(const mode of ['blocked','success','unverified','challenge']){const service=await fixture(mode);try{
  const start=await service.start('owner');
  if(mode==='blocked'){assert.equal(start.status,'BLOCKED');assert.equal(start.httpStatus,403);await assert.rejects(()=>service.login('owner','test@example.com','fixture-only'));}
  else{assert.equal(start.status,'READY');await assert.rejects(()=>service.login('another-owner','test@example.com','fixture-only'));const result=await service.login('owner','test@example.com','fixture-only');assert.equal(result.status,mode==='success'?'SIGNED_IN':mode==='challenge'?'VERIFICATION_REQUIRED':'NOT_SIGNED_IN');if(mode==='success')assert.equal(result.account.name,'Fixture Candidate');}
  console.log(`PASS ${mode}`);
 }finally{await service.onModuleDestroy();}}
 console.log('PASS disabled feature and owner isolation; synthetic tests only');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
