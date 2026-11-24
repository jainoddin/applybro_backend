const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();
const { CompanionService } = require('../dist/jobs/companion.service');

async function main() {
  const userId = '6633f759-3925-431f-80b1-0e7bc78860f1';
  const companion = new CompanionService(prisma);
  const rem = await companion['remaining'](userId, 6);
  console.log('COMPANION remaining(userId, 6) RESULT:', rem);
}

main().catch(console.error).finally(() => prisma.$disconnect());
