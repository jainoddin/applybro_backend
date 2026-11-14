const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewWindow, waitForReview } = require('./agent-pacing.cjs');
test('review window covers four to eight minutes inclusive', () => {
  assert.equal(reviewWindow({}, min => min), 240000);
  assert.equal(reviewWindow({}, (_, exclusiveMax) => exclusiveMax - 1), 480000);
  assert.throws(() => reviewWindow({ CLOUD_AGENT_REVIEW_MIN_SECONDS: '0' }));
  assert.throws(() => reviewWindow({ CLOUD_AGENT_REVIEW_MAX_SECONDS: '120' }));
});
test('review waits with bounded checks and permits slower forms', async () => {
  let clock = 0, checks = 0;
  const options = { now: () => clock, active: async () => { checks++; return true; },
    sleep: async ms => { assert.ok(ms <= 1000); clock += ms; } };
  assert.equal(await waitForReview(5000, options), true);
  assert.equal(clock, 5000);
  assert.ok(checks >= 5);
  clock = 9000;
  assert.equal(await waitForReview(5000, options), true);
  assert.equal(clock, 9000);
});
test('stop or revoked consent interrupts review without permission to submit', async () => {
  let slept = false;
  assert.equal(await waitForReview(5000, { now: () => 0, active: async () => false,
    sleep: async () => { slept = true; } }), false);
  assert.equal(slept, false);
});
