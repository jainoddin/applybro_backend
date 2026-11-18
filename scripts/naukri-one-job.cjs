// Attended, single-application operator. No stealth, password collection or bulk loop.
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const profile=path.resolve(__dirname,'../secrets/naukri-local-browser');
const resume=process.argv[2];if(!resume||!fs.existsSync(resume))throw Error('Provide the candidate-authorized resume path.');
const privateDir=path.resolve(__dirname,'../secrets/one-job');fs.mkdirSync(privateDir,{recursive:true});
let context,page,version=0,controls=[],uploaded=false,reviewed=null,confirmed=false;
const say=value=>console.log(JSON.stringify(value));
const allowed=url=>{try{const u=new URL(url);return u.origin==='https://www.naukri.com'&&!u.username&&!u.password;}catch{return false;}};
async function inspect(){
 const data=await page.evaluate(()=>{
  const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  for(const e of document.querySelectorAll('[data-onejob]'))e.removeAttribute('data-onejob');
  const elements=[...document.querySelectorAll('a[href],button,input,textarea,select,[role=button]')].filter(e=>visible(e)||e.type==='file').slice(0,350);
  const fields=elements.map((e,i)=>{const id=String(i);e.setAttribute('data-onejob',id);return{id,tag:e.tagName,type:e.type||'',disabled:!!e.disabled,label:[e.innerText,e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.name,e.id,e.labels&&[...e.labels].map(l=>l.innerText).join(' ')].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().slice(0,180),href:e.tagName==='A'?e.href:undefined,options:e.tagName==='SELECT'?[...e.options].map(o=>({value:o.value,text:o.textContent})):undefined};});
  return{title:document.title,text:document.body.innerText.slice(0,20000),controls:fields};
 });
 controls=data.controls;version++;
 const receipt=data.text.match(/Applied to\s+["“]?[^\n]{1,160}|(?:successfully applied|application (?:has been |was )?(?:submitted|received))[^\n]{0,160}/i)?.[0];
 if(receipt&&reviewed&&!confirmed){confirmed=true;const evidence={...reviewed,receipt,url:page.url(),confirmedAt:new Date().toISOString(),resumeFile:path.basename(resume),source:'PORTAL_CONFIRMATION'};fs.writeFileSync(path.join(privateDir,'confirmed-application.json'),JSON.stringify(evidence,null,2));say({confirmed:true,evidence});}
 return{version,url:page.url(),...data,uploaded,reviewed,confirmed};
}
async function target(c){
 if(c.version!==version)throw Error('Stale controls. Read the page again.');
 const previous=controls.find(f=>f.id===String(c.id));if(!previous)throw Error('Control unavailable.');
 const el=page.locator(`[data-onejob="${previous.id}"]`);
 const current=await el.evaluate(e=>({tag:e.tagName,type:e.type||'',label:[e.innerText,e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.name,e.id,e.labels&&[...e.labels].map(l=>l.innerText).join(' ')].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().slice(0,180)}));
 if(current.tag!==previous.tag||current.type!==previous.type||current.label!==previous.label)throw Error('Control changed. Read again.');
 return{el,previous};
}
async function command(c){
 if(c.action==='read')return inspect();
 if(c.action==='screenshot'){const file=path.join(privateDir,'current.png');await page.screenshot({path:file,mask:[page.locator('input[type=password],input[autocomplete=one-time-code]')]});return{file};}
 if(c.action==='close'){await context.close();process.exit(0);}
 if(confirmed)throw Error('One application was confirmed. No further mutating actions are permitted.');
 if(c.action==='goto'){if(!allowed(c.url))throw Error('Only the official Naukri site is enabled.');const response=await page.goto(c.url,{waitUntil:'domcontentloaded',timeout:30000});if(response?.status()>=400)throw Error('Portal denied access: HTTP '+response.status());await page.waitForTimeout(1500);return inspect();}
 if(c.action==='review'){
  if(!uploaded)throw Error('Upload the authorized resume first.');
  if(!page.url().includes('/job-listings-')||typeof c.title!=='string'||typeof c.company!=='string'||!c.reason)throw Error('Read the job description and provide its identity and fit rationale.');
  const text=(await page.locator('body').innerText()).toLowerCase();if(!text.includes(c.title.toLowerCase())||!text.includes(c.company.toLowerCase()))throw Error('Job identity not found on the current page.');
  reviewed={title:c.title,company:c.company,jobUrl:page.url(),fitReason:c.reason,reviewedAt:new Date().toISOString()};return{reviewed};
 }
 if(c.action==='scroll'){await page.mouse.wheel(0,c.direction==='up'?-550:550);await page.waitForTimeout(500);return inspect();}
 const{el,previous}=await target(c);
 if(c.action==='upload'){
  if(!/^https:\/\/www\.naukri\.com\/mnjuser\/profile/.test(page.url())||previous.type!=='file'||!/resume|\bcv\b/i.test(previous.label)||/photo|avatar/i.test(previous.label))throw Error('Choose the profile resume upload field.');
  await page.evaluate(()=>{window.__oneJobResumeReceipt='';window.__oneJobResumeObserver?.disconnect();window.__oneJobResumeObserver=new MutationObserver(records=>{for(const r of records)for(const n of [...r.addedNodes,...(r.type==='characterData'?[r.target.parentElement]:[])]){const t=n?.textContent||'';if(t.length<700&&/resume.{0,60}(?:upload|updat|sav).{0,30}success|resume.{0,30}success.{0,30}(?:upload|updat|sav)|success.{0,40}(?:upload|updat|sav).{0,20}resume/i.test(t))window.__oneJobResumeReceipt=t.trim().slice(0,300);}});window.__oneJobResumeObserver.observe(document.body,{childList:true,subtree:true,characterData:true});});
  await el.setInputFiles(resume);
  try{await page.waitForFunction(file=>!!window.__oneJobResumeReceipt&&document.body.innerText.includes(file),path.basename(resume),{timeout:20000});uploaded=true;return{uploaded:true,file:path.basename(resume),receipt:await page.evaluate(()=>window.__oneJobResumeReceipt)};}
  finally{await page.evaluate(()=>window.__oneJobResumeObserver?.disconnect()).catch(()=>{});}
 }
 if(c.action==='fill'){
  if(previous.type==='file'||!['INPUT','TEXTAREA','SELECT'].includes(previous.tag)||typeof c.value!=='string')throw Error('Choose an editable field.');
  if(previous.tag==='SELECT')await el.selectOption(c.value);else await el.fill(c.value);return{filled:true,id:previous.id};
 }
 if(c.action==='click'){
  if(previous.tag==='A'&&!allowed(previous.href))throw Error('External employer forms require a separate reviewed flow.');
  if(/^(apply(?: now)?|submit(?: application)?|send application)$/i.test(previous.label.trim())){
   if(!uploaded||!reviewed)throw Error('Resume upload and job review are required before applying.');
   const text=(await page.locator('body').innerText()).toLowerCase();if(!text.includes(reviewed.title.toLowerCase())||!text.includes(reviewed.company.toLowerCase()))throw Error('Application identity changed.');
  }
  await el.click({timeout:8000});await page.waitForTimeout(1800);return inspect();
 }
 throw Error('Unknown operator command.');
}
(async()=>{
 context=await chromium.launchPersistentContext(profile,{headless:false,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{}),viewport:{width:1280,height:900}});
 page=context.pages()[0]||await context.newPage();context.on('page',p=>{page=p;});
 const response=await page.goto('https://www.naukri.com/mnjuser/profile',{waitUntil:'domcontentloaded',timeout:30000});
 if(response?.status()>=400)throw Error('Portal access denied. No application submitted.');
 await page.waitForTimeout(1800);say(await inspect());
 const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of input){if(!line.trim())continue;try{say(await command(JSON.parse(line)));}catch(e){say({error:e.message});}}
 await context.close();
})().catch(async e=>{say({error:e.message});await context?.close().catch(()=>{});process.exitCode=1;});
