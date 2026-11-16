const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { OneJob, workflowPage } = require('./naukri-workflow.cjs');
const job = { consent: true, url: 'https://www.naukri.com/job-listings-fixture-123', title: 'Frontend Engineer', company: 'Fixture Company' };
const material = { facts: { fullName: 'Fixture Candidate', email: 'fixture@example.invalid' }, resume: { fileName: 'fixture.pdf', mimeType: 'application/pdf', fileBase64: Buffer.from('%PDF fixture').toString('base64') } };
async function fixture(extra = '') {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Frontend Engineer</h1><h2>Fixture Company</h2><form onsubmit="event.preventDefault();window.sent=(window.sent||0)+1;document.querySelector(\'#receipt\').setAttribute(\'role\',\'alert\');document.querySelector(\'#receipt\').textContent=\'Your application has been submitted\'"><label>Email<input name=email type=email required></label>' + extra + '<button type=submit>Apply</button></form><div id=receipt></div></main>' }));
  await page.goto(job.url); return { browser, page };
}
const upload = { openProfile: async () => {}, syncResume: async () => ({ uploaded: true }) };
test('one job uses existing browser, fills known facts and submits once after receipt', async () => {
  const { browser, page } = await fixture();
  try {
    const task = new OneJob(page, material, job, { ...upload, plan: async observation => {
      const email = observation.fields.find(f => f.type === 'email');
      return email.filled ? { kind: 'SUBMIT', element: observation.fields.find(f => f.tag === 'BUTTON').id } : { kind: 'FILL', element: email.id, fact: 'email' };
    } });
    task.start(); await task.task;
    assert.equal(task.state, 'CONFIRMED'); assert.equal(await page.evaluate(() => window.sent), 1);
    assert.equal(await page.locator('[name=email]').inputValue(), material.facts.email);
    assert(task.status().confirmation); assert(!JSON.stringify(task.status()).includes(material.facts.email));
    task.start(); await task.task; assert.equal(await page.evaluate(() => window.sent), 1);
  } finally { await browser.close(); }
});
test('unknown required answer pauses; stale answer fails; verified user answer resumes', async () => {
  const { browser, page } = await fixture('<label>Expected salary<input name=salary required></label>');
  try {
    const task = new OneJob(page, material, job, { ...upload, plan: async observation => {
      const email = observation.fields.find(f => f.type === 'email'), salary = observation.fields.find(f => /salary/.test(f.label));
      if (!email.filled) return { kind: 'FILL', element: email.id, fact: 'email' };
      return !salary.filled ? { kind: 'ASK_USER', reason: 'Expected salary is not in saved facts.' } : { kind: 'SUBMIT', element: observation.fields.find(f => f.tag === 'BUTTON').id };
    } });
    task.start(); await task.task; assert.equal(task.state, 'WAITING_USER');
    assert.equal(await page.evaluate(() => window.sent || 0), 0);
    await assert.rejects(() => task.answer({ version: -1, answers: [] }), /changed/);
    const salary = task.status().questions.find(f => /salary/.test(f.label));
    await task.answer({ version: task.version, answers: [{ id: salary.id, value: '800000' }] }); await task.task;
    assert.equal(task.state, 'CONFIRMED'); assert.equal(await page.evaluate(() => window.sent), 1);
  } finally { await browser.close(); }
});
test('stop while model is planning prevents any pending submission', async () => {
  const { browser, page } = await fixture(); let release, planned;
  const reached = new Promise(resolve => { planned = resolve; });
  try {
    const task = new OneJob(page, material, job, { ...upload, plan: observation => { planned(); return new Promise(resolve => { release = () => resolve({ kind: 'SUBMIT', element: observation.fields.find(f => f.tag === 'BUTTON').id }); }); } });
    task.start(); await reached; task.stop(); release(); await task.task;
    assert.equal(task.state, 'STOPPED'); assert.equal(await page.evaluate(() => window.sent || 0), 0);
  } finally { await browser.close(); }
});
test('navigation never grants arbitrary employer or local URL access', () => {
  for (const url of ['http://www.naukri.com/job-listings-x', 'https://www.naukri.com.evil.example/job-listings-x', 'https://user:secret@www.naukri.com/job-listings-x', 'https://www.naukri.com:444/job-listings-x', 'http://localhost/']) assert.equal(workflowPage(url), false);
  assert.equal(workflowPage(job.url), true); assert.throws(() => OneJob.validate({ ...job, consent: false }));
});
test('automatic mode uploads first, selects a live candidate and applies without a supplied URL', async () => {
  const { browser, page } = await fixture(); let uploaded = false, selected = false;
  try {
    const task = new OneJob(page, material, { auto: true, consent: true }, {
      openProfile: async () => {}, syncResume: async () => { uploaded = true; },
      discover: async () => { assert(uploaded); selected = true; return { url: job.url, title: job.title, company: job.company }; },
      plan: async observation => { const email = observation.fields.find(f => f.type === 'email'); return email.filled ? { kind: 'SUBMIT', element: observation.fields.find(f => f.tag === 'BUTTON').id } : { kind: 'FILL', element: email.id, fact: 'email' }; }
    });
    task.start(); await task.task; assert(selected); assert.equal(task.state, 'CONFIRMED'); assert.equal(await page.evaluate(() => window.sent), 1);
  } finally { await browser.close(); }
});
test('an attempted submission without receipt becomes unknown and is never replayed', async () => {
  const { browser, page } = await fixture();
  try {
    const task = new OneJob(page, material, job, { ...upload,
      plan: async observation => ({ kind: 'SUBMIT', element: observation.fields.find(f => f.tag === 'BUTTON').id }),
      execute: async (_page, _observation, _action, options) => { await options.reserve(); throw Error('Connection lost after dispatch.'); }
    });
    task.start(); await task.task; assert.equal(task.state, 'UNKNOWN'); assert.equal(task.status().confirmation, null);
    task.start(); assert.equal(task.state, 'UNKNOWN');
    await assert.rejects(() => task.answer({ version: task.version, answers: [] }), /changed/);
  } finally { await browser.close(); }
});
