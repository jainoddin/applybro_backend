const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { assess, discover, searchPage } = require('./naukri-discovery.cjs');
const facts = { currentTitle: 'Full Stack Developer', skills: 'React, Node.js, TypeScript, PostgreSQL', experience: '2+ years' };
const preferences = { roles: ['Full Stack Developer'], locations: ['Hyderabad'], threshold: 70 };
const candidate = { title: 'Full Stack Developer', company: 'Fixture Company', location: 'Hyderabad', experience: '2 - 3 years', description: 'Develop applications using React, Node.js, TypeScript and PostgreSQL.' };
test('An eligible native application is preferred over a company redirect without clicking either',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});try{
  const page=await browser.newPage();await page.route('**/*',route=>{const pathname=new URL(route.request().url()).pathname;return route.fulfill({contentType:'text/html',body:pathname.startsWith('/job-listings-')?'<h1>Full Stack Developer</h1><span class="exp">2 - 3 years</span><div data-job-description>React, Node.js, TypeScript and PostgreSQL.</div><button onclick="window.clicked=true">'+(pathname.endsWith('company')?'Apply on company site':'Apply')+'</button>':['company','native'].map(id=>'<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-'+id+'">Full Stack Developer</a><span class="comp-name">Fixture Company</span><span class="locWdth">Hyderabad</span></div>').join('')});});
  const selected=await discover(page,facts,preferences);assert.equal(selected.applyMode,'NATIVE');assert.match(selected.url,/native$/);assert.equal(await page.evaluate(()=>!!window.clicked),false);
 }finally{await browser.close();}
});
test('selection requires matching role, location, experience and actual skill coverage', () => {
  assert.equal(assess(candidate, facts, preferences).suitable, true);
  assert.equal(assess({ ...candidate, experience: '5 - 8 years' }, facts, preferences).suitable, false);
  assert.equal(assess({ ...candidate, title: 'SAP Full Stack Developer' }, facts, preferences).suitable, false);
  assert.equal(assess({ ...candidate, title: 'Full Stack Developer (Go + React)' }, facts, preferences).suitable, false);
  assert.equal(assess({ ...candidate, description: candidate.description + ' Minimum 5 years of professional experience.' }, facts, preferences).suitable, false);
  assert.equal(assess({ ...candidate, location: 'London' }, facts, preferences).suitable, false);
  assert.equal(assess({ ...candidate, experience: '' }, facts, preferences).suitable, false);
  assert.equal(assess(candidate, { ...facts, experience: '' }, preferences).suitable, false);
  assert.equal(searchPage('https://www.naukri.com/full-stack-developer-jobs?k=Full+Stack+Developer'), true);
  assert.equal(searchPage('https://www.naukri.com.evil.example/full-stack-jobs'), false);
});
test('reads live result cards and job details without clicking Apply during discovery', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname.startsWith('/job-listings-') ? '<main><h1>Full Stack Developer</h1><span class="exp">2 - 3 years</span><div data-job-description>Develop applications using React, Node.js, TypeScript and PostgreSQL.</div><button onclick="window.sent=true">Apply</button></main>' : '<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-fixture-123">Full Stack Developer</a><span class="comp-name">Fixture Company</span><span class="locWdth">Hyderabad</span></div>' }));
    const result = await discover(page, facts, preferences);
    assert.equal(result.title, 'Full Stack Developer'); assert.equal(result.score, 100);
    assert.equal(await page.evaluate(() => !!window.sent), false);
  } finally { await browser.close(); }
});
test('Company-site listings are selected without dispatching the application during discovery',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});try{
  const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:new URL(route.request().url()).pathname.startsWith('/job-listings-')?'<h1>Full Stack Developer</h1><span class="exp">2 - 3 years</span><div data-job-description>React, Node.js, TypeScript and PostgreSQL.</div><button onclick="window.clicked=true">Apply on company site</button>':'<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-company-123">Full Stack Developer</a><span class="comp-name">Fixture Company</span><span class="locWdth">Hyderabad</span></div>'}));
  const selected=await discover(page,facts,preferences);assert.equal(selected.applyMode,'COMPANY');assert.equal(await page.evaluate(()=>!!window.clicked),false);
 }finally{await browser.close();}
});
