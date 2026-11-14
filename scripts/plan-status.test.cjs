const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trialEnd, planStatus } = require('../dist/auth/plan-status');
const { AuthService } = require('../dist/auth/auth.service');
test('trial is exactly seven days and expiry is inclusive at zero', () => {
  const start = new Date('2026-11-13T00:00:00Z');
  const end = trialEnd(start);
  assert.equal(end.toISOString(), '2026-11-20T00:00:00.000Z');
  const trial = { planName: 'FREE_TRIAL', active: true, trialEnds: end, createdAt: start };
  assert.equal(planStatus(trial, start).remainingSeconds, 7 * 86400);
  assert.equal(planStatus(trial, new Date(end.getTime() - 1000)).status, 'TRIAL');
  const expired = planStatus(trial, end);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.canUsePlan, false);
  assert.equal(expired.renewalRequired, true);
  assert.equal(planStatus(trial, new Date(end.getTime() + 86400000)).remainingSeconds, 0);
});
test('paid and inactive plans obey their database period end too', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const paid = { planName: 'PREMIUM', active: true, trialEnds: new Date('2026-12-02T00:00:00Z') };
  assert.equal(planStatus(paid, now).status, 'ACTIVE');
  assert.equal(planStatus({ ...paid, trialEnds: now }, now).status, 'EXPIRED');
  assert.equal(planStatus({ ...paid, active: false }, now).status, 'INACTIVE');
  assert.equal(planStatus({ ...paid, active: false }, now).canUsePlan, false);
});
test('repeated login does not restart trial or overwrite a paid subscription', async () => {
  const firstLogin = new Date('2026-11-01T00:00:00Z');
  let subscription = null, creates = 0;
  const prisma = {
    user: { findUnique: async () => ({ id: 'user', createdAt: firstLogin, subscription }) },
    subscription: { upsert: async data => { assert.deepEqual(data.update, {}); if (!subscription) { subscription = data.create; creates++; } return subscription; } },
  };
  const auth = new AuthService(prisma);
  const first = await auth.current({ uid: 'test' });
  const second = await auth.current({ uid: 'test' });
  assert.equal(creates, 1);
  assert.equal(first.plan.endsAt, '2026-11-08T00:00:00.000Z');
  assert.equal(second.plan.endsAt, first.plan.endsAt);
  subscription = { planName: 'PREMIUM', active: true, trialEnds: new Date('2099-01-01T00:00:00Z') };
  const paid = await auth.current({ uid: 'test' });
  assert.equal(paid.plan.planName, 'PREMIUM');
  assert.equal(paid.plan.status, 'ACTIVE');
  assert.equal(creates, 1);
});
