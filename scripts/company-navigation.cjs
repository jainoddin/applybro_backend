// Per-application trust. A company destination is learned only from an explicit,
// verified listing handoff. Network/DNS checks remain mandatory in the runner.
const { publicAddress } = require('../dist/agent/agent-policy');
const { isIP } = require('node:net');
function publicHttps(value) {
 try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && !['localhost','localhost.localdomain'].includes(u.hostname) && !u.hostname.endsWith('.localhost') && (!isIP(u.hostname.replace(/^\[|\]$/g,'')) || publicAddress(u.hostname.replace(/^\[|\]$/g,''))); } catch { return false; }
}
class CompanyNavigation {
 constructor(naukriPage) { this.naukriPage = naukriPage; this.origins = new Set(); this.handoff = null; }
 allowed(value) { return this.naukriPage(value) || publicHttps(value) && this.origins.has(new URL(value).origin); }
 begin(source) { if (!this.naukriPage(source) || !/^\/job-listings-/.test(new URL(source).pathname)) throw Error('Company handoff must start on the selected Naukri listing.'); this.handoff = { until: Date.now()+20000, hops: 0 }; }
 permitNavigation(value,method='GET') {
  if(this.allowed(value))return true;
  if(method!=='GET'||!publicHttps(value)||!this.handoff||this.handoff.until<Date.now()||this.handoff.hops>=5)return false;
  this.handoff.hops++;this.origins.add(new URL(value).origin);return true;
 }
 finish() { this.handoff=null; }
 enrollFrames(page) { for(const frame of page.frames())if(knownATS(frame.url()))this.origins.add(new URL(frame.url()).origin); }
}
function knownATS(value){if(!publicHttps(value))return false;const host=new URL(value).hostname;return ['job-boards.greenhouse.io','boards.greenhouse.io','boards.eu.greenhouse.io','jobs.lever.co','jobs.eu.lever.co','jobs.ashbyhq.com','apply.workable.com'].includes(host)||host.endsWith('.myworkdayjobs.com');}
async function employerIdentity(page,job) {
 const evidence=[];
 for(const frame of page.frames().filter(f=>f===page.mainFrame()||knownATS(f.url())))try{evidence.push(await frame.evaluate(({title,company})=>{
  const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const words=normalize(title).split(' ').filter(w=>w.length>2),brand=normalize(company);
  const headings=[...document.querySelectorAll('h1,h2,h3,[data-automation-id="jobPostingHeader"], [data-qa="posting-name"]')].filter(visible).map(e=>normalize(e.textContent));
  const titleMatches=words.length&&headings.some(h=>words.filter(w=>h.includes(w)).length/words.length>=0.7);
  const body=normalize(document.body.innerText).slice(0,50000),host=normalize(location.hostname).replace(/ /g,''),brandHost=brand.replace(/ /g,'');
  const logos=[...document.querySelectorAll('img[alt]')].filter(visible).map(e=>normalize(e.alt));
  const companyMatches=brand.length>=3&&(body.includes(brand)||logos.some(t=>t.includes(brand))||brandHost.length>=5&&host.includes(brandHost));
  return {titleMatches:!!titleMatches,companyMatches:!!companyMatches};
 },{title:job.title,company:job.company}));}catch{}
 return evidence.some(e=>e.titleMatches)&&evidence.some(e=>e.companyMatches);
}
// Read-only discovery: never send applicant facts to a generic company homepage.
// Follow actual same-origin careers links only; the application still needs full identity verification.
async function findEmployerJob(page,job,navigation,{verify=employerIdentity,onVisit=()=>{}}={}) {
 const visited=new Set();const origin=new URL(page.url()).origin;
 for(let hop=0;hop<3;hop++){
  if(await verify(page,job))return true;
  visited.add(page.url());
  const links=await page.locator('a[href]').evaluateAll((anchors,title)=>{
   const words=title.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);
   return anchors.filter(a=>a.getClientRects().length).map(a=>{const text=(a.innerText||a.getAttribute('aria-label')||'').trim();const lower=text.toLowerCase();return {url:a.href,text,score:words.length&&words.filter(w=>lower.includes(w)).length/words.length>=0.7?2:/^(careers?|jobs?|open positions|job openings|join (our team|us))$/i.test(text)?1:0};}).filter(a=>a.score).sort((a,b)=>b.score-a.score);
  },job.title);
  const next=links.find(link=>publicHttps(link.url)&&new URL(link.url).origin===origin&&navigation.allowed(link.url)&&!visited.has(link.url));
  if(!next)return false;
  onVisit(next.text);await page.goto(next.url,{waitUntil:'domcontentloaded',timeout:20000});
  navigation.enrollFrames(page);
 }
 return verify(page,job);
}
module.exports={CompanyNavigation,publicHttps,employerIdentity,knownATS,findEmployerJob};
