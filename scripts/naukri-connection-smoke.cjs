require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { CloudAgentService } = require('../dist/agent/agent.service');
const { seal, unseal } = require('../dist/agent/agent-policy');
const { claim } = require('./cloud-queue.cjs');
process.env.CLOUD_AGENT_ENCRYPTION_KEY = 'de'.repeat(32);
const db = new PrismaClient();
(async () => {
  const ids = [];
  try {
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({ data: { name: 'Connection Fixture', email: `connection-${randomUUID()}@example.invalid` } });
      ids.push(user.id);
    }
    const [uid, other] = ids;
    const service = new CloudAgentService(db, { getMatchedJobs: async () => ({ jobs: [] }) });
    service.config = async () => ({ connectionReady: false });
    await assert.rejects(service.connectNaukri(uid, { consent: true }));
    service.config = async () => ({ connectionReady: true });
    await assert.rejects(service.connectNaukri(uid, {}));
    const run = await service.connectNaukri(uid, { consent: true });
    assert.equal((await service.connectNaukri(uid, { consent: true })).id, run.id);
    await assert.rejects(service.owned(other, run.id));
    assert.equal((await db.$queryRaw`SELECT * FROM "AgentPreference" WHERE "userId"=${uid}`).length, 0);
    const [task] = await claim(db, 'connection-fixture', true, uid);
    assert.equal(task.id, run.id);
    assert.equal(task.kind, 'CONNECT');
    assert.equal(task.applicationId, null);
    await assert.rejects(service.reserve(task.id, 'connection-fixture'));
    await service.pause(task, 'Fixture private login request');
    const status = await service.status(uid);
    assert.equal(status.runs[0].kind, 'CONNECT');
    assert.equal(status.naukri.status, 'WAITING_USER');
    const state = { cookies: [{ domain: '.naukri.com', name: 'session', value: 'fixture-private-cookie' },
      { domain: 'jobs.lever.co', name: 'session', value: 'fixture-other-site' }],
      origins: [{ origin: 'https://www.naukri.com', localStorage: [] }, { origin: 'https://jobs.lever.co', localStorage: [] }] };
    const encrypted = seal(state);
    assert.ok(!encrypted.includes('fixture-private-cookie'));
    await db.$executeRaw`INSERT INTO "AgentSession"("userId","encrypted","naukriCheckedAt") VALUES (${uid},${encrypted},NOW())`;
    await db.$executeRaw`UPDATE "AgentRun" SET "state"='CONNECTED' WHERE "id"=${task.id}`;
    assert.equal((await service.status(uid)).naukri.status, 'SESSION_SAVED');
    await service.disconnectNaukri(other);
    assert.ok((await db.$queryRaw`SELECT "naukriCheckedAt" FROM "AgentSession" WHERE "userId"=${uid}`)[0].naukriCheckedAt);
    await service.disconnectNaukri(uid);
    const [saved] = await db.$queryRaw`SELECT * FROM "AgentSession" WHERE "userId"=${uid}`;
    assert.equal(saved.naukriCheckedAt, null);
    assert.equal(saved.revision, 1);
    assert.deepEqual(unseal(saved.encrypted).cookies.map(c => c.domain), ['jobs.lever.co']);
    assert.deepEqual(unseal(saved.encrypted).origins.map(o => o.origin), ['https://jobs.lever.co']);
    const staleWrite = await db.$executeRaw`INSERT INTO "AgentSession"("userId","encrypted","revision") VALUES (${uid},${encrypted},0) ON CONFLICT ("userId") DO UPDATE SET "encrypted"=EXCLUDED."encrypted" WHERE "AgentSession"."revision"=EXCLUDED."revision"`;
    assert.equal(staleWrite, 0);
    assert.equal((await service.status(uid)).naukri.status, 'NOT_CONNECTED');
    assert.equal(await db.jobApplication.count({ where: { userId: { in: ids } } }), 0);
    console.log('PASS: login-only queue without auto-apply consent, owner isolation, encrypted session, no application submission, disconnect preserves other sites, stale-worker writes rejected. No portal request or email sent.');
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
})().catch(error => { console.error('Connection smoke failed:', error.code || error.name); process.exitCode = 1; });
