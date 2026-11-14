// Read-only access test for a headed Chromium browser on a server display.
// No credentials, session imports, form submissions, or security-bypass options.
const { chromium } = require('playwright');

(async () => {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error('DISPLAY_MISSING: launch with xvfb-run -a node scripts/server-browser-probe.cjs');
  }
  const browser = await chromium.launch({
    headless: false,
    ...(process.env.CLOUD_AGENT_CHROME_PATH ? { executablePath: process.env.CLOUD_AGENT_CHROME_PATH } : {}),
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const httpStatus = response?.status();
    const passwordField = await page.locator('input[type=password]:visible').count() > 0;
    const denied = httpStatus === 403;
    const body = denied ? await page.locator('body').innerText() : '';
    const result = {
      browserMode: 'headed', displayAvailable: !!process.env.DISPLAY || process.platform !== 'linux',
      status: httpStatus >= 400 ? 'BLOCKED' : passwordField ? 'LOGIN_FORM_AVAILABLE' : 'NOT_VERIFIED',
      httpStatus, pageTitle: await page.title(),
      denialReference: denied ? body.match(/Reference\s*#[\w.:-]+/i)?.[0] || null : null,
      loginAttempted: false, applicationsSubmitted: 0,
    };
    console.log(JSON.stringify(result));
    if (result.status !== 'LOGIN_FORM_AVAILABLE') process.exitCode = 2;
  } finally { await browser.close(); }
})().catch(error => {
  console.error(error.message.startsWith('DISPLAY_MISSING:') ? error.message : 'SERVER_BROWSER_PROBE_FAILED: browser could not complete the read-only access test.');
  process.exitCode = 1;
});
