// Temporary public health/result host; browser control is never exposed.
const http = require('node:http');
const { spawn } = require('node:child_process');
const {createHmac}=require('node:crypto');
const { LoginRelay, authenticate, backendOrigin } = require('./naukri-login-relay.cjs');
const relay = new LoginRelay();
const {LinkedInLoginRelay}=require('./linkedin-login-relay.cjs');
const linkedin=new LinkedInLoginRelay();
const {connectLogin,closePendingLogin}=require('./connect-login.cjs');
const {BackendSessionStore,requestContext}=require('./backend-session-store.cjs');
const persistent=process.env.PRIVATE_BROWSER_SESSION_STORAGE==='backend';
if(persistent){relay.store=new BackendSessionStore('NAUKRI',{origin:backendOrigin});linkedin.store=new BackendSessionStore('LINKEDIN',{origin:backendOrigin});}
let result = { status: 'STARTING', loginAttempted: false, applicationsSubmitted: 0 };
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if(req.method==='POST'&&/^\/linkedin-login\/(connect|start|refresh|preview|fill|click|close)$/.test(req.url)){
    try{const owner=await authenticate(req);requestContext.enterWith({owner,authorization:req.headers.authorization});let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>50000)throw Object.assign(Error('Request too large.'),{status:413});}let body;try{body=JSON.parse(raw||'{}');}catch{throw Object.assign(Error('Invalid request.'),{status:400});}
      const action=req.url.split('/').pop();if(linkedin.sessions.has(owner)&&typeof body.preview==='boolean')linkedin.sessions.get(owner).previewEnabled=body.preview;const data=action==='preview'?await linkedin.preview(owner):action==='connect'?await connectLogin(linkedin,owner,{preview:body.preview!==false,resetPending:body.resetPending===true,attemptId:typeof body.attemptId==='string'?body.attemptId.slice(0,80):undefined}):action==='start'?await linkedin.start(owner,{preview:body.preview!==false}):action==='refresh'?await linkedin.refresh(owner,{preview:body.preview===true}):action==='fill'?await linkedin.fill(owner,body):action==='click'?await linkedin.click(owner,body):(body.onlyUnverified===true?await closePendingLogin(linkedin,owner,{attemptId:body.attemptId}):await linkedin.close(owner,{forget:body.forget===true}));return res.end(JSON.stringify(data));
    }catch(e){res.writeHead(e.status||503);return res.end(JSON.stringify({message:e.status?e.message:'Private LinkedIn action could not complete. Refresh its fields.'}));}
  }
  if (req.method === 'POST' && /^\/login\/(connect|start|refresh|preview|fill|click|close|job-start|job-status|job-answer|job-stop)$/.test(req.url)) {
    try {
      const owner = await authenticate(req);
      requestContext.enterWith({owner,authorization:req.headers.authorization});
      let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 50000) throw Object.assign(new Error('Request too large.'), { status: 413 }); }
      let body; try { body = JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
      const action = req.url.split('/').pop();
      const loadMaterial = async () => {
        const response = await fetch(backendOrigin()+'/profile/browser-material', { headers: { Authorization: req.headers.authorization }, signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) throw Object.assign(new Error('Your saved profile/resume could not be loaded. Check Get Started.'), { status: 409 });
        return response.json();
      };
      const onConfirmed=async receipt=>{const key=process.env.PRIVATE_BROWSER_CALLBACK_KEY;if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('Receipt recording key is unavailable.');const payload=JSON.stringify({...receipt,userId:owner,signedAt:Date.now()}),signature='sha256='+createHmac('sha256',key).update(payload).digest('hex');const response=await fetch(backendOrigin()+'/profile/browser-receipt',{method:'POST',headers:{Authorization:req.headers.authorization,'Content-Type':'application/json','x-applybro-browser-signature':signature},body:payload,signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Receipt storage unavailable.');return response.json();};
      const otpCall=async(action,payload)=>{const key=process.env.PRIVATE_BROWSER_CALLBACK_KEY;if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('Private OTP channel is unavailable.');const raw=JSON.stringify({...payload,userId:owner,signedAt:Date.now()}),signature='sha256='+createHmac('sha256',key).update(raw).digest('hex');const response=await fetch(backendOrigin()+'/agent/whatsapp/browser-otp/'+action,{method:'POST',headers:{Authorization:req.headers.authorization,'Content-Type':'application/json','x-applybro-browser-signature':signature},body:raw,signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('WhatsApp OTP channel is unavailable.');return response.json();};
      const otpBridge={ask:payload=>otpCall('ask',payload),poll:(id,sessionId)=>otpCall('poll',{id,sessionId}),cancel:(id,sessionId)=>otpCall('cancel',{id,sessionId})};
      if(relay.sessions.has(owner))relay.sessions.get(owner).otpBridge=otpBridge;
      if(relay.sessions.has(owner)&&typeof body.preview==='boolean')relay.sessions.get(owner).previewEnabled=body.preview;
      if(action==='connect')return res.end(JSON.stringify(await connectLogin(relay,owner,{otpBridge,preview:body.preview!==false,resetPending:body.resetPending===true,attemptId:typeof body.attemptId==='string'?body.attemptId.slice(0,80):undefined})));
      const data = action === 'preview' ? await relay.preview(owner) : action === 'job-start' ? await relay.jobStart(owner, body, loadMaterial,onConfirmed) : action === 'job-status' ? await relay.jobStatus(owner,onConfirmed) : action === 'job-answer' ? await relay.jobAnswer(owner, body) : action === 'job-stop' ? await relay.jobStop(owner) : action === 'start' ? await relay.start(owner,{otpBridge}) : action === 'refresh' ? await relay.refresh(owner) : action === 'fill' ? await relay.fill(owner, body) : action === 'click' ? await relay.click(owner, body) : (body.onlyUnverified===true?await closePendingLogin(relay,owner,{attemptId:body.attemptId}):await relay.close(owner,{forget:body.forget===true}));
      return res.end(JSON.stringify(data));
    } catch (e) { res.writeHead(e.status || 503); return res.end(JSON.stringify({ message: e.status ? e.message : 'Private login action could not complete. Refresh the current Naukri fields.' })); }
  }
  if (req.method !== 'GET' || !['/', '/health', '/result'].includes(req.url)) {
    res.writeHead(404); return res.end(JSON.stringify({ message: 'Not found' }));
  }
  res.end(JSON.stringify(req.url === '/health' ? { status: 'ok', purpose: 'private-browser-helper',sessionPersistenceConfigured:!!relay.store.key,sessionStorage:persistent?'backend':'local-files',linkedinLogin:true,otpBridge:true } : result));
});
let probeChild=null;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{probeChild?.kill('SIGTERM');await linkedin.dispose();await relay.dispose();server.close(()=>process.exit(0));});
server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  if(process.env.PRIVATE_BROWSER_STARTUP_PROBE!=='true'){result={status:'ON_DEMAND',loginAttempted:false,applicationsSubmitted:0};console.log('Browser helper ready; browsers start only for authenticated sign-in requests.');return;}
  console.log('Browser helper ready; explicitly enabled read-only startup probe.');
  // A bounded child isolates Xvfb/browser startup from HTTP readiness.
  const child = process.platform === 'win32'
    ? spawn(process.execPath, ['scripts/server-browser-probe.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('timeout', ['--signal=TERM', '--kill-after=5s', '45s', 'xvfb-run', '-a', 'node', 'scripts/server-browser-probe.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  probeChild=child;
  let buffer = '', reported = false;
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 16384) buffer = buffer.slice(-16384);
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const data = JSON.parse(line);
        if (['BLOCKED', 'LOGIN_FORM_AVAILABLE', 'NOT_VERIFIED'].includes(data.status)) {
          result = { ...data, checkedAt: new Date().toISOString() }; reported = true;
          console.log(JSON.stringify(result));
        }
      } catch { /* Do not relay raw browser diagnostics. */ }
    }
  });
  child.stderr.on('data', () => {});
  const failed = status => {
    if (reported) return;
    reported = true; result = { status, loginAttempted: false, applicationsSubmitted: 0 };
    console.log(JSON.stringify(result));
  };
  child.on('error', () => failed('RUNTIME_FAILED'));
  child.on('exit', code => failed(code === 124 || code === 137 ? 'BROWSER_TIMEOUT' : 'RUNTIME_FAILED'));

});
