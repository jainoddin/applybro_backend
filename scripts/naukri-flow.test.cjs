const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { profileState, syncResume, profileUrl, isNaukriJob } = require('./naukri-flow.cjs');
const { observe, execute } = require('./cloud-browser.cjs');
const resume = { fileName: 'fixture-resume.pdf', mimeType: 'application/pdf', fileBytes: Buffer.from('%PDF-fixture-only') };
async function fixture(html, url = profileUrl) {
  const executablePath = process.env.CLOUD_AGENT_CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '');
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(url);
  return { browser, page };
}
const profile = '<h2>Resume</h2><h2>Key Skills</h2><label>Resume<input id="attachCV" type="file"></label><div id="filename"></div>';
test('only exact HTTPS Naukri job URLs enter the native flow', () => {
  assert.ok(isNaukriJob('https://www.naukri.com/job-listings-fixture-123'));
  for (const value of ['https://www.naukri.com.attacker.invalid/job-listings-123', 'http://www.naukri.com/job-listings-123', profileUrl]) assert.equal(isNaukriJob(value), false);
});
test('a profile URL alone does not prove sign-in and visible password blocks it', async () => {
  const { browser, page } = await fixture('<h2>Resume</h2><input type="password"><input type="file">');
  try { assert.equal((await profileState(page)).signedIn, false); }
  finally { await browser.close(); }
});
test('uploads the stored resume and requires a fresh visible portal receipt and filename', async () => {
  const { browser, page } = await fixture(profile + '<script>document.querySelector("input").addEventListener("change",e=>{document.querySelector("#filename").textContent=e.target.files[0].name; const el=document.createElement("div");el.textContent="Resume uploaded successfully";document.body.append(el);});</script>');
  try {
    assert.equal((await profileState(page)).signedIn, true);
    assert.equal((await syncResume(page, resume, { timeout: 1000 })).uploaded, true);
    assert.equal(await page.locator('input').evaluate(el => el.files[0].name), resume.fileName);
  } finally { await browser.close(); }
});
test('stale success text is not accepted as a new upload receipt', async () => {
  const { browser, page } = await fixture(profile + '<div>Resume uploaded successfully</div><script>document.querySelector("input").addEventListener("change",e=>document.querySelector("#filename").textContent=e.target.files[0].name);</script>');
  try { await assert.rejects(syncResume(page, resume, { timeout: 200 }), /did not confirm/); }
  finally { await browser.close(); }
});
test('a new receipt with the wrong resume filename never permits native Apply', async () => {
  const { browser, page } = await fixture(profile + '<script>document.querySelector("input").addEventListener("change",()=>{document.querySelector("#filename").textContent="other.pdf";const el=document.createElement("div");el.textContent="Resume uploaded successfully";document.body.append(el);});</script>');
  try { await assert.rejects(syncResume(page, resume, { timeout: 200 }), /did not confirm/); }
  finally { await browser.close(); }
});
test('Naukri company-site entry navigates without consuming a submission reservation', async () => {
  const { browser, page } = await fixture('<main><h1>Frontend Engineer</h1><button onclick="window.navigated=true">Apply on company site</button></main>', 'https://www.naukri.com/job-listings-fixture-123');
  try {
    const obs = await observe(page), field = obs.fields.find(f => f.tag === 'BUTTON');
    await execute(page, obs, { kind: 'CLICK', element: field.id }, { facts: {}, resume, reserve: async () => { throw Error('must not reserve'); } });
    assert.equal(await page.evaluate(() => window.navigated), true);
  } finally { await browser.close(); }
});
test('native Apply still requires verified resume, eligibility reservation, and employer confirmation', async () => {
  const { browser, page } = await fixture('<main><h1>Frontend Engineer</h1><button onclick="document.querySelector(\'.postApply-message\').textContent=\'Successfully applied\'">Apply</button><div class="postApply-message"></div></main>', 'https://www.naukri.com/job-listings-fixture-123');
  try {
    let obs = await observe(page), field = obs.fields.find(f => f.tag === 'BUTTON'), reserved = 0;
    const action = { kind: 'SUBMIT', element: field.id };
    await assert.rejects(execute(page, obs, action, { facts: {}, resume, reserve: async () => { reserved++; } }), /resume/);
    assert.equal(reserved, 0);
    await execute(page, obs, action, { facts: {}, resume, resumeUploaded: true, expectedTitle: 'Frontend Engineer', reserve: async () => { reserved++; } });
    assert.equal(reserved, 1);
    assert.match((await observe(page)).confirmation, /successfully applied/i);
  } finally { await browser.close(); }
});
