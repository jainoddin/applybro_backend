const { randomInt } = require('node:crypto');

// A review floor, never a deadline forcing a submission. No bot-detection evasion.
function reviewWindow(env = process.env, choose = randomInt) {
  const seconds = (raw, fallback) => raw === undefined || raw === '' ? fallback : Number(raw);
  const min = seconds(env.CLOUD_AGENT_REVIEW_MIN_SECONDS, 240);
  const max = seconds(env.CLOUD_AGENT_REVIEW_MAX_SECONDS, 480);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 240 || max < min || max > 3600) {
    throw Error('Agent review window must be 240–3600 seconds with max >= min.');
  }
  return choose(min, max + 1) * 1000;
}

async function waitForReview(until, { active, sleep, now = Date.now }) {
  while (now() < until) {
    if (!await active()) return false;
    await sleep(Math.min(1000, until - now()));
  }
  return active();
}

module.exports = { reviewWindow, waitForReview };
