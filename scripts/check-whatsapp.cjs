const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

async function main() {
  const userId = '6633f759-3925-431f-80b1-0e7bc78860f1';
  const runs = await prisma.$queryRawUnsafe(
    'SELECT id, portal, kind, stage, url, "deviceId", "createdAt", "updatedAt" FROM "BrowserRun" WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT 5',
    userId
  );
  console.log('LATEST RUNS:', runs);

  const devices = await prisma.$queryRawUnsafe(
    'SELECT id, "revokedAt", "createdAt" FROM "BrowserDevice" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 3',
    userId
  );
  console.log('\nDEVICES:', devices);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeMode: true, autoApplyConsent: true, dailyApplyLimit: true }
  });
  console.log('\nUSER SETTINGS:', user);
}

main().catch(console.error).finally(() => prisma.$disconnect());
