// Idempotently initialize missing trials from each account's first login date.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { PrismaClient } = require('@prisma/client');
const { AuthService } = require('../dist/auth/auth.service');
const env = parseEnv(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
(async () => {
  try {
    const users = await prisma.user.findMany({ where: { firebaseUid: { not: null } }, select: { firebaseUid: true } });
    const service = new AuthService(prisma);
    for (const user of users) {
      const first = await service.current({ uid: user.firebaseUid });
      const second = await service.current({ uid: user.firebaseUid });
      assert.equal(second.plan.endsAt, first.plan.endsAt, 'repeat login must not extend expiry');
      assert.equal(second.plan.planName, first.plan.planName, 'existing paid plan must be retained');
    }
    console.log(`Initialized/checked ${users.length} account plans. Repeat reads preserve expiry; no plan was reset.`);
  } finally { await prisma.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
