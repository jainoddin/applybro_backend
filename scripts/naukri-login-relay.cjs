const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const dns = require('node:dns/promises');
const { isIP } = require('node:net');
const publicAddress = value => {
  if (isIP(value) === 4) { const p = value.split('.').map(Number); return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && [0, 168].includes(p[1]) || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 198 && [18, 19].includes(p[1])); }
  return isIP(value) === 6 && /^[23][0-9a-f]{3}:/i.test(value) && !/^2001:(db8|0:|10:|20:)/i.test(value);
};
const LOGIN = 'https://www.naukri.com/nlogin/login';
const allowedPage = url => { try { const u = new URL(url); return u.protocol === 'https:' && ['www.naukri.com', 'naukri.com'].includes(u.hostname) && /^\/(nlogin(?:\/|$)|mnjuser\/(?:homepage|profile)(?:\/|$))/.test(u.pathname); } catch { return false; } };
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
  constructor() { this.sessions = new Map(); this.busy = new Set(); this.opening = 0; this.launch = options => chromium.launch(options); }
  async locked(owner, action) {
    if (this.busy.has(owner)) throw error('Please wait for the current browser action.', 409);
    this.busy.add(owner); try { return await action(); } finally { this.busy.delete(owner); }
  }
  async close(owner) {
    const s = this.sessions.get(owner); if (!s) return { closed: true };
    this.sessions.delete(owner); clearTimeout(s.timer); await s.browser.close().catch(() => {}); return { closed: true };
  }
  current(owner) {
    const s = this.sessions.get(owner);
    if (!s || s.expiresAt <= Date.now()) throw error('Private login expired or the server restarted. Connect again.', 410);
    if (!allowedPage(s.page.url())) throw error('The browser is not on an allowed Naukri login/profile page.');
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
      const headings = [...document.querySelectorAll('h1,h2,h3,.widgetHead,[role=heading]')].filter(visible).map(el => el.textContent.trim().toLowerCase());
      const sections = ['resume', 'key skills', 'employment', 'education', 'profile summary'].filter(x => headings.includes(x)).length;
      const privatePage = /^\/mnjuser\/(homepage|profile)\/?$/.test(location.pathname);
      const profileLink = [...document.querySelectorAll('a,button')].some(el => visible(el) && /^(view|edit) profile$/i.test(el.textContent.trim()));
      const signedIn = privatePage && !fields.some(f => f.type === 'password') && (sections >= 2 || profileLink && /profile performance/i.test(document.body.innerText));
      const name = signedIn ? [...document.querySelectorAll('[data-field=name],.user-name,.userName,.name,h1')].find(visible)?.textContent?.trim().slice(0, 120) || null : null;
      const challenge = [...document.querySelectorAll('iframe[src*=captcha],[id*=captcha i]')].some(visible);
      const messages = [...document.querySelectorAll('[role=alert],[class*=error i],.err,.err-msg,.errMsg,.formTextErr')].filter(visible).filter(el => el.innerText && el.innerText.length < 400).map(el => el.innerText.trim()).filter(Boolean).filter((x,i,all) => all.indexOf(x) === i).join(' ').slice(0, 400);
      return { fields, buttons, signedIn, name, challenge, message: signedIn ? 'Signed-in Naukri profile observed.' : messages || 'Enter the fields requested by Naukri, then choose its login or verification button.' };
    });
    s.version++; s.fields = view.fields; s.buttons = view.buttons;
    if (!view.signedIn && s.lastAction && !view.challenge && !/error|invalid|incorrect|wrong|unable/i.test(view.message)) view.message = 'Sign-in is not confirmed. Naukri still shows this form after ' + s.lastAction + '. Check the portal preview and response below.';
    if (!view.signedIn && s.network?.outcome === 'REQUEST_FAILED') view.message = `The Naukri login request failed (${s.network.errorCode || 'network error'}). ${s.network.guardReason ? 'ApplyBro network guard: ' + s.network.guardReason + '. ' : ''}No sign-in was confirmed. ` + view.message;
    const preview = await s.page.screenshot({ type: 'jpeg', quality: 65, mask: [s.page.locator('input,textarea,select')], timeout: 5000 }).then(b => b.toString('base64')).catch(() => null);
    return { ...view, status: view.signedIn ? 'SIGNED_IN' : view.challenge ? 'VERIFICATION_REQUIRED' : 'INPUT_REQUIRED', version: s.version, origin: new URL(s.page.url()).origin, expiresAt: s.expiresAt, sessionSaved: false, preview, network: s.network || null, lastAction: s.lastAction || null };
  }
  async start(owner) {
    return this.locked(owner, async () => {
      await this.close(owner);
      if (this.sessions.size + this.opening >= 1) throw error('The pilot browser is in use. Please try again shortly.', 503);
      this.opening++; let browser;
      try {
        const screen = await display();
        browser = await this.launch({ headless: false, ...(screen ? { env: { ...process.env, DISPLAY: screen } } : {}), ...(process.platform === 'win32' ? { executablePath: process.env.CLOUD_AGENT_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        let s;
        await context.route('**/*', async route => {
          const r = route.request(); let u; try { u = new URL(r.url()); } catch { return route.abort(); }
          const abort = reason => { if (s && authRequest(r)) s.network = { outcome: 'REQUEST_FAILED', guardReason: reason }; return route.abort(); };
          if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)) return abort('INVALID_PUBLIC_HTTPS_DESTINATION');
          try { const addresses = await dns.lookup(u.hostname, { all: true }); if (!addresses.length || !addresses.every(x => publicAddress(x.address))) return abort('NON_PUBLIC_ADDRESS'); } catch { return abort('DNS_LOOKUP_FAILED'); }
          if (r.isNavigationRequest() && r.frame().parentFrame() === null && !allowedPage(r.url())) return abort('UNSUPPORTED_LOGIN_NAVIGATION');
          return route.continue();
        });
        const page = await context.newPage();
        const response = await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (response?.status() >= 400) { await browser.close(); return { status: 'BLOCKED', httpStatus: response.status(), message: 'Naukri denied this browser. No account was connected.', fields: [], buttons: [] }; }
        await page.waitForTimeout(1500);
        s = { browser, page, version: 0, fields: [], buttons: [], expiresAt: Date.now() + 300000 };
        page.on('response', response => { if (authRequest(response.request())) s.network = { outcome: 'RESPONSE', httpStatus: response.status() }; });
        page.on('requestfailed', request => {
          if (!authRequest(request)) return;
          const code = request.failure()?.errorText?.match(/^net::[A-Z0-9_]+/)?.[0] || 'NETWORK_ERROR';
          s.network = { ...s.network, outcome: 'REQUEST_FAILED', errorCode: code };
          // Transport diagnostics only: never request bodies, tokens, URL queries or account identifiers.
          console.info(JSON.stringify({ event: 'NAUKRI_AUTH_TRANSPORT', ...s.network, host: new URL(request.url()).hostname, resourceType: request.resourceType(), navigation: request.isNavigationRequest() }));
        });
        s.timer = setTimeout(() => { void this.close(owner); }, 300000); s.timer.unref(); this.sessions.set(owner, s);
        return await this.snapshot(s);
      } catch (e) { await this.close(owner); await browser?.close().catch(() => {}); throw error(e.status ? e.message : 'The private Naukri browser could not start. Please try again.', e.status || 503); }
      finally { this.opening--; }
    });
  }
  async refresh(owner) { return this.locked(owner, () => this.snapshot(this.current(owner))); }
  async fill(owner, body) {
    return this.locked(owner, async () => {
      const s = this.current(owner);
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
      if (body.version !== s.version) throw error('Naukri changed its page. Refresh first.', 409);
      const button = s.buttons.find(b => b.id === body.id); if (!button) throw error('Choose a current Naukri login button.');
      const el = s.page.locator(`[data-applybro-login="${button.id}"]`);
      if ((await el.evaluate(el => (el.innerText || el.value || '').replace(/\s+/g, ' ').trim())) !== button.label) throw error('The login button changed. Refresh first.', 409);
      s.lastAction = button.label; s.network = null;
      await el.click({ timeout: 5000 }); await s.page.waitForTimeout(3000);
      return this.snapshot(s);
    });
  }
  async dispose() { await Promise.all([...this.sessions.keys()].map(id => this.close(id))); displayProcess?.kill(); }
}
async function authenticate(req) {
  const token = req.headers.authorization;
  if (typeof token !== 'string' || !/^Bearer \S+$/.test(token) || token.length > 8192) throw error('Sign in to ApplyBro first.', 401);
  let response;
  try { response = await fetch('https://applybro-backend.onrender.com/auth/me', { headers: { Authorization: token }, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { throw error('ApplyBro authentication server is unavailable. Try again shortly.', 503); }
  if (!response.ok) throw error('Your ApplyBro session could not be verified. Sign in again.', response.status === 401 ? 401 : 503);
  const user = await response.json(); if (typeof user.id !== 'string' || !user.id) throw error('Account verification failed.', 401);
  return user.id;
}
module.exports = { LoginRelay, authenticate, allowedPage };
