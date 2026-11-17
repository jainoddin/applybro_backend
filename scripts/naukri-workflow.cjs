// One owner, one existing private browser, one application attempt. No stealth.
const { randomUUID } = require('node:crypto');
const { isNaukriJob, openProfile, syncResume } = require('./naukri-flow.cjs');
const { discover, searchPage } = require('./naukri-discovery.cjs');
const { CompanyNavigation, employerIdentity, findEmployerJob } = require('./company-navigation.cjs');
function workflowPage(value) {
  try { const u = new URL(value); return u.origin === 'https://www.naukri.com' && !u.username && !u.password && (/^\/mnjuser\/(homepage|profile)\/?$/.test(u.pathname) || /^\/nlogin(?:\/|$)/.test(u.pathname) || /^\/job-listings-[^/]+$/.test(u.pathname) || /^\/myapply\/saveApply\/?$/.test(u.pathname) || searchPage(value)); }
  catch { return false; }
}
const terminal = new Set(['CONFIRMED', 'UNKNOWN', 'STOPPED', 'FAILED', 'SKIPPED']);
class OneJob {
  static validate(job) {
    if (job?.consent === true && job.auto === true) return;
    if (job?.consent !== true || !isNaukriJob(job.url) || !workflowPage(job.url) || ![job.title, job.company].every(x => typeof x === 'string' && x.trim().length >= 2 && x.length < 180)) throw Error('Choose one Naukri job URL, its title and company, and authorize this application.');
  }
  constructor(page, material, job, dependencies = {}) {
    OneJob.validate(job);
    this.id = randomUUID(); this.page = page; this.job = job.auto === true ? { auto: true } : { url: job.url, title: job.title.trim(), company: job.company.trim(), applyMode: job.applyMode };
    this.navigation = new CompanyNavigation(workflowPage); this.ownedPages = new Set([page]); this.external = false; this.externalIdentity = false; this.naukriUploaded = false; this.controlErrors = 0;
    this.preferences = material.preferences || {};
    this.autoSelection=job.auto===true;this.excludedJobs=[];
    this.facts = material.facts; this.resume = { ...material.resume, fileBytes: Buffer.from(material.resume.fileBase64, 'base64') }; delete this.resume.fileBase64;
    if (!this.resume.fileBytes.length || !this.facts?.fullName || !this.facts?.email) throw Error('Save your name, email and actual resume before applying.');
    const browser = require('./cloud-browser.cjs');
    this.ops = { observe: browser.observe, execute: browser.execute, plan: browser.plan, allowNetwork:browser.allowNetwork, passRoute:route=>route.continue(), openProfile, syncResume, discover, verifyEmployer: employerIdentity, ...dependencies };
    if (!dependencies.plan && (!process.env.CLOUD_AGENT_MODEL || !(process.env.CLOUD_AGENT_API_KEY || process.env.GEMINI_API_KEYS))) throw Error('Configure CLOUD_AGENT_MODEL and CLOUD_AGENT_API_KEY on the private browser service before starting.');
    this.state = 'READY'; this.events = []; this.history = []; this.version = 0; this.submitted = false; this.uploaded = false; this.steps = 0;
    this.event(this.job.auto ? 'Ready to upload the saved resume and find one suitable live job.' : 'Ready to review ' + this.job.title + ' at ' + this.job.company + '.');
  }
  event(message) { this.message = message; this.events.push({ at: new Date().toISOString(), message }); this.events = this.events.slice(-50); }
  active() { if (terminal.has(this.state)) throw Error('Application stopped.'); }
  start() { if (this.state !== 'READY') return; this.state = 'RUNNING'; this.task = this.run().catch(async e => { if (!terminal.has(this.state)) { this.state = this.submitted ? 'UNKNOWN' : 'FAILED'; const message = /^(Naukri|Sign in|Save target|The task private resume)/.test(String(e.message)) ? String(e.message).slice(0,300) : 'Browser action failed. Inspect the current page; no submission is claimed.'; this.event(this.submitted ? 'Submission result is uncertain. Do not retry automatically.' : message); await this.capture().catch(()=>{}); } }); }
  stop() { if (!terminal.has(this.state)) { this.state = this.submitted ? 'UNKNOWN' : 'STOPPED'; this.event(this.submitted ? 'Stopped after a submission attempt. Verify the portal result before retrying.' : 'Stopped by you. No further controls will be clicked.'); } }
  async capture() {
    for(let attempt=0;attempt<3;attempt++){
      try{this.observation=await this.ops.observe(this.page,{allowedUrl:value=>this.navigation.allowed(value),applicationOnly:this.external});break;}
      catch(error){if(attempt===2||!/No readable browser page|Execution context was destroyed|navigation/i.test(String(error.message)))throw error;await this.page.waitForLoadState('domcontentloaded',{timeout:3000}).catch(()=>{});await this.page.waitForTimeout(400);}
    }
    this.version++;
    this.preview = await this.page.screenshot({ type: 'jpeg', quality: 65, mask: this.page.frames().map(f => f.locator('input,textarea,select')), timeout: 5000 }).then(b => b.toString('base64')).catch(() => null);
    return this.observation;
  }
  status() { return { id: this.id, status: this.state, message: this.message, job: this.job, steps: this.steps, version: this.version, resume: this.resume.fileName, resumeUploaded: this.uploaded, receiptSaved:this.receiptSaved===true, employerOrigin:this.external?new URL(this.page.url()).origin:null, confirmation: this.confirmation || null, preview: this.preview || null, events: this.events, questions: this.state === 'WAITING_USER' && (!this.external||this.externalIdentity) ? (this.observation?.fields || []).filter(f => ['INPUT','TEXTAREA','SELECT'].includes(f.tag) && !['file','password','hidden','radio'].includes(f.type) && !/otp|verification|one.time|captcha/i.test(f.label)).map(({ id, label, type, tag, options, required, filled }) => ({ id, label, type, tag, options, required, filled })) : [] }; }
  async pause(reason) { this.state = 'WAITING_USER'; this.event(reason); await this.capture(); }
  async saveReceipt(){if(this.state!=='CONFIRMED'||this.receiptSaved||!this.ops.onConfirmed)return;try{const result=await this.ops.onConfirmed({taskId:this.id,job:this.job,confirmation:this.confirmation});this.receiptSaved=result?.recorded===true;if(this.receiptSaved)this.event('Verified application receipt saved to your dashboard.');}catch{this.event('Employer confirmation received; dashboard receipt could not be saved yet. Refresh task to retry recording, without reapplying.');}}
  async confirmed(observation){const url=new URL(this.page.url());this.confirmation={text:observation.confirmation,url:url.origin+url.pathname,at:new Date().toISOString()};this.state='CONFIRMED';this.event('Portal submission confirmation observed. One application confirmed.');await this.saveReceipt();}
  async settle(observation){if(!this.submitted)return false;if(observation.submissionError){this.state='FAILED';this.event('Employer reported a submission error: '+observation.submissionError+' No successful application is confirmed.');return true;}if(observation.confirmation){if(/^Applied to\b/i.test(observation.confirmation)){const match=/^Applied to\s+["“]([^"”\n]+)["”]$/i.exec(observation.confirmation),normalize=value=>String(value).replace(/\s+/g,' ').trim().toLowerCase();if(!match||normalize(match[1])!==normalize(this.job.title)){this.state='UNKNOWN';this.event('Portal receipt does not match the selected job title. No application is counted.');return true;}}await this.confirmed(observation);return true;}return false;}
  async refreshOutcome(){if(this.submitted&&this.state==='UNKNOWN')await this.settle(await this.capture());}
  async companyHandoff(observation) {
    if(this.external||this.page.url()!==this.job.url||!await this.ops.verifyEmployer(this.page,this.job))throw Error('Company handoff listing identity could not be verified.');
    const controls=observation.fields.filter(f=>['BUTTON','A'].includes(f.tag)&&/^apply on company site$/i.test(f.label.trim()));
    if(controls.length!==1)throw Error('Company application entry is ambiguous.');
    this.navigation.begin(this.page.url());this.pendingPages=[];this.unverifiedCompanyPage=null;const source=this.page;const existingPages=new Set(source.context().pages());this.event('Opening the selected job on its company website. No application submitted yet.');
    const {element}=require('./cloud-browser.cjs');
    try {
      await element(source,controls[0].id,controls[0].frame).click({timeout:10000});
      for(let attempt=0;attempt<40;attempt++){
        const created=source.context().pages().filter(p=>!existingPages.has(p));
        const candidates=[...new Set([source,...this.pendingPages,...created])].filter(p=>!p.isClosed()&&/^https:/.test(p.url())&&!['www.naukri.com','naukri.com'].includes(new URL(p.url()).hostname));
        for(const candidate of candidates){
          // A popup can become observable without an intercepted initial navigation
          // (for example a cached page). Bind its actual public URL to this handoff.
          if(!this.navigation.allowed(candidate.url())&&(!await this.ops.allowNetwork(candidate.url())||!this.navigation.permitNavigation(candidate.url(),'GET')))continue;
          await candidate.waitForLoadState('domcontentloaded',{timeout:1000}).catch(()=>{});this.navigation.enrollFrames(candidate);if(await this.ops.verifyEmployer(candidate,this.job)){this.page=candidate;if(this.ops.onPage)this.ops.onPage(candidate);this.externalIdentity=true;break;}
          this.unverifiedCompanyPage=candidate;
        }
        if(this.externalIdentity)break;
        await source.waitForTimeout(300);
      }
    } finally { this.navigation.finish(); }
    if(!this.externalIdentity&&this.unverifiedCompanyPage){this.page=this.unverifiedCompanyPage;if(this.ops.onPage)this.ops.onPage(this.page);}
    if(['www.naukri.com','naukri.com'].includes(new URL(this.page.url()).hostname))throw Error('Company website did not open. The Naukri redirect acknowledgement is not an application receipt.');
    this.external=true;this.uploaded=false;
    if(!this.navigation.allowed(this.page.url()))throw Error('Company website redirected outside the verified handoff.');
    await this.page.locator('h1,h2').first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
    for(let attempt=0;attempt<8;attempt++){this.navigation.enrollFrames(this.page);this.externalIdentity=await this.ops.verifyEmployer(this.page,this.job);if(this.externalIdentity)break;await this.page.waitForTimeout(500);}
    if(!this.externalIdentity)this.externalIdentity=await findEmployerJob(this.page,this.job,this.navigation,{verify:this.ops.verifyEmployer,onVisit:label=>this.event('Reading company careers link: '+label+'. No applicant information sent yet.')});
    if(!this.externalIdentity)throw Error('Company website has no verified matching job form in its careers links. No resume was sent and no application was submitted.');
    this.event('Company job identity verified. Reading its application form.');
  }
  async run() {
    // Install the expanded, guarded navigation policy in the existing context.
    // This also supports a locally hot-reloaded verifier without replacing login.
    if (!this.routeInstalled) {
      await this.page.context().route('**/*', async route => {
        const request = route.request();
        if (!await this.ops.allowNetwork(request.url())) return route.abort();
        let frame;try{frame=request.frame();}catch{}
        if (request.isNavigationRequest() && (!frame||frame.parentFrame() === null)) {
          const candidate=frame?.page();let owned=candidate?this.ownedPages.has(candidate):!!this.navigation.handoff;
          if(candidate&&!owned&&this.navigation.handoff){const opener=await candidate.opener();if(!opener||this.ownedPages.has(opener)){this.ownedPages.add(candidate);owned=true;}}
          if(!owned||!this.navigation.permitNavigation(request.url(),request.method()))return route.abort();
        }
        return this.ops.passRoute(route);
      }); this.routeInstalled = true;
      this.page.context().on('page',async popup=>{
        const opener=await popup.opener();if(!this.navigation.handoff||terminal.has(this.state)||opener&&!this.ownedPages.has(opener))return;
        this.ownedPages.add(popup);(this.pendingPages||=[]).push(popup);
      });
    }
    if (!this.naukriUploaded) {
      this.active(); this.event('Opening your signed-in profile and uploading your saved resume.');
      await this.ops.openProfile(this.page); this.active();
      await this.ops.syncResume(this.page, this.resume); this.active(); this.uploaded = true;
      this.naukriUploaded=true;this.event('Naukri confirmed the resume upload.');
    }
      if (this.job.auto) {
        const selected = await this.ops.discover(this.page, this.facts, this.preferences, { active: () => this.active(), event: message => this.event(message),excluded:this.excludedJobs });
        this.active();
        if (!selected) { this.state = 'SKIPPED'; this.event('No eligible application listing found in this bounded search. No application was submitted.'); await this.capture(); return; }
        this.job = selected;
      }
      if (!this.jobOpened) {
        if (this.page.url() !== this.job.url) {
          const response = await this.page.goto(this.job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          if (response?.status() >= 400) throw Error('Portal rejected the job page.');
        }
        this.jobOpened = true;
      }
    while (!terminal.has(this.state) && this.state !== 'WAITING_USER') {
      this.active();
      if (!this.navigation.allowed(this.page.url())) { await this.pause('Company navigation is outside the selected application. No submission is claimed.'); return; }
      const observation = await this.capture(); this.active();
      if(!this.external&&observation.fields.some(f=>/^apply on company site$/i.test(f.label.trim()))&&!observation.fields.some(f=>/^apply$/i.test(f.label.trim()))){
        try{await this.companyHandoff(observation);}catch(e){
          if(this.autoSelection&&!this.submitted&&/no verified matching job form/.test(String(e.message))&&this.excludedJobs.length<2){
            const source=[...this.ownedPages].find(p=>!p.isClosed()&&new URL(p.url()).hostname==='www.naukri.com');
            if(source){this.excludedJobs.push(this.job.url);this.event('Skipped company homepage without a matching application form. Checking another eligible listing.');this.page=source;this.external=false;this.externalIdentity=false;this.uploaded=this.naukriUploaded;this.job={auto:true};this.jobOpened=false;this.history=[];this.steps=0;if(this.ops.onPage)this.ops.onPage(source);return this.run();}
          }
          await this.pause(String(e.message));return;
        }continue;
      }
      if(this.external&&!this.externalIdentity){await this.pause('Company identity needs verification before entering your information.');return;}
      if (this.submitted) {
        if (await this.settle(observation)) return;
        // A single submit attempt is never replayed if the response is unclear.
        for (let i = 0; i < 10; i++) { await this.page.waitForTimeout(1000); this.active(); const next = await this.capture(); if (await this.settle(next))return; }
        this.state = 'UNKNOWN'; this.event('No portal confirmation after the submission attempt. Do not retry this application automatically.'); return;
      }
      if (observation.confirmation) { this.state = 'SKIPPED'; this.event('The page already shows an application confirmation. No new submission was attempted.'); return; }
      if (observation.challenge) { await this.pause('Login, OTP or CAPTCHA needs your action in the private portal. No challenge will be solved automatically.'); return; }
      if(this.external&&this.externalIdentity){
        const position=observation.fields.find(f=>f.tag==='SELECT'&&!f.filled&&/\b(position|role|job)\b/i.test(f.label)&&f.options?.some(o=>o.text.trim().toLowerCase()===this.job.title.toLowerCase()));
        if(position){const option=position.options.find(o=>o.text.trim().toLowerCase()===this.job.title.toLowerCase());await require('./cloud-browser.cjs').element(this.page,position.id,position.frame).selectOption(option.value);this.steps++;this.event('Selected the verified job title in the employer application.');continue;}
        const upload=observation.fields.find(f=>f.type==='file'&&/resume|\bcv\b/i.test(f.label)&&!/cover|photo|avatar/i.test(f.label));
        if(!this.uploaded&&upload){await this.ops.execute(this.page,observation,{kind:'UPLOAD',element:upload.id},{facts:this.facts,resume:this.resume,allowedUrl:value=>this.navigation.allowed(value),applicationOnly:true,onUpload:async()=>{this.uploaded=true;}});this.steps++;this.event('Original saved resume attached to the verified employer application.');continue;}
      }
      if (this.steps >= 30) { await this.pause('Action limit reached. Review the page before continuing.'); return; }
      const image = await this.page.screenshot({ type: 'png', mask: this.page.frames().map(f => f.locator('input,textarea,select')) });
      const submitButtons=observation.fields.filter(f=>f.tag==='BUTTON'&&/^submit (?:my )?application$/i.test(f.label.trim()));
      const complete=this.external&&this.externalIdentity&&this.uploaded&&submitButtons.length===1&&!observation.fields.some(f=>f.required&&!f.filled&&['INPUT','TEXTAREA','SELECT'].includes(f.tag));
      const action = complete ? {kind:'SUBMIT',element:submitButtons[0].id} : await this.ops.plan(observation, image, this.facts, this.history, this.job); this.active();
      if (action.kind === 'ASK_USER') { await this.pause('A verified answer is needed: ' + String(action.reason || 'Review the current employer question.').slice(0, 300)); return; }
      if (action.kind === 'SKIP') { this.state = 'SKIPPED'; this.event('Job skipped: ' + String(action.reason || 'Not suitable.').slice(0, 300)); return; }
      this.history.push({ kind: action.kind, element: action.element });
      if (this.history.length >= 3 && this.history.slice(-3).every(x => x.kind === action.kind && x.element === action.element)) { await this.pause('The page did not progress after repeated actions. Review it before continuing.'); return; }
      try {
        await this.ops.execute(this.page, observation, action, { facts: this.facts, resume: this.resume, resumeUploaded: this.uploaded, expectedTitle: this.job.title, expectedCompany: this.job.company, allowedUrl:value=>this.navigation.allowed(value), verifyIdentity:()=>this.ops.verifyEmployer(this.page,this.job), applicationOnly:this.external, reserve: async () => { this.active(); if (this.submitted) throw Error('A submission was already attempted.'); this.submitted = true; this.state = 'SUBMITTING'; this.event('One submission attempt reserved; checking the portal result next.'); }, onUpload: async () => {this.uploaded=true;this.event('Stored resume attached to the company application form.');} });
        this.controlErrors=0;
      } catch(e) {
        if (this.submitted) { this.state = 'UNKNOWN'; this.event('A submission action has an uncertain result. Do not retry automatically.'); return; }
        const reason=/^(The page changed|This |The current |Non-button |Unrelated |No recognized |Some required |Required |Verification |Company |Only )/.test(String(e.message))?String(e.message).slice(0,220):'This control or required question needs review.';
        this.history.push({kind:'VALIDATION_ERROR',reason});
        if(++this.controlErrors<3&&/page changed|Unrelated page|explicit submission|No recognized submission/i.test(reason)){this.event('Rechecking a changed or incorrectly identified control before acting.');continue;}
        await this.pause(reason+' Nothing is counted as applied.'); return;
      }
      this.steps++; this.event(action.kind + ' completed.'); await this.page.waitForTimeout(1000);
    }
  }
  async answer(body) {
    if (this.state !== 'WAITING_USER' || body.version !== this.version) throw Error('The page changed or is still running. Refresh before answering.');
    if (!Array.isArray(body.answers) || body.answers.length > 20) throw Error('Answer the current fields.');
    const { element } = require('./cloud-browser.cjs');
    if(this.external&&!this.externalIdentity)throw Error('Verify the selected employer before answering.');
    const current = await this.ops.observe(this.page,{allowedUrl:value=>this.navigation.allowed(value),applicationOnly:this.external});
    for (const answer of body.answers) {
      const old = this.observation.fields.find(f => f.id === answer.id), field = current.fields.find(f => f.id === answer.id);
      if (!old || !field || old.label !== field.label || old.frame !== field.frame || old.type !== field.type || !['INPUT','TEXTAREA','SELECT'].includes(field.tag) || ['file','password','hidden','radio'].includes(field.type) || /otp|verification|one.time|captcha/i.test(field.label) || typeof answer.value !== 'string' || !answer.value.trim() || answer.value.length > 2000) throw Error('Choose a current editable question.');
      if(field.type==='checkbox'){if(!['true','false'].includes(answer.value))throw Error('Choose whether to check this employer option.');await element(this.page,field.id,field.frame).setChecked(answer.value==='true');}
      else if (field.tag === 'SELECT') { if (!field.options?.some(o => o.value === answer.value)) throw Error('Choose an available option.'); await element(this.page, field.id, field.frame).selectOption(answer.value); }
      else await element(this.page, field.id, field.frame).fill(answer.value);
    }
    this.history = []; this.steps = 0; this.state = 'READY'; this.event('Your answers were filled. Rechecking the form.'); this.start(); return this.status();
  }
}
module.exports = { OneJob, workflowPage };
