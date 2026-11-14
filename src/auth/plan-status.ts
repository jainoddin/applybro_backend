export const TRIAL_DAYS = 7;
export function trialEnd(firstLogin: Date) {
  return new Date(firstLogin.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}
type Subscription = { planName: string; active: boolean; trialEnds: Date; createdAt?: Date };
// trialEnds is the existing database column; it is the expiry for a trial OR paid period.
export function planStatus(subscription: Subscription, now = new Date()) {
  const expiry = new Date(subscription.trialEnds);
  const trial = subscription.planName.toUpperCase() === 'FREE_TRIAL';
  const remainingSeconds = Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 1000));
  const expired = remainingSeconds === 0;
  const status = expired ? 'EXPIRED' : !subscription.active ? 'INACTIVE' : trial ? 'TRIAL' : 'ACTIVE';
  return { planName: subscription.planName, status, isTrial: trial, trialDays: TRIAL_DAYS, startsAt: subscription.createdAt?.toISOString() || null, endsAt: expiry.toISOString(), serverNow: now.toISOString(), remainingSeconds, canUsePlan: subscription.active && !expired, renewalRequired: !subscription.active || expired };
}
