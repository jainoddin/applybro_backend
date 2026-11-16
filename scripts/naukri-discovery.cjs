const { skillMatch, roleMatches, minimumExperience } = require('../dist/jobs/skill-match');
const origin = 'https://www.naukri.com';
function searchPage(value) {
  try { const u = new URL(value); return u.origin === origin && !u.username && !u.password && /^\/[a-z0-9][a-z0-9-]{1,100}-jobs(?:-in-[a-z0-9-]{1,80})?\/?$/.test(u.pathname); } catch { return false; }
}
function years(value) {
  const match = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:\+?\s*(?:years?|yrs?)|[-–—])/i.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}
function assess(job, facts, preferences) {
  const roles = preferences.roles?.length ? preferences.roles : [facts.currentTitle].filter(Boolean);
  if (!job.title || !job.company || !job.description || !roleMatches(job.title, roles)) return { suitable: false, reason: 'Role does not match the saved profile.' };
  for (const specialty of ['sap', 'salesforce', 'servicenow']) if (new RegExp('\\b' + specialty + '\\b', 'i').test(job.title) && !new RegExp('\\b' + specialty + '\\b', 'i').test(facts.skills || '')) return { suitable: false, reason: 'Specialist role is not supported by the saved skills.' };
  for (const technology of [/\bjava\b/i, /\bpython\b/i, /\bgolang\b|\bgo\b/i, /\bphp\b/i, /\bruby\b/i]) if (technology.test(job.title) && !technology.test(facts.skills || '')) return { suitable: false, reason: 'The role requires a primary technology not in the saved skills.' };
  const candidateYears = years(facts.experience), evidence = [years(job.experience), minimumExperience(job.description)].filter(value => value !== null), requiredYears = evidence.length ? Math.max(...evidence) : null;
  if (candidateYears === null || requiredYears === null || candidateYears < requiredYears) return { suitable: false, reason: 'Experience requirement is unknown or exceeds verified experience.' };
  if (/\b(staff|principal|lead|senior)\b/i.test(job.title) && candidateYears < 5) return { suitable: false, reason: 'Role seniority exceeds the saved experience.' };
  const locations = (preferences.locations || []).map(x => x.toLowerCase());
  if (locations.length && (!job.location || !locations.some(x => job.location.toLowerCase().includes(x)))) return { suitable: false, reason: 'Location does not match saved preferences.' };
  const match = skillMatch(facts.skills || '', job.description);
  if (match.score < (preferences.threshold ?? 70)) return { suitable: false, reason: 'Skill coverage is below the saved threshold.', score: match.score };
  return { suitable: true, score: match.score, reason: 'Role, experience, location and skill coverage passed.' };
}
async function discover(page, facts, preferences = {}, { active = () => {}, event = () => {} } = {}) {
  const visited = new Set();
  const roles = (preferences.roles?.length ? preferences.roles : [facts.currentTitle]).filter(x => typeof x === 'string' && x.trim()).slice(0, 2);
  if (!roles.length || !facts.skills) throw Error('Save target roles, skills and experience before automatic job selection.');
  for (const role of roles) {
    active(); const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    const url = new URL('/' + slug + '-jobs', origin); url.searchParams.set('k', role);
    const knownYears = years(facts.experience); if (knownYears !== null) url.searchParams.set('experience', String(Math.floor(knownYears)));
    const location = (preferences.locations || []).find(x => !/^remote$/i.test(x)); if (location) url.searchParams.set('l', location);
    event('Searching live Naukri listings for ' + role + '.');
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (response?.status() >= 400) throw Error('Naukri denied job search access. No application was submitted.');
    await page.locator('.srp-jobtuple-wrapper,.jobTuple').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}); active();
    const cards = await page.evaluate(() => [...document.querySelectorAll('.srp-jobtuple-wrapper,.jobTuple')].filter(el => el.getClientRects().length).slice(0, 20).map(card => {
      const link = card.querySelector('a.title[href*="job-listings-"]');
      return { url: link?.href || '', title: link?.textContent?.trim() || '', company: card.querySelector('.comp-name')?.textContent?.trim() || '', location: card.querySelector('.locWdth')?.textContent?.trim() || '', experience: card.querySelector('.expwdth,.expWdth')?.textContent?.trim() || '' };
    }));
    const seeds = Array.isArray(preferences.candidates) ? preferences.candidates.slice(0, 3) : [];
    const candidates = [...seeds, ...cards].filter(job => typeof job.url === 'string' && job.url.startsWith(origin + '/job-listings-') && !visited.has(job.url) && roleMatches(job.title, roles) && (years(job.experience) === null || knownYears !== null && years(job.experience) <= knownYears)).slice(0, 8);
    for (const card of candidates) {
      active(); visited.add(card.url); event('Reading ' + card.title + ' at ' + card.company + '.');
      const response = await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response?.status() >= 400) continue;
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}); active();
      await page.locator('button,a,[role=button]').filter({ hasText: /^(apply(?: now)?|apply on company site)$/i }).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {}); active();
      const detail = await page.evaluate(() => {
        const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const text = el => el?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const description = document.querySelector('[class*="dang-inner-html"],.job-desc,.job-description,[data-job-description]');
        const experience = [...document.querySelectorAll('.exp,.expwdth,[class*="exp-wrap"],span,div')].filter(visible).map(text).find(value => /^\d+(?:\.\d+)?\s*(?:[-–—]\s*\d+(?:\.\d+)?)?\+?\s*(?:years?|yrs?)$/i.test(value)) || '';
        const buttons = [...document.querySelectorAll('button,a,[role=button]')].filter(visible).map(text);
        return { title: text(document.querySelector('h1')), description: text(description).slice(0, 20000), experience, nativeApply: buttons.some(value => /^apply(?: now)?$/i.test(value)), alreadyApplied: buttons.some(value => /^applied$/i.test(value)), loginRequired: [...document.querySelectorAll('input[type=password]')].some(visible) };
      });
      const job = { ...card, ...detail, url: page.url() };
      if (job.loginRequired) throw Error('Naukri login expired during discovery.');
      if (!job.nativeApply || job.alreadyApplied) { event(job.alreadyApplied ? 'Skipped: this listing is already applied.' : 'Skipped: no native Apply control; company-site navigation or a changed layout requires its adapter.'); continue; }
      if (job.title.toLowerCase() !== card.title.toLowerCase()) { event('Skipped: listing identity changed.'); continue; }
      const decision = assess(job, facts, preferences);
      event(decision.suitable ? 'Selected live job: ' + job.title + ' at ' + job.company + ' (' + decision.score + '% keyword coverage).' : 'Skipped: ' + decision.reason);
      if (decision.suitable) return { url: job.url, title: job.title, company: job.company, score: decision.score };
    }
  }
  return null;
}
module.exports = { discover, assess, searchPage, years };
