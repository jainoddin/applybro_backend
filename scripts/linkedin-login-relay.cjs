// Owner-authenticated LinkedIn login only. No application actions or challenge bypass.
const {LoginRelay,display,publicAddress}=require('./naukri-login-relay.cjs');
const {chromium}=require('playwright');
const {createPublicHttpsGuard}=require('./public-https-guard.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv}=require('node:crypto');
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['linkedin.com','www.linkedin.com'].includes(u.hostname)&&/^\/(login|uas\/|checkpoint\/|feed(?:\/|$)|in\/|mynetwork(?:\/|$)|authwall)/.test(u.pathname);}catch{return false;}};
class LinkedInStore{
 constructor({key=process.env.LINKEDIN_SESSION_KEY||process.env.NAUKRI_SESSION_KEY,dir=process.env.LINKEDIN_SESSION_DIR||path.resolve(__dirname,'../secrets/linkedin-sessions')}={}){this.key=/^[a-f0-9]{64}$/i.test(key||'')?Buffer.from(key,'hex'):null;this.dir=dir;}
 id(owner){return createHash('sha256').update('linkedin:'+owner).digest('hex');}
 async save(owner,state){if(!this.key)return false;const domain=h=>h==='linkedin.com'||h.endsWith('.linkedin.com'),now=Date.now(),filtered={cookies:(state.cookies||[]).filter(c=>domain(c.domain.replace(/^\./,''))&&(c.expires===-1||c.expires*1000>now)),origins:(state.origins||[]).filter(o=>{try{const u=new URL(o.origin);return u.protocol==='https:'&&domain(u.hostname);}catch{return false;}})},id=this.id(owner),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(JSON.stringify({state:filtered,expiresAt:now+30*86400000})),cipher.final()]);await fs.mkdir(this.dir,{recursive:true,mode:0o700});const file=path.join(this.dir,id+'.enc'),temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,Buffer.concat([iv,cipher.getAuthTag(),data]),{mode:0o600,flag:'wx'});await fs.rename(temp,file);return true;}
 async load(owner){if(!this.key)return null;try{const id=this.id(owner),data=await fs.readFile(path.join(this.dir,id+'.enc')),cipher=createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(data.subarray(12,28));const item=JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString());if(item.expiresAt<=Date.now()){await this.remove(owner);return null;}return item.state;}catch{return null;}}
 async remove(owner){await fs.unlink(path.join(this.dir,this.id(owner)+'.enc')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
class LinkedInLoginRelay extends LoginRelay{
 constructor(){super();this.store=new LinkedInStore();this.launch=o=>chromium.launch(o);}
 current(owner){const s=this.sessions.get(owner);if(!s||s.expiresAt<=Date.now())throw fail('Private LinkedIn session expired. Connect again.',410);if(!allowed(s.page.url()))throw fail('LinkedIn left the supported login pages.');this.touch(owner,s);return s;}
 async snapshot(s){
  if(!allowed(s.page.url()))throw fail('LinkedIn redirected outside supported login pages.');
  const view=await s.page.evaluate(()=>{
   const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',label=e=>[e.labels&&[...e.labels].map(x=>x.innerText).join(' '),e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.name].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().slice(0,180)||'Naukri field';
   const password=[...document.querySelectorAll('input[type=password]')].some(visible);
   const nav=[...document.querySelectorAll('nav')].filter(visible).some(n=>{
    if(n.id==='global-nav'||n.classList.contains('global-nav'))return true;
    const paths=new Set([...n.querySelectorAll('a[href]')].filter(visible).map(a=>{try{const u=new URL(a.href);return u.origin===location.origin?u.pathname.replace(/\/$/,''):'';}catch{return '';}}));
    return ['/mynetwork','/jobs','/notifications'].filter(p=>paths.has(p)).length>=2;
   });
   const profile=[...document.querySelectorAll('a[href*="/in/"],button.global-nav__primary-link-me-menu-trigger')].some(visible);
   const signedIn=/^\/(feed|in|mynetwork)(\/|$)/.test(location.pathname)&&nav&&profile&&!password;
   const challenge=[...document.querySelectorAll('iframe[src*=captcha i],iframe[src*=arkoselabs i],[id*=captcha i]')].some(visible);
   document.querySelectorAll('[data-applybro-login]').forEach(e=>e.removeAttribute('data-applybro-login'));
   const fields=signedIn||challenge?[]:[...document.querySelectorAll('input')].filter(e=>visible(e)&&!e.disabled&&!e.readOnly&&['text','email','password','tel','number'].includes(e.type)&&!/search/i.test(label(e))).slice(0,10).map((e,i)=>{const id=String(i);e.setAttribute('data-applybro-login',id);return{id,label:label(e),tag:e.tagName,type:e.type,filled:!!e.value,required:e.required};});
   const buttons=signedIn||challenge?[]:[...document.querySelectorAll('button,input[type=submit]')].filter(e=>visible(e)&&!e.disabled&&/^(sign in|log in|login|continue|next|verify|verify code|submit|send code|resend code)$/i.test((e.innerText||e.value||'').trim())).slice(0,8).map((e,i)=>{const id='button-'+i;e.setAttribute('data-applybro-login',id);return{id,label:(e.innerText||e.value).replace(/\s+/g,' ').trim()};});
   const message=[...document.querySelectorAll('[role=alert],#error-for-username,#error-for-password,.form__label--error')].filter(visible).map(e=>e.innerText).filter(Boolean).join(' ').slice(0,300);
   const name=signedIn?[...document.querySelectorAll('a[href*="/in/"]')].filter(visible).map(e=>e.innerText?.trim()).find(Boolean)?.split('\n')[0]?.slice(0,100)||null:null;
   return{signedIn,name,challenge,fields,buttons,message};
  });
  const newlyVerified=view.signedIn&&!s.connectionConfirmed;
  s.signedIn=view.signedIn;s.connectionConfirmed=view.signedIn;s.version++;s.fields=view.fields;s.buttons=view.buttons;
  if(newlyVerified)this.touch(s.owner,s);
  if(view.signedIn&&(!s.savedAt||Date.now()-s.savedAt>60000))await this.saveSession(s).catch(()=>{s.sessionSaved=false;});
  const status=view.signedIn?'SIGNED_IN':view.challenge?'VERIFICATION_REQUIRED':view.fields.length?'INPUT_REQUIRED':'PAGE_UNVERIFIED';
  const preview=s.previewEnabled===false?null:await s.page.screenshot({type:'jpeg',quality:50,mask:[s.page.locator('input,textarea,select')],timeout:5000}).then(b=>b.toString('base64')).catch(()=>null);
  return{...view,status,version:s.version,sessionSaved:!!s.sessionSaved,origin:new URL(s.page.url()).origin,expiresAt:s.expiresAt,preview,message:view.signedIn?'LinkedIn signed-in navigation and profile observed.':view.message||(view.challenge?'Complete LinkedIn verification in the private browser.':'Enter the fields LinkedIn requests. Sign-in is not confirmed yet.')};
 }
 async start(owner,{preview=true}={}){return this.locked(owner,async()=>{
  await this.close(owner);if(this.sessions.size+this.opening>=1)throw fail('Private LinkedIn browser is in use.',503);this.opening++;let browser,stage='DISPLAY';
  try{const screen=await display();stage='LAUNCH';browser=await this.launch({headless:false,...(screen?{env:{...process.env,DISPLAY:screen}}:{}),...(process.platform==='win32'?{executablePath:process.env.CLOUD_AGENT_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
   stage='SESSION_LOAD';const saved=await this.store.load(owner);stage='CONTEXT';const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',...(saved?{storageState:saved}:{})});
   const checkPublic=createPublicHttpsGuard({isPublic:publicAddress});
   await context.route('**/*',async route=>{const r=route.request();try{const u=new URL(r.url());if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return route.abort();if(await checkPublic(r.url()))return route.abort();if(r.isNavigationRequest()&&r.frame().parentFrame()===null&&!allowed(r.url()))return route.abort();return route.continue();}catch{return route.abort();}});
   const page=await context.newPage();page.on('popup',p=>void p.close());
   stage='NAVIGATION';const response=await page.goto(saved?'https://www.linkedin.com/feed/':'https://www.linkedin.com/login',{waitUntil:'domcontentloaded',timeout:20000});
   if(response?.status()>=400){await browser.close();return{status:'BLOCKED',fields:[],buttons:[],signedIn:false,message:'LinkedIn denied this browser. No account connected.',httpStatus:response.status()};}
   stage='INSPECTION';await page.waitForSelector('input:not([type=hidden]),nav,h1',{timeout:1500}).catch(()=>{});const s={id:randomUUID(),owner,previewEnabled:preview,browser,page,version:0,fields:[],buttons:[],pendingAuth:new Map()};this.sessions.set(owner,s);this.touch(owner,s);return await this.snapshot(s);
  }catch(e){
   const timeout=e?.name==='TimeoutError'||/timeout|timed out/i.test(e?.message||'');
   console.error(JSON.stringify({event:'LINKEDIN_START_FAILED',stage,timeout,errorType:['TimeoutError','Error','TypeError'].includes(e?.name)?e.name:'Error'}));
   await this.close(owner);await browser?.close().catch(()=>{});
   const messages={DISPLAY:'The browser display service is unavailable.',LAUNCH:'The server could not launch the LinkedIn browser.',SESSION_LOAD:'The saved LinkedIn session could not be loaded from the backend.',CONTEXT:'The LinkedIn browser session could not be created.',NAVIGATION:timeout?'LinkedIn did not load within 20 seconds. No sign-in was confirmed.':'The server could not load LinkedIn. No sign-in was confirmed.',INSPECTION:'LinkedIn loaded, but its sign-in page could not be inspected.'};
   throw fail(e.status?e.message:messages[stage]||'Private LinkedIn browser could not start.',e.status||503);
  }finally{this.opening--;}
 });}
 async refresh(owner){return this.locked(owner,async()=>{const s=this.current(owner);await s.page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});return this.snapshot(s);});}
 async fill(owner,body){if(body?.fields?.some(f=>/captcha/i.test(this.sessions.get(owner)?.fields?.find(x=>x.id===f.id)?.label||'')))throw fail('Complete CAPTCHA in the private browser.');try{return await super.fill(owner,body);}catch(e){e.message=e.message.replaceAll('Naukri','LinkedIn');if(!e.status){console.error(JSON.stringify({event:'LINKEDIN_ACTION_FAILED',errorType:e.name==='TimeoutError'?'TimeoutError':'Error'}));throw fail('LinkedIn did not finish this sign-in step. Check the connection to read its current page; your password will not be sent again.',503);}throw e;}}
 async click(owner,body){try{return await super.click(owner,body);}catch(e){e.message=e.message.replaceAll('Naukri','LinkedIn');if(!e.status){console.error(JSON.stringify({event:'LINKEDIN_ACTION_FAILED',errorType:e.name==='TimeoutError'?'TimeoutError':'Error'}));throw fail('LinkedIn did not finish this sign-in step. Check the connection to read its current page; your password will not be sent again.',503);}throw e;}}
}
module.exports={LinkedInLoginRelay,LinkedInStore,allowed};
