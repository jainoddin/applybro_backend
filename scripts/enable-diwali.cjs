const { PrismaClient } = require('@prisma/client');
const { parseEnv } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const env = parseEnv(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
(async () => {
  const existing = await prisma.dailyDeal.findFirst({ where: { OR: [{ tag: { contains: 'Festival', mode: 'insensitive' } }, { tag: { contains: 'Diwali', mode: 'insensitive' } }] }, orderBy: { createdAt: 'desc' } });
  if (!existing) throw Error('No existing festive offer found; configure an offer in Admin first.');
  const updated = await prisma.dailyDeal.update({ where: { id: existing.id }, data: { tag: 'Diwali Special', popupOnOpen: true, isActive: true, order: 0, ctaText: 'Explore Diwali Offer', ctaLink: '/pricing', timer: 'Diwali special · See plan details' } });
  console.log(JSON.stringify({ tag: updated.tag, discount: updated.discountText, originalPrice: updated.originalPrice, offerPrice: updated.discountedPrice, popupOnOpen: updated.popupOnOpen }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
