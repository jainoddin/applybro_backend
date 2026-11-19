import { hasSubmissionEvidence } from './application-evidence';

export function dailyProgress(apps: any[], runs: any[], limit: number, now = new Date()) {
  const day = new Date(now.getTime() + 19800000).toISOString().slice(0, 10);
  const start = new Date(day + 'T00:00:00+05:30').getTime();
  const latest = new Map<string, any>();
  for (const run of [...runs].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))) {
    if (run.applicationId && !latest.has(run.applicationId)) latest.set(run.applicationId, run);
  }
  const confirmed = new Set(apps.filter(hasSubmissionEvidence).map(a => a.id));
  const tasks = [...latest.values()].filter(r => !confirmed.has(r.applicationId) && +new Date(r.updatedAt) >= start);
  const count = (stages: string[]) => tasks.filter(r => stages.includes(r.stage)).length;
  const running = tasks.filter(r => ['OPENED', 'RUNNING'].includes(r.stage) || (r.stage === 'SUBMITTING' && +new Date(r.updatedAt) > Date.now() - 300000)).length;
  const unconfirmed = tasks.filter(r => r.stage === 'UNKNOWN' || (r.stage === 'SUBMITTING' && +new Date(r.updatedAt) <= Date.now() - 300000)).length;
  return {
    day,
    limit,
    submitted: apps.filter(a => hasSubmissionEvidence(a) && +new Date(a.appliedAt) >= start).length,
    paused: count(['REVIEW_REQUIRED', 'LOGIN_REQUIRED', 'WAITING_USER']),
    queued: count(['CREATED', 'QUEUED']),
    running,
    unconfirmed
  };
}
