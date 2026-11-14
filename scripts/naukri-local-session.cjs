// Attended local login first; read-only background verification afterwards.
// Uses an isolated browser profile, never the user's existing Chrome profile.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const profile = path.resolve(__dirname, '../secrets/naukri-local-browser');
const mode = process.argv[2];
const homepage = 'https://www.naukri.com/mnjuser/homepage';

async function inspect(page, response) {
  const status = response?.status();
  if (status >= 400) return { status: 'BLOCKED', httpStatus: status, message: 'The portal refused access. No login or application is claimed.' };
  return page.evaluate(() => {
    const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const text = document.body.innerText;
    const profileLink = [...document.querySelectorAll('a,button')].some(el => visible(el) && /^(view|edit) profile$/i.test(el.textContent.trim()));
    const privateRoute = /^\/mnjuser\/(homepage|profile)\/?$/.test(location.pathname);
    const loginForm = [...document.querySelectorAll('input[type=password]')].some(visible);
    const signedIn = privateRoute && profileLink && /profile performance|profile completeness|resume|key skills/i.test(text) && !loginForm;
    return { status: signedIn ? 'SESSION_OBSERVED' : 'NOT_VERIFIED', message: signedIn ? 'A signed-in Naukri page was observed in this dedicated browser.' : 'A signed-in profile was not verified. Login or manual verification may be required.' };
  });
}

async function compare() {
  // Same URL, profile and installed browser. No stealth flags or retries.
  for (const headless of [false, true]) {
    const context = await chromium.launchPersistentContext(profile, {
      headless,
      ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
      viewport: null,
    });
    try {
      const page = context.pages()[0] || await context.newPage();
      const response = await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      const headers = response ? await response.allHeaders() : {};
      const denied = response?.status() === 403;
      const body = denied ? await page.locator('body').innerText() : '';
      console.log(JSON.stringify({
        mode: headless ? 'headless' : 'visible',
        httpStatus: response?.status(),
        origin: new URL(page.url()).origin,
        pathname: new URL(page.url()).pathname,
        pageTitle: await page.title(),
        server: headers.server || null,
        denialReference: denied ? body.match(/Reference\s*#[\w.:-]+/i)?.[0] || null : null,
        result: await inspect(page, response),
      }));
    } finally { await context.close(); }
  }
}

(async () => {
  if (!['open', 'check', 'compare', 'minimized'].includes(mode)) throw new Error('Usage: node scripts/naukri-local-session.cjs open|check|compare|minimized');
  if (mode === 'compare') {
    if (!fs.existsSync(profile)) throw new Error('Open the dedicated browser and sign in first.');
    return compare();
  }
  if (mode === 'check' && !fs.existsSync(profile)) throw new Error('Open the dedicated browser and sign in first.');
  fs.mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    headless: mode === 'check',
    ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    viewport: null,
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    let windowSession, windowId;
    if (mode === 'minimized') {
      windowSession = await context.newCDPSession(page);
      ({ windowId } = await windowSession.send('Browser.getWindowForTarget'));
      await windowSession.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    }
    const response = await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log(JSON.stringify(await inspect(page, response)));
    if (mode === 'minimized') {
      const { bounds } = await windowSession.send('Browser.getWindowBounds', { windowId });
      const screenshot = path.join(profile, '../naukri-minimized-test.png');
      await page.screenshot({ path: screenshot, fullPage: false });
      const after = await windowSession.send('Browser.getWindowBounds', { windowId });
      console.log(JSON.stringify({ httpStatus: response?.status(), windowState: bounds.windowState, afterScreenshot: after.bounds.windowState, screenshot }));
    }
    if (mode === 'open') {
      console.log('Sign in directly on the official Naukri page. Complete OTP/CAPTCHA yourself. Close this dedicated browser window when finished, then run check. No applications are submitted.');
      await new Promise(resolve => context.once('close', resolve));
    }
  } finally { await context.close().catch(() => {}); }
})().catch(error => {
  // Do not emit browser diagnostic logs, session data or credentials.
  console.error(error.message.startsWith('Usage:') || error.message.startsWith('Open the dedicated') ? error.message : 'Browser could not complete the local session test. Close any existing dedicated test window before retrying.');
  process.exitCode = 1;
});
