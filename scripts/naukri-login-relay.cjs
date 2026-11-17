const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const {createPublicHttpsGuard}=require('./public-https-guard.cjs');
const { isIP } = require('node:net');
const publicAddress = value => {
  if (isIP(value) === 4) { const p = value.split('.').map(Number); return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && [0, 168].includes(p[1]) || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 198 && [18, 19].includes(p[1])); }
  return isIP(value) === 6 && /^[23][0-9a-f]{3}:/i.test(value) && !/^2001:(db8|0:|10:|20:)/i.test(value);
};
const LOGIN = 'https://www.naukri.com/nlogin/login';
const allowedPage = url => { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['www.naukri.com', 'naukri.com'].includes(u.hostname) && /^\/(nlogin(?:\/|$)|mnjuser\/(?:homepage|profile)(?:\/|$))/.test(u.pathname); } catch { return false; } };
const { OneJob, workflowPage } = require('./naukri-workflow.cjs');
const {PrivateSessionStore}=require('./private-session-store.cjs');
const {randomUUID}=require('node:crypto');
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const authRequest = request => { try { const u = new URL(request.url()); return request.method() === 'POST' && /(^|\.)naukri\.com$/i.test(u.hostname) && /login|auth|otp|verify|session/i.test(u.pathname); } catch { return false; } };
let displayProcess, displayReady;
async function display() {
  if (process.platform !== 'linux' || process.env.DISPLAY) return process.env.DISPLAY;
  if (!displayReady) displayReady = (async () => {
    displayProcess = spawn('Xvfb', [':99', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    let failed = false; displayProcess.on('error', () => { failed = true; });
    for (let i = 0; i < 50; i++) {
      if (failed || displayProcess.exitCode !== null) throw error('The private browser display could not start.', 503);
      if (fs.existsSync('/tmp/.X11-unix/X99')) return ':99';
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw error('The private browser display timed out.', 503);
  })().catch(e => { displayReady = null; throw e; });
  return displayReady;
}

class LoginRelay {
  constructor() { this.sessions = new Map(); this.busy = new Set(); this.opening = 0; this.store=new PrivateSessionStore();this.launch = options => chromium.launch(options); }
  async saveSession(s){if(!s.signedIn||!s.owner||!this.store.key)return false;s.sessionSaved=await this.store.save(s.owner,await s.page.context().storageState());s.savedAt=Date.now();return s.sessionSaved;}
  touch(owner,s){clearTimeout(s.timer);s.expiresAt=Date.now()+(s.connectionConfirmed?30*60*1000:300000);s.timer=setTimeout(()=>{if(['RUNNING','SUBMITTING'].includes(s.workflow?.state))this.touch(owner,s);else void this.close(owner);},s.expiresAt-Date.now());s.timer.unref();}
  async queueOtp(s,view){
    if(s.otpTicket||s.otpRequested)return;const fields=view.fields.filter(f=>f.tag==='INPUT'&&['text','tel','number'].includes(f.type)&&/\botp\b|one.?time|verification code/i.test(f.label));if(fields.length!==1||fields[0].filled)return;
    s.otpRequested=true;const field=fields[0];const result=await s.otpBridge.ask({sessionId:s.id,origin:new URL(s.page.url()).origin}).catch(()=>({state:'UNAVAILABLE'}));s.otpStatus=result.state;
    if(result.state!=='ACCEPTED')return;
    s.otpTicket={id:result.id,url:s.page.url(),field,expiresAt:result.expiresAt};this.touch(s.owner,s);
    s.otpTimer=setInterval(()=>{if(!this.busy.has(s.owner))void this.locked(s.owner,()=>this.consumeOtp(s)).catch(()=>{s.otpStatus='NEEDS_MANUAL_INPUT';clearInterval(s.otpTimer);});},5000);s.otpTimer.unref();
  }
  async consumeOtp(s){
    const ticket=s.otpTicket;if(!ticket||this.sessions.get(s.owner)!==s||s.closing)return;
    if(Date.now()>=ticket.expiresAt){s.otpStatus='EXPIRED';clearInterval(s.otpTimer);await s.otpBridge.cancel(ticket.id,s.id).catch(()=>{});return;}
    const answer=await s.otpBridge.poll(ticket.id,s.id);if(answer.state==='WAITING')return;
    clearInterval(s.otpTimer);s.otpStatus=answer.state;
    if(answer.state!=='ANSWERED')return;
    let code=answer.value;delete answer.value;
    try{
      if(!/^\d{4,8}$/.test(code||'')||s.page.url()!==ticket.url)throw Error('OTP page changed.');
      const view=await this.snapshot(s);const fields=view.fields.filter(f=>f.id===ticket.field.id&&f.label===ticket.field.label&&f.type===ticket.field.type&&f.tag==='INPUT');
      if(view.challenge||fields.length!==1||fields[0].filled)throw Error('OTP field changed, was filled manually, or CAPTCHA requires manual input.');
      const verify=view.buttons.filter(b=>/^(verify(?: otp)?|submit otp)$/i.test(b.label)),fallback=view.buttons.filter(b=>/^(continue|log ?in|sign in)$/i.test(b.label)),buttons=verify.length?verify:fallback;
      if(buttons.length!==1)throw Error('OTP verification button is ambiguous.');
      const field=s.page.locator(`[data-applybro-login="${fields[0].id}"]`);await field.fill(code,{timeout:3000});code='';
      if(!await field.evaluate(el=>el.checkValidity()))throw Error('OTP format does not match the portal.');
      s.lastAction='Verify OTP';s.loginStartedAt=Date.now();s.network=null;await s.page.locator(`[data-applybro-login="${buttons[0].id}"]`).click({timeout:5000});s.otpStatus='ENTERED';await s.page.waitForTimeout(1500);await this.snapshot(s);
    }finally{code='';}
  }
  async locked(owner, action) {
    if (this.busy.has(owner)) throw error('Please wait for the current browser action.', 409);
    this.busy.add(owner); try { return await action(); } finally { this.busy.delete(owner); }
  }
  async close(owner,{forget=false}={}) {
    if(forget)await this.store.remove(owner);
    const s = this.sessions.get(owner); if (!s) return { closed: true };
    if(!forget)await this.saveSession(s).catch(()=>{});
    if(s.otpTicket&&s.otpBridge)await s.otpBridge.cancel(s.otpTicket.id,s.id).catch(()=>{});clearInterval(s.otpTimer);
    s.closing = true; s.workflow?.stop(); s.pendingAuth?.clear(); this.sessions.delete(owner); clearTimeout(s.timer); await s.browser.close().catch(() => {}); return { closed: true };
  }
  current(owner) {
    const s = this.sessions.get(owner);
    if (!s || s.expiresAt <= Date.now()) throw error('Private login expired or the server restarted. Connect again.', 410);
    if (!(s.workflow ? s.workflow.navigation.allowed(s.page.url()) : allowedPage(s.page.url()))) throw error('The browser is not on a supported Naukri page.');
    this.touch(owner,s);
    return s;
  }
  async snapshot(s) {
    if (!allowedPage(s.page.url())) throw error('Naukri redirected outside the supported login pages.');
    const view = await s.page.evaluate(() => {
      const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const label = el => [el.labels && [...el.labels].map(x => x.innerText).join(' '), el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.name, el.tagName === 'BUTTON' ? el.innerText : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      for (const el of document.querySelectorAll('[data-applybro-login]')) el.removeAttribute('data-applybro-login');
      const fields = [...document.querySelectorAll('input,textarea,select')].filter(el => visible(el) && !el.disabled && !el.readOnly && !['hidden', 'submit', 'button', 'file', 'reset', 'image'].includes(el.type)).slice(0, 20).map((el, i) => {
        const id = String(i); el.setAttribute('data-applybro-login', id);
        return { id, label: label(el) || 'Naukri field', type: el.type || 'text', tag: el.tagName, required: !!el.required, filled: ['checkbox', 'radio'].includes(el.type) ? el.checked : !!el.value, options: el.tagName === 'SELECT' ? [...el.options].slice(0, 60).map(o => ({ value: o.value, label: o.textContent })) : undefined };
      });
      const buttonLabel = el => (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
      const seen = new Set();
      const buttons = [...document.querySelectorAll('button,input[type=submit],a')].filter(el => {
        const text = buttonLabel(el);
        if (!visible(el) || el.disabled || !/^(log ?in|sign in|continue|next|verify(?: otp)?|submit otp|send otp|get otp|resend(?: otp)?|login (?:with|via|using) otp|use otp to login|use password|login with password)$/i.test(text)) return false;
        // Header Login links navigate away instead of submitting the entered form.
        if (el.tagName === 'A') {
          if (/^(log ?in|sign in)$/i.test(text)) return false;
          const target = new URL(el.getAttribute('href') || '#', location.href);
          if (target.origin !== location.origin) return false;
        }
        return true;
      }).sort((a, b) => Number(b.tagName !== 'A' && !!b.closest('form')) - Number(a.tagName !== 'A' && !!a.closest('form')))
        .filter(el => { const text = buttonLabel(el).toLowerCase(); if (seen.has(text)) return false; seen.add(text); return true; }).slice(0, 12).map((el, i) => {
          const id = 'button-' + i; el.setAttribute('data-applybro-login', id); return { id, label: buttonLabel(el) };
        });
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,.widgetHead,.widgetTitle,.text,[role=heading]')].filter(visible).map(el => el.textContent.trim().toLowerCase());
      const sections = ['resume', 'key skills', 'employment', 'education', 'profile summary'].filter(x => headings.includes(x)).length;
      const privatePage = /^\/mnjuser\/(homepage|profile)\/?$/.test(location.pathname);
      // Naukri renders some profile/navigation actions as div/span controls.
      const profileControls = [...document.querySelectorAll('a,button,[role=button],span,div')].filter(visible);
      const controlText = el => el.textContent.replace(/\s+/g, ' ').trim();
      const profileLink = profileControls.some(el => /^(view|edit) profile$/i.test(controlText(el)));
      const visiblePassword = [...document.querySelectorAll('input[type=password]')].some(visible);
      const completeProfile = profileControls.some(el => /^complete profile$/i.test(controlText(el)));
      const accountNavigation = profileControls.some(el => /^my home$/i.test(controlText(el)));
      const signedIn = privatePage && !visiblePassword && (sections >= 2 || profileLink && /profile performance/i.test(document.body.innerText) || completeProfile && accountNavigation && /recommended jobs|profile performance/i.test(document.body.innerText));
      const loading = !signedIn && [...document.querySelectorAll('[role=progressbar],[aria-busy=true],.loader,.loading,[class*=spinner i]')].some(visible);
      const name = signedIn ? [...document.querySelectorAll('[data-field=name],.user-name,.userName,.name,h1')].find(visible)?.textContent?.trim().slice(0, 120) || null : null;
      const challenge = [...document.querySelectorAll('iframe[src*=captcha],[id*=captcha i]')].some(visible);
      const messages = [...document.querySelectorAll('[role=alert],[class*=error i],.err,.err-msg,.errMsg,.formTextErr')].filter(visible).filter(el => el.innerText && el.innerText.length < 400).map(el => el.innerText.trim()).filter(Boolean).filter((x,i,all) => all.indexOf(x) === i).join(' ').slice(0, 400);
      return { fields, buttons, signedIn, name, challenge, loading, message: signedIn ? 'Signed-in Naukri profile observed.' : messages || 'Enter the fields requested by Naukri, then choose its login or verification button.' };
    });
    s.signedIn = view.signedIn; if (view.signedIn) s.profileName = view.name; s.version++; s.fields = view.fields; s.buttons = view.buttons;
    if (view.signedIn && !s.connectionConfirmed) {
      const owner = [...this.sessions].find(([, session]) => session === s)?.[0];
      if (owner) {
        s.connectionConfirmed = true;this.touch(owner,s);
      }
    }
    if(view.signedIn&&(!s.savedAt||Date.now()-s.savedAt>60000))await this.saveSession(s).catch(()=>{s.sessionSaved=false;});
    if(!view.signedIn&&!view.challenge&&s.otpBridge)await this.queueOtp(s,view);
    const processing = !view.signedIn && !!s.lastAction && (!!s.pendingAuth?.size || view.loading);
    const timedOut = processing && Date.now() - s.loginStartedAt > 20000;
    if (processing) view.message = timedOut ? 'Naukri has not finished its login request within 20 seconds. Sign-in is unconfirmed. Do not resend your password repeatedly; you can close this session.' : 'Naukri is processing your login. Waiting for its response; no additional input is requested yet.';
    else if (!view.signedIn && s.lastAction && !view.challenge && !/error|invalid|incorrect|wrong|unable/i.test(view.message)) view.message = view.fields.length ? 'Sign-in is not confirmed. Naukri still shows its login form. Check the portal preview and response below.' : 'The page has not provided a verifiable signed-in profile or an editable question. Check the portal preview; no sign-in is claimed.';
    if (!view.signedIn && s.network?.outcome === 'REQUEST_FAILED') view.message = `The Naukri login request failed (${s.network.errorCode || 'network error'}). ${s.network.guardReason ? 'ApplyBro network guard: ' + s.network.guardReason + '. ' : ''}No sign-in was confirmed. ` + view.message;
    // Do not continually rasterize a full page while its login request is pending.
    // The free browser host has a small CPU budget. Cached previews stay labelled.
    const status = view.signedIn ? 'SIGNED_IN' : view.challenge ? 'VERIFICATION_REQUIRED' : timedOut ? 'LOGIN_TIMEOUT' : processing ? 'LOGIN_PROCESSING' : s.network?.outcome === 'REQUEST_FAILED' ? 'LOGIN_REQUEST_FAILED' : view.fields.length ? 'INPUT_REQUIRED' : 'PAGE_UNVERIFIED';
    if (s.previewEnabled!==false && !processing && (!s.preview || s.previewStatus !== status || Date.now() - s.previewAt >= 15000 || s.network?.outcome === 'REQUEST_FAILED' && s.previewNetwork !== s.network)) {
      const preview = await s.page.screenshot({ type: 'jpeg', quality: 55, mask: [s.page.locator('input,textarea,select')], timeout: 5000 }).then(b => b.toString('base64')).catch(() => null);
      if (preview) { s.preview = preview; s.previewAt = Date.now(); s.previewStatus = status; s.previewNetwork = s.network; }
    }
    return { ...view, ...(processing ? { fields: [], buttons: [] } : {}), status, version: s.version, origin: new URL(s.page.url()).origin, expiresAt: s.expiresAt, sessionSaved: !!s.sessionSaved,otpStatus:s.otpStatus||null, preview: s.previewEnabled===false?null:s.preview || null, previewAt: s.previewEnabled===false?null:s.previewAt || null, network: s.network || null, lastAction: s.lastAction || null, transport: s.transport };
  }
  async start(owner,{otpBridge=null,preview=true}={}) {
    return this.locked(owner, async () => {
      await this.close(owner);
      if (this.sessions.size + this.opening >= 1) throw error('The pilot browser is in use. Please try again shortly.', 503);
      this.opening++; let browser;
      try {
        const screen = await display();
        const http1Only = process.env.NAUKRI_HTTP1_ONLY === 'true';
        // Opt-in transport compatibility for observed HTTP/2 protocol failures.
        // HTTPS certificate validation and all destination guards remain enabled.
        browser = await this.launch({ headless: false, ...(http1Only ? { args: ['--disable-http2', '--disable-quic'] } : {}), ...(screen ? { env: { ...process.env, DISPLAY: screen } } : {}), ...(process.platform === 'win32' ? { executablePath: process.env.CLOUD_AGENT_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
        const saved=await this.store.load(owner);
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block',...(saved?{storageState:saved}:{}) });
        let s;
        const checkPublic=createPublicHttpsGuard({isPublic:publicAddress});
        await context.route('**/*', async route => {
          const r = route.request(); let u; try { u = new URL(r.url()); } catch { return route.abort(); }
          const abort = reason => { if (s && authRequest(r)) s.network = { outcome: 'REQUEST_FAILED', guardReason: reason }; return route.abort(); };
          if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)) return abort('INVALID_PUBLIC_HTTPS_DESTINATION');
          const denial=await checkPublic(r.url());if(denial)return abort(denial);
          let mainNavigation=false;try{mainNavigation=r.isNavigationRequest()&&r.frame().parentFrame()===null;}catch{mainNavigation=r.isNavigationRequest();}
          if (mainNavigation && !(s?.workflow ? s.workflow.navigation.allowed(r.url()) : allowedPage(r.url()))) return abort('UNSUPPORTED_LOGIN_NAVIGATION');
          return route.continue();
        });
        const page = await context.newPage();
        if (process.platform === 'win32' && process.env.NAUKRI_MINIMIZE_WINDOW === 'true') {
          const controls = await context.newCDPSession(page);
          const { windowId } = await controls.send('Browser.getWindowForTarget');
          await controls.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
          await controls.detach();
        }
        const response = await page.goto(saved?'https://www.naukri.com/mnjuser/profile':LOGIN, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (response?.status() >= 400) { await browser.close(); return { status: 'BLOCKED', httpStatus: response.status(), message: 'Naukri denied this browser. No account was connected.', fields: [], buttons: [] }; }
        await page.waitForSelector('input:not([type=hidden]),[role=heading],.user-name,.userName,h1',{timeout:1500}).catch(()=>{});
        s = { id:randomUUID(),owner,otpBridge,previewEnabled:preview,browser, page, version: 0, fields: [], buttons: [], pendingAuth: new Map(), transport: http1Only ? 'HTTP1_COMPATIBILITY' : 'BROWSER_DEFAULT', expiresAt: Date.now() + 300000 };
        page.on('request', request => { if (authRequest(request)) s.pendingAuth.set(request, Date.now()); });
        page.on('requestfinished', request => { s.pendingAuth.delete(request); });
        page.on('response', response => { if (authRequest(response.request())) s.network = { outcome: 'RESPONSE', httpStatus: response.status() }; });
        page.on('requestfailed', request => {
          if (!authRequest(request)) return;
          const startedAt = s.pendingAuth.get(request); s.pendingAuth.delete(request);
          if (s.closing) return;
          const code = request.failure()?.errorText?.match(/^net::[A-Z0-9_]+/)?.[0] || 'NETWORK_ERROR';
          s.network = { ...s.network, outcome: 'REQUEST_FAILED', errorCode: code };
          // Transport diagnostics only: never request bodies, tokens, URL queries or account identifiers.
          console.info(JSON.stringify({ event: 'NAUKRI_AUTH_TRANSPORT', ...s.network, elapsedMs: startedAt ? Date.now() - startedAt : null, host: new URL(request.url()).hostname, resourceType: request.resourceType(), navigation: request.isNavigationRequest() }));
        });
        s.timer = setTimeout(() => { void this.close(owner); }, 300000); s.timer.unref(); this.sessions.set(owner, s);
        return await this.snapshot(s);
      } catch (e) { await this.close(owner); await browser?.close().catch(() => {}); throw error(e.status ? e.message : 'The private Naukri browser could not start. Please try again.', e.status || 503); }
      finally { this.opening--; }
    });
  }
  async refresh(owner) {
    return this.locked(owner, async () => {
      const s = this.current(owner);
      if (s.workflow) return { status: 'SIGNED_IN', signedIn: true, name: s.profileName || null, message: 'Your existing application task is available below.', expiresAt: s.expiresAt, job: s.workflow.status(), fields: [], buttons: [] };
      let view = await this.snapshot(s);
      // A completed login XHR can leave the SPA on a blank/onboarding screen.
      // Check the actual protected profile in this SAME context, once only.
      // Never replay credentials or navigate away while an auth request is pending.
      if (view.status === 'PAGE_UNVERIFIED' && s.lastAction && !s.pendingAuth.size && !s.profileCheckAttempted) {
        s.profileCheckAttempted = true;
        const response = await s.page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await s.page.waitForTimeout(1500); s.preview = null;
        view = await this.snapshot(s);
        if (response?.status() >= 400) return { ...view, status: 'BLOCKED', signedIn: false, message: 'Naukri rejected the protected profile check. No login or application is confirmed.' };
      }
      return view;
    });
  }
  async jobStart(owner, body, loadMaterial, onConfirmed) {
    return this.locked(owner, async () => {
      const s = this.current(owner);
      if (s.workflow) throw error('This session already has a job attempt. Check its result; do not retry an uncertain submission.', 409);
      const current = await this.snapshot(s);
      if (!current.signedIn) throw error('Confirm your signed-in Naukri profile first.', 409);
      try { OneJob.validate(body); } catch (e) { throw error(e.message); }
      const material = await loadMaterial();
      try { s.workflow = new OneJob(s.page, material, body,{onPage:page=>{s.page=page;},onConfirmed}); } catch (e) { throw error(e.message, 409); }
      // A login plus a single application can outlive the five-minute login pilot.
      this.touch(owner,s);
      s.workflow.start();
      return s.workflow.status();
    });
  }
  async jobStatus(owner,onConfirmed) { const s = this.current(owner); if (!s.workflow) throw error('No job started.');if(onConfirmed)s.workflow.ops.onConfirmed=onConfirmed;await s.workflow.refreshOutcome();await s.workflow.saveReceipt();return s.workflow.status(); }
  async jobStop(owner) { const s = this.current(owner); if (!s.workflow) throw error('No job started.'); s.workflow.stop(); return s.workflow.status(); }
  async jobAnswer(owner, body) { return this.locked(owner, async () => { const s = this.current(owner); if (!s.workflow) throw error('No job started.'); return s.workflow.answer(body); }); }
  async fill(owner, body) {
    return this.locked(owner, async () => {
      const s = this.current(owner);
      if (s.pendingAuth.size) throw error('Naukri is still processing the previous login request. Please wait.', 409);
      if (body.version !== s.version) throw error('Naukri changed its page. Refresh the fields and try again.', 409);
      if (!Array.isArray(body.fields) || !body.fields.length || body.fields.length > 20) throw error('Choose the requested fields.');
      for (const item of body.fields) {
        const f = s.fields.find(f => f.id === item.id);
        if (!f || typeof item.value !== 'string' || item.value.length > 2000) throw error('The selected field is unavailable.');
        const el = s.page.locator(`[data-applybro-login="${f.id}"]`);
        const actual = await el.evaluate(el => ({ tag: el.tagName, type: el.type || 'text', visible: !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden', label: [el.labels && [...el.labels].map(x => x.innerText).join(' '), el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Naukri field' }));
        if (!actual.visible || actual.tag !== f.tag || actual.type !== f.type || actual.label !== f.label) throw error('The field changed. Refresh Naukri first.', 409);
        if (f.tag === 'SELECT') { if (!f.options.some(o => o.value === item.value)) throw error('Choose a valid Naukri option.'); await el.selectOption(item.value); }
        else if (['checkbox', 'radio'].includes(f.type)) await el.setChecked(item.value === 'true');
        else await el.fill(item.value, { timeout: 3000 });
        item.value = '';
      }
      return this.snapshot(s);
    });
  }
  async click(owner, body) {
    return this.locked(owner, async () => {
      const s = this.current(owner);
      if (s.pendingAuth.size) throw error('Naukri is still processing the previous login request. Please wait.', 409);
      if (body.version !== s.version) throw error('Naukri changed its page. Refresh first.', 409);
      const button = s.buttons.find(b => b.id === body.id); if (!button) throw error('Choose a current Naukri login button.');
      if(/resend|send otp|get otp|use otp/i.test(button.label)){if(s.otpTicket&&s.otpBridge)await s.otpBridge.cancel(s.otpTicket.id,s.id).catch(()=>{});clearInterval(s.otpTimer);s.otpTicket=null;s.otpRequested=false;}
      const el = s.page.locator(`[data-applybro-login="${button.id}"]`);
      if ((await el.evaluate(el => (el.innerText || el.value || '').replace(/\s+/g, ' ').trim())) !== button.label) throw error('The login button changed. Refresh first.', 409);
      s.lastAction = button.label; s.loginStartedAt = Date.now(); s.network = null; s.profileCheckAttempted = false;
      await el.click({ timeout: 5000 }); await s.page.waitForTimeout(3000);
      return this.snapshot(s);
    });
  }
  async dispose() { await Promise.all([...this.sessions.keys()].map(id => this.close(id))); displayProcess?.kill(); }
}
function backendOrigin() {
  const u = new URL(process.env.APPLYBRO_BACKEND_URL || process.env.BACKEND_API_URL || 'https://applybro-backend.onrender.com');
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !(u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw Error('Configure a valid trusted ApplyBro backend origin.');
  return u.origin;
}
async function authenticate(req) {
  const token = req.headers.authorization;
  if (typeof token !== 'string' || !/^Bearer \S+$/.test(token) || token.length > 8192) throw error('Sign in to ApplyBro first.', 401);
  let response;
  try { response = await fetch(backendOrigin()+'/auth/me', { headers: { Authorization: token }, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { throw error('ApplyBro authentication server is unavailable. Try again shortly.', 503); }
  if (!response.ok) throw error('Your ApplyBro session could not be verified. Sign in again.', response.status === 401 ? 401 : 503);
  const user = await response.json(); if (typeof user.id !== 'string' || !user.id) throw error('Account verification failed.', 401);
  return user.id;
}
module.exports = { LoginRelay, authenticate, allowedPage, backendOrigin, display, publicAddress };
