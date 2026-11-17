const fail=(message,status=409)=>Object.assign(Error(message),{status});
class RemoteLogin{
 constructor(relay){this.relay=relay;}
 session(owner,attemptId){const s=this.relay.current(owner);if(!attemptId||s.uiAttemptId!==attemptId)throw fail('This viewer has been replaced. Reopen Connect account.',410);if(!s.remoteUntil||s.remoteUntil<Date.now())throw fail('Remote sign-in control expired. Reopen Connect account.',410);return s;}
 async render(s){
  // This inspects login only; it never answers a challenge or submits an application.
  s.previewEnabled=false;const state=await this.relay.snapshot(s);
  if(state.status==='SIGNED_IN'&&state.sessionSaved===true)return{status:state.status,sessionSaved:true,name:state.name,version:s.remoteVersion||0};
  const image=await s.page.screenshot({type:'jpeg',quality:60,animations:'disabled',caret:'hide',mask:[s.page.locator('input,textarea,select')],timeout:10000});
  s.remoteVersion=(s.remoteVersion||0)+1;
  return{status:state.status,sessionSaved:!!state.sessionSaved,message:state.message,image:image.toString('base64'),width:1280,height:900,version:s.remoteVersion,expiresAt:s.remoteUntil,origin:new URL(s.page.url()).origin};
 }
 async view(owner,body){return this.relay.locked(owner,()=>this.render(this.session(owner,body.attemptId)));}
 async control(owner,body){return this.relay.locked(owner,async()=>{
  const s=this.session(owner,body.attemptId);
  if(!Number.isInteger(body.version)||body.version!==s.remoteVersion)throw fail('The browser image changed. Refresh it before acting.');
  if(s.signedIn&&s.sessionSaved)throw fail('This account is already connected.');
  const a=body.action;
  if(a==='click'){
   if(!Number.isFinite(body.x)||!Number.isFinite(body.y)||body.x<0||body.x>=1280||body.y<0||body.y>=900)throw fail('Click inside the browser image.',400);
   await s.page.mouse.click(body.x,body.y);
  }else if(a==='type'){
   if(typeof body.text!=='string'||!body.text.length||body.text.length>2000)throw fail('Enter at most 2000 characters.',400);
   try{await s.page.keyboard.insertText(body.text);}finally{body.text='';}
  }else if(a==='key'){
   if(!['Tab','Shift+Tab','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape','Control+A'].includes(body.key))throw fail('Unsupported key.',400);
   await s.page.keyboard.press(body.key);
  }else if(a==='scroll'){
   if(!Number.isFinite(body.delta)||Math.abs(body.delta)>900)throw fail('Invalid scroll amount.',400);
   await s.page.mouse.wheel(0,body.delta);
  }else throw fail('Unsupported browser action.',400);
  await s.page.waitForTimeout(300);
  return this.render(s);
 });}
}
module.exports={RemoteLogin};
