const profileUrl = 'https://www.naukri.com/mnjuser/profile';
function isNaukriJob(value) {
  try { const u = new URL(value); return u.origin === 'https://www.naukri.com' && u.pathname.startsWith('/job-listings-'); }
  catch { return false; }
}

async function profileState(page) {
  if (new URL(page.url()).origin !== 'https://www.naukri.com') return { signedIn: false };
  return page.evaluate(() => {
    const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const login = [...document.querySelectorAll('input[type=password],input[autocomplete=one-time-code]')].some(visible);
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,.widgetHead,.widgetTitle,[role=heading]')]
      .filter(visible).map(el => el.innerText.trim().toLowerCase());
    const sections = ['resume', 'resume headline', 'key skills', 'employment', 'education', 'profile summary'];
    const count = sections.filter(name => headings.some(h => h === name)).length;
    const editable = !!document.querySelector('input[type=file],button[aria-label*="edit" i],.edit');
    return { signedIn: !login && /^\/mnjuser\/profile\/?$/.test(location.pathname) && count >= 2 && editable };
  });
}

async function syncResume(page, resume, { timeout = 20000 } = {}) {
  if (!(await profileState(page)).signedIn) throw Error('Sign in to the private Naukri profile first.');
  const selector = await page.evaluate(() => {
    const files = [...document.querySelectorAll('input[type=file]')];
    const el = files.find(input => {
      const label = [input.id, input.name, input.getAttribute('aria-label'), ...[...(input.labels || [])].map(x => x.innerText)]
        .join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
      return !input.disabled && /resume|\bcv\b/i.test(label) && !/photo|avatar/i.test(label);
    });
    if (!el) return null;
    el.setAttribute('data-applybro-resume-sync', 'true');
    // Require a NEW success notification after our upload, not stale profile text.
    window.__applybroResumeReceipt = false;
    window.__applybroResumeObserver?.disconnect();
    window.__applybroResumeObserver = new MutationObserver(records => {
      for (const record of records) {
        const nodes = [...record.addedNodes, ...(record.type === 'characterData' ? [record.target.parentElement] : [])];
        for (const node of nodes) {
          const text = node?.textContent || '';
          const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
          if (element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && text.length < 700 && /resume (?:has been |was )?(?:uploaded|updated|saved) successfully|successfully (?:uploaded|updated|saved) (?:your )?resume/i.test(text)) window.__applybroResumeReceipt = true;
        }
      }
    });
    window.__applybroResumeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    return '[data-applybro-resume-sync=true]';
  });
  if (!selector) throw Error('Naukri resume upload field was not recognized. Private browser review is required.');
  try {
    await page.locator(selector).setInputFiles({ name: resume.fileName, mimeType: resume.mimeType, buffer: Buffer.from(resume.fileBytes) });
    await page.waitForFunction(name => window.__applybroResumeReceipt === true && document.body.innerText.includes(name), resume.fileName, { timeout });
    if (!(await profileState(page)).signedIn) throw Error('Naukri login expired during resume upload.');
    return { uploaded: true, source: 'APPLYBRO_PRIVATE_RESUME', confirmedBy: 'NEW_PORTAL_UPLOAD_RECEIPT' };
  } catch {
    throw Error('Naukri did not confirm the stored resume upload. No application will be submitted.');
  } finally {
    await page.evaluate(() => { window.__applybroResumeObserver?.disconnect(); delete window.__applybroResumeObserver; delete window.__applybroResumeReceipt; }).catch(() => {});
  }
}

module.exports = { profileUrl, profileState, syncResume, isNaukriJob };
