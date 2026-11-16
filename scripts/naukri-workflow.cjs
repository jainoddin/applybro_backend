// One owner, one existing private browser, one application attempt. No stealth.
const { randomUUID } = require('node:crypto');
const { isNaukriJob, openProfile, syncResume } = require('./naukri-flow.cjs');
const { discover, searchPage } = require('./naukri-discovery.cjs');
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
    this.id = randomUUID(); this.page = page; this.job = job.auto === true ? { auto: true } : { url: job.url, title: job.title.trim(), company: job.company.trim() };
    this.preferences = material.preferences || {};
    this.facts = material.facts; this.resume = { ...material.resume, fileBytes: Buffer.from(material.resume.fileBase64, 'base64') }; delete this.resume.fileBase64;
    if (!this.resume.fileBytes.length || !this.facts?.fullName || !this.facts?.email) throw Error('Save your name, email and actual resume before applying.');
    const browser = require('./cloud-browser.cjs');
    this.ops = { observe: browser.observe, execute: browser.execute, plan: browser.plan, openProfile, syncResume, discover, ...dependencies };
    if (!dependencies.plan && (!process.env.CLOUD_AGENT_MODEL || !(process.env.CLOUD_AGENT_API_KEY || process.env.GEMINI_API_KEYS))) throw Error('Configure CLOUD_AGENT_MODEL and CLOUD_AGENT_API_KEY on the private browser service before starting.');
    this.state = 'READY'; this.events = []; this.history = []; this.version = 0; this.submitted = false; this.uploaded = false; this.steps = 0;
    this.event(this.job.auto ? 'Ready to upload the saved resume and find one suitable live job.' : 'Ready to review ' + this.job.title + ' at ' + this.job.company + '.');
  }
  event(message) { this.message = message; this.events.push({ at: new Date().toISOString(), message }); this.events = this.events.slice(-50); }
  active() { if (terminal.has(this.state)) throw Error('Application stopped.'); }
  start() { if (this.state !== 'READY') return; this.state = 'RUNNING'; this.task = this.run().catch(async e => { if (!terminal.has(this.state)) { this.state = this.submitted ? 'UNKNOWN' : 'FAILED'; const message = /^(Naukri|Sign in|Save target|The task private resume)/.test(String(e.message)) ? String(e.message).slice(0,300) : 'Browser action failed. Inspect the current page; no submission is claimed.'; this.event(this.submitted ? 'Submission result is uncertain. Do not retry automatically.' : message); await this.capture().catch(()=>{}); } }); }
  stop() { if (!terminal.has(this.state)) { this.state = this.submitted ? 'UNKNOWN' : 'STOPPED'; this.event(this.submitted ? 'Stopped after a submission attempt. Verify the portal result before retrying.' : 'Stopped by you. No further controls will be clicked.'); } }
  async capture() {
    this.observation = await this.ops.observe(this.page); this.version++;
    this.preview = await this.page.screenshot({ type: 'jpeg', quality: 65, mask: this.page.frames().map(f => f.locator('input,textarea,select')), timeout: 5000 }).then(b => b.toString('base64')).catch(() => null);
    return this.observation;
  }
  status() { return { id: this.id, status: this.state, message: this.message, job: this.job, steps: this.steps, version: this.version, resume: this.resume.fileName, resumeUploaded: this.uploaded, confirmation: this.confirmation || null, preview: this.preview || null, events: this.events, questions: this.state === 'WAITING_USER' ? (this.observation?.fields || []).filter(f => ['INPUT','TEXTAREA','SELECT'].includes(f.tag) && !['file','password','hidden','checkbox','radio'].includes(f.type) && !/otp|verification|one.time|captcha/i.test(f.label)).map(({ id, label, type, tag, options, required, filled }) => ({ id, label, type, tag, options, required, filled })) : [] }; }
  async pause(reason) { this.state = 'WAITING_USER'; this.event(reason); await this.capture(); }
  async run() {
    // Install the expanded, guarded navigation policy in the existing context.
    // This also supports a locally hot-reloaded verifier without replacing login.
    if (!this.routeInstalled) {
      const { allowNetwork } = require('./cloud-browser.cjs');
      await this.page.context().route('**/*', async route => {
        const request = route.request();
        if (!await allowNetwork(request.url())) return route.abort();
        if (request.isNavigationRequest() && request.frame().parentFrame() === null && !workflowPage(request.url())) return route.abort();
        return route.continue();
      }); this.routeInstalled = true;
    }
    if (!this.uploaded) {
      this.active(); this.event('Opening your signed-in profile and uploading your saved resume.');
      await this.ops.openProfile(this.page); this.active();
      await this.ops.syncResume(this.page, this.resume); this.active(); this.uploaded = true;
      this.event('Naukri confirmed the resume upload.');
    }
      if (this.job.auto) {
        const selected = await this.ops.discover(this.page, this.facts, this.preferences, { active: () => this.active(), event: message => this.event(message) });
        this.active();
        if (!selected) { this.state = 'SKIPPED'; this.event('No eligible native-apply listing found in this bounded search. No application was submitted.'); await this.capture(); return; }
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
      if (!workflowPage(this.page.url())) { await this.pause('Company-site navigation is outside this Naukri pilot. This application was not submitted.'); return; }
      const observation = await this.capture(); this.active();
      if (this.submitted) {
        if (observation.confirmation) { this.confirmation = { text: observation.confirmation, url: this.page.url(), at: new Date().toISOString() }; this.state = 'CONFIRMED'; this.event('Portal submission confirmation observed. One application confirmed.'); return; }
        // A single submit attempt is never replayed if the response is unclear.
        for (let i = 0; i < 10; i++) { await this.page.waitForTimeout(1000); this.active(); const next = await this.capture(); if (next.confirmation) { this.confirmation = { text: next.confirmation, url: this.page.url(), at: new Date().toISOString() }; this.state = 'CONFIRMED'; this.event('Portal submission confirmation observed. One application confirmed.'); return; } }
        this.state = 'UNKNOWN'; this.event('No portal confirmation after the submission attempt. Do not retry this application automatically.'); return;
      }
      if (observation.confirmation) { this.state = 'SKIPPED'; this.event('The page already shows an application confirmation. No new submission was attempted.'); return; }
      if (observation.challenge) { await this.pause('Login, OTP or CAPTCHA needs your action in the private portal. No challenge will be solved automatically.'); return; }
      if (this.steps >= 30) { await this.pause('Action limit reached. Review the page before continuing.'); return; }
      const image = await this.page.screenshot({ type: 'png', mask: this.page.frames().map(f => f.locator('input,textarea,select')) });
      const action = await this.ops.plan(observation, image, this.facts, this.history, this.job); this.active();
      if (action.kind === 'ASK_USER') { await this.pause('A verified answer is needed: ' + String(action.reason || 'Review the current employer question.').slice(0, 300)); return; }
      if (action.kind === 'SKIP') { this.state = 'SKIPPED'; this.event('Job skipped: ' + String(action.reason || 'Not suitable.').slice(0, 300)); return; }
      this.history.push({ kind: action.kind, element: action.element });
      if (this.history.length >= 3 && this.history.slice(-3).every(x => x.kind === action.kind && x.element === action.element)) { await this.pause('The page did not progress after repeated actions. Review it before continuing.'); return; }
      try {
        await this.ops.execute(this.page, observation, action, { facts: this.facts, resume: this.resume, resumeUploaded: this.uploaded, expectedTitle: this.job.title, expectedCompany: this.job.company, reserve: async () => { this.active(); if (this.submitted) throw Error('A submission was already attempted.'); this.submitted = true; this.state = 'SUBMITTING'; this.event('One submission attempt reserved; checking the portal result next.'); }, onUpload: async () => {} });
      } catch {
        if (this.submitted) { this.state = 'UNKNOWN'; this.event('A submission action has an uncertain result. Do not retry automatically.'); return; }
        await this.pause('This control or required question needs review. Nothing is counted as applied.'); return;
      }
      this.steps++; this.event(action.kind + ' completed.'); await this.page.waitForTimeout(1000);
    }
  }
  async answer(body) {
    if (this.state !== 'WAITING_USER' || body.version !== this.version) throw Error('The page changed or is still running. Refresh before answering.');
    if (!Array.isArray(body.answers) || body.answers.length > 20) throw Error('Answer the current fields.');
    const { element } = require('./cloud-browser.cjs');
    const current = await this.ops.observe(this.page);
    for (const answer of body.answers) {
      const old = this.observation.fields.find(f => f.id === answer.id), field = current.fields.find(f => f.id === answer.id);
      if (!old || !field || old.label !== field.label || old.frame !== field.frame || old.type !== field.type || !['INPUT','TEXTAREA','SELECT'].includes(field.tag) || ['file','password','hidden','checkbox','radio'].includes(field.type) || /otp|verification|one.time|captcha/i.test(field.label) || typeof answer.value !== 'string' || !answer.value.trim() || answer.value.length > 2000) throw Error('Choose a current editable question.');
      if (field.tag === 'SELECT') { if (!field.options?.some(o => o.value === answer.value)) throw Error('Choose an available option.'); await element(this.page, field.id, field.frame).selectOption(answer.value); }
      else await element(this.page, field.id, field.frame).fill(answer.value);
    }
    this.history = []; this.steps = 0; this.state = 'READY'; this.event('Your answers were filled. Rechecking the form.'); this.start(); return this.status();
  }
}
module.exports = { OneJob, workflowPage };
