// Operator-only check: no candidate details, credentials, submissions or opt-in changes.
require('dotenv').config();
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { CloudAgentService } = require('../dist/agent/agent.service');
const { JobsService } = require('../dist/jobs/jobs.service');
const { approvedUrl } = require('../dist/agent/agent-policy');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const db = app.get(PrismaService), agent = app.get(CloudAgentService);
    const config = await agent.config();
    const candidates = [];
    for (const user of await db.user.findMany()) {
      let candidateReady = true;
      try { await agent.checkCandidate(user.id); } catch { candidateReady = false; }
      const data = await app.get(JobsService).getMatchedJobs(user.id);
      const supported = data.jobs.filter(job => job.status !== 'APPLIED' && job.matchAssessed &&
        job.matchScore >= user.minMatchScore && approvedUrl(job.applicationUrl));
      const prefs = await db.$queryRaw`SELECT "enabled" FROM "AgentPreference" WHERE "userId"=${user.id}`;
      candidates.push({ candidateReady, hostedOptIn: prefs[0]?.enabled === true,
        dailyLimit: user.dailyApplyLimit, minMatchScore: user.minMatchScore,
        matchedJobs: data.jobs.length, supportedAssessedMatches: supported.length });
    }
    console.log(JSON.stringify({ ...config, candidates, applicationsSubmittedByCheck: 0 }, null, 2));
    if (!config.ready || candidates.some(c => !c.candidateReady || !c.hostedOptIn || !c.supportedAssessedMatches)) process.exitCode = 2;
  } finally { await app.close(); }
})().catch(error => {
  console.error('Agent preflight failed:', /^P\d{4}$/.test(error.code || '') ? error.code : error.name);
  process.exitCode = 1;
});
