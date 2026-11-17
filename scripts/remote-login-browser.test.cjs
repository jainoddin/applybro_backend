const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {RemoteLogin}=require('./remote-login.cjs');
test('Real browser fixture: remote click, typing, submit and verified completion reuse one page',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 try{const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<label>Email<input id="email"></label><label>Password<input id="password" type="password"></label><button id="submit" onclick="window.fixtureDone=true">Sign in</button>'}));await page.goto('https://www.linkedin.com/login');
 const session={page,uiAttemptId:'fixture',remoteUntil:Date.now()+60000,remoteVersion:0};const relay={current:owner=>{assert.equal(owner,'fixture-owner');return session;},locked:async(_,fn)=>fn(),snapshot:async()=>await page.evaluate(()=>window.fixtureDone)?{status:'SIGNED_IN',sessionSaved:true}:{status:'INPUT_REQUIRED',sessionSaved:false}};
 const remote=new RemoteLogin(relay);let frame=await remote.view('fixture-owner',{attemptId:'fixture'});
 for(const [selector,value] of [['#email','test@example.invalid'],['#password','fixture-only-password']]){const box=await page.locator(selector).boundingBox();frame=await remote.control('fixture-owner',{attemptId:'fixture',version:frame.version,action:'click',x:box.x+5,y:box.y+5});frame=await remote.control('fixture-owner',{attemptId:'fixture',version:frame.version,action:'type',text:value});assert.equal(await page.locator(selector).inputValue(),value);}
 const button=await page.locator('#submit').boundingBox();frame=await remote.control('fixture-owner',{attemptId:'fixture',version:frame.version,action:'click',x:button.x+5,y:button.y+5});assert.equal(frame.status,'SIGNED_IN');assert.equal(frame.sessionSaved,true);assert.equal(frame.image,undefined);assert.equal(context.pages().length,1);
 }finally{await browser.close();}
});
