const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { LoginRelay, authenticate, allowedPage } = require('./naukri-login-relay.cjs');
async function fixture(mode = false) {
  const relay = new LoginRelay();
  relay.launch = async options => {
    const browser = await chromium.launch({ ...options, headless: true });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options), newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        await page.route('**/*', route => {
          if (mode === 'rejected' && route.request().url().includes('/central-login-services/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
          const profile = new URL(route.request().url()).pathname.includes('/mnjuser/profile');
          const submit = mode === 'rejected' ? "fetch('/central-login-services/v1/login',{method:'POST'}).then(()=>document.querySelector('.error-message').textContent='Invalid login details')" : "document.querySelector('#login').hidden=true;document.querySelector('#otp').hidden=false";
          const html = profile ? '<h1 data-field="name">Fixture Candidate</h1><h2>Resume</h2><h2>Education</h2>' : `<header><a href="https://login.naukri.com/nLogin/Login.php">Login</a></header><form id="login" onsubmit="event.preventDefault();${submit}"><label>Email<input type="email"></label><label>Password<input type="password"></label><button type="submit">Login</button><p class="error-message"></p></form><div id="otp" hidden><label>OTP<input name="otp"></label><button onclick="location.href='/mnjuser/profile'">Verify OTP</button></div>`;
          return route.fulfill({ status: mode === true ? 403 : 200, contentType: 'text/html', body: mode === true ? 'Access Denied' : html });
        }); return page;
      }; return context;
    }; return browser;
  }; return relay;
}
(async () => {
  await assert.rejects(() => authenticate({ headers: {} }), e => e.status === 401);
  assert.equal(allowedPage('https://www.naukri.com/nlogin/login'), true);
  assert.equal(allowedPage('https://www.naukri.com.evil.example/nlogin/login'), false);
  assert.equal(allowedPage('https://www.naukri.com/myapply/saveApply'), false);
  const relay = await fixture();
  try {
    let view = await relay.start('owner');
    assert.equal(view.status, 'INPUT_REQUIRED'); assert.equal(view.fields.length, 2);
    assert.equal(view.buttons.filter(b => b.label === 'Login').length, 1);
    assert.equal(await relay.current('owner').page.locator(`[data-applybro-login="${view.buttons[0].id}"]`).evaluate(el => el.tagName), 'BUTTON');
    await assert.rejects(() => relay.refresh('another-user'), e => e.status === 410);
    await assert.rejects(() => relay.fill('owner', { version: -1, fields: [] }), e => e.status === 409);
    const email = view.fields.find(f => f.type === 'email'), password = view.fields.find(f => f.type === 'password');
    view = await relay.fill('owner', { version: view.version, fields: [{ id: email.id, value: 'fixture@example.test' }, { id: password.id, value: 'secret-fixture-only' }] });
    assert(!JSON.stringify(view).includes('secret-fixture-only')); assert(!JSON.stringify(view).includes('fixture@example.test'));
    assert.equal(await relay.current('owner').page.locator('input[type=password]').inputValue(), 'secret-fixture-only');
    view = await relay.click('owner', { version: view.version, id: view.buttons[0].id });
    assert(view.fields.some(f => /otp/i.test(f.label))); assert.equal(view.status, 'INPUT_REQUIRED');
    view = await relay.fill('owner', { version: view.version, fields: [{ id: view.fields[0].id, value: '123456' }] });
    view = await relay.click('owner', { version: view.version, id: view.buttons[0].id });
    assert.equal(view.status, 'SIGNED_IN'); assert.equal(view.name, 'Fixture Candidate');
    await relay.close('owner'); await assert.rejects(() => relay.refresh('owner'), e => e.status === 410);
    console.log('PASS: dynamic email/password → OTP → verified fixture profile; owner isolation, stale version, no secret echo and close expiry');
  } finally { await relay.dispose(); }
  const blocked = await fixture(true);
  try { const view = await blocked.start('owner'); assert.equal(view.status, 'BLOCKED'); assert.equal(blocked.sessions.size, 0); console.log('PASS: blocked portal never becomes connected; no credentials sent'); }
  finally { await blocked.dispose(); }
  const rejected = await fixture('rejected');
  try {
    let view = await rejected.start('owner');
    view = await rejected.click('owner', { version: view.version, id: view.buttons[0].id });
    assert.equal(view.status, 'INPUT_REQUIRED'); assert.equal(view.network.httpStatus, 401);
    assert.match(view.message, /Invalid login details/); assert(view.preview);
    console.log('PASS: rejected login response and portal error shown without claiming sign-in');
  } finally { await rejected.dispose(); }
  console.log('Synthetic pages only. No real account login or application submitted.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
