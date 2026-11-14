import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Browser, Page, chromium } from 'playwright';

const LOGIN_URL = 'https://www.naukri.com/nlogin/login';
const PROFILE_URL = 'https://www.naukri.com/mnjuser/profile';
const EMAIL = 'input[type=email]:visible,input[name=email]:visible,input[placeholder*="email" i]:visible,input[name=username]:visible';
const PASSWORD = 'input[type=password]:visible';
type Session = { browser: Browser; page: Page; expiresAt: number; timer: NodeJS.Timeout; ready: boolean; attempts: number };

// Independent login diagnostic. No database, agent queue, cookie vault or AI calls.
@Injectable()
export class NaukriTestService implements OnModuleDestroy {
  private sessions = new Map<string, Session>();
  private busy = new Set<string>();
  private opening = 0;
  private launch = () => chromium.launch({ headless: true,
    ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });

  private enabled() {
    if (process.env.NAUKRI_LOGIN_TEST_ENABLED !== 'true') throw new ServiceUnavailableException('The standalone login test is not enabled on this server.');
  }
  private async locked<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    this.enabled();
    if (this.busy.has(owner)) throw new ConflictException('A login test action is already running.');
    this.busy.add(owner);
    try { return await fn(); } finally { this.busy.delete(owner); }
  }
  private async destroy(owner: string, expected?: Session) {
    const session = this.sessions.get(owner);
    if (!session || expected && session !== expected) return;
    this.sessions.delete(owner); clearTimeout(session.timer);
    await session.browser.close().catch(() => {});
  }
  private current(owner: string) {
    const session = this.sessions.get(owner);
    if (!session || session.expiresAt <= Date.now()) throw new BadRequestException('This private test expired. Check access again.');
    if (new URL(session.page.url()).origin !== 'https://www.naukri.com') throw new BadRequestException('The browser is not on the official Naukri site.');
    return session;
  }
  async start(owner: string) {
    return this.locked(owner, async () => {
      await this.destroy(owner);
      if (this.sessions.size + this.opening >= 3) throw new ServiceUnavailableException('Test browser capacity reached. Try again later.');
      this.opening++;
      let browser: Browser;
      try {
        browser = await this.launch();
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame().parentFrame() === null && new URL(request.url()).origin !== 'https://www.naukri.com') return route.abort();
          return route.continue();
        });
        const page = await context.newPage();
        const response = await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (response && response.status() >= 400) {
          await browser.close();
          return { status: 'BLOCKED', httpStatus: response.status(), url: LOGIN_URL,
            message: `Naukri returned HTTP ${response.status()} before login. No credentials were requested or entered.` };
        }
        const ready = await page.locator(EMAIL).count() > 0 && await page.locator(PASSWORD).count() > 0;
        if (!ready) {
          await browser.close();
          return { status: 'FORM_UNAVAILABLE', message: 'An email/password login form was not detected. No login is claimed.' };
        }
        const session = { browser, page, ready: true, attempts: 0, expiresAt: Date.now() + 300000 } as Session;
        session.timer = setTimeout(() => { void this.destroy(owner, session); }, 300000);
        session.timer.unref(); this.sessions.set(owner, session);
        return { status: 'READY', url: LOGIN_URL, expiresAt: session.expiresAt,
          message: 'The official Naukri login form is available. Credentials will be used only in this temporary browser.' };
      } catch {
        await browser?.close().catch(() => {});
        throw new ServiceUnavailableException('The independent browser test could not load Naukri. No login was performed.');
      } finally { this.opening--; }
    });
  }
  async login(owner: string, email: string, password: string) {
    return this.locked(owner, async () => {
      const session = this.current(owner);
      if (!session.ready || session.attempts >= 3) throw new BadRequestException('Check access again before another login attempt.');
      session.attempts++;
      try {
        await session.page.locator(EMAIL).first().fill(email, { timeout: 3000 });
        await session.page.locator(PASSWORD).first().fill(password, { timeout: 3000 });
        this.current(owner);
        await session.page.getByRole('button', { name: /^(log ?in|sign in)$/i }).first().click({ timeout: 5000 });
        // Let the real portal respond. No fabricated token or inferred account identity.
        await session.page.waitForTimeout(2000);
        const challenge = await session.page.locator('input[autocomplete=one-time-code]:visible,input[name*=otp i]:visible,iframe[src*=recaptcha]:visible,iframe[src*=hcaptcha]:visible').count();
        if (challenge) {
          await this.destroy(owner);
          return { status: 'VERIFICATION_REQUIRED', message: 'Naukri requires manual OTP/CAPTCHA verification. This prototype does not complete that step or claim login success.' };
        }
        const response = await session.page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && response.status() >= 400) {
          await this.destroy(owner);
          return { status: 'BLOCKED', httpStatus: response.status(), message: 'The portal denied the profile check. Account identity was not verified.' };
        }
        const account = await session.page.evaluate(() => {
          const visible = (el: Element) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
          const headings = [...document.querySelectorAll('h1,h2,h3,.widgetHead,[role=heading]')].filter(visible).map(el => el.textContent.trim().toLowerCase());
          const sections = ['resume', 'key skills', 'employment', 'education', 'profile summary'].filter(name => headings.includes(name)).length;
          const signedIn = /^\/mnjuser\/profile\/?$/.test(location.pathname) && sections >= 2 &&
            !!document.querySelector('input[type=file],.edit,button[aria-label*=edit i]') && ![...document.querySelectorAll('input[type=password]')].some(visible);
          const name = [...document.querySelectorAll('[data-field=name],.user-name,.userName,.name,h1')].find(visible)?.textContent?.trim().slice(0,120) || null;
          return { signedIn, name: signedIn ? name : null };
        });
        this.current(owner);
        if (!account.signedIn) return { status: 'NOT_SIGNED_IN', message: 'A protected editable profile was not observed. Login is not confirmed.' };
        await this.destroy(owner);
        return { status: 'SIGNED_IN', account: { name: account.name }, message: 'A signed-in profile was observed. The temporary browser has been closed; no password or reusable session was saved.' };
      } catch {
        await this.destroy(owner);
        throw new ServiceUnavailableException('Login could not be confirmed. The temporary browser was closed.');
      } finally {
        // Never retain credentials on the service, in a database, or in logs.
        password = ''; email = '';
        if (this.sessions.get(owner) === session) await session.page.locator(PASSWORD).fill('', { timeout: 500 }).catch(() => {});
      }
    });
  }
  async close(owner: string) { await this.destroy(owner); return { closed: true }; }
  async onModuleDestroy() { await Promise.all([...this.sessions.keys()].map(owner => this.destroy(owner))); }
}
