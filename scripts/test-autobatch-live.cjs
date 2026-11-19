const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();
const { CompanionService } = require('../dist/jobs/companion.service');

async function main() {
  const device = {
    id: 'c6d80bad-6d7d-4694-92c5-c86147764797',
    userId: '6633f759-3925-431f-80b1-0e7bc78860f1'
  };

  const companion = new CompanionService(prisma);
  try {
    const res = await companion.autoBatch(device);
    console.log('AUTO BATCH RESULT:', res);
  } catch (err) {
    console.error('AUTO BATCH ERROR:', err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

