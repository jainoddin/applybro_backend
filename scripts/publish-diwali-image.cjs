const fs = require('node:fs/promises');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const env = parseEnv(await fs.readFile(path.join(__dirname, '../.env'), 'utf8'));
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const deal = await prisma.dailyDeal.findFirst({ where: { tag: 'Diwali Special', isActive: true } });
    if (!deal || deal.discountText !== '40% OFF' || !deal.discountedPrice.includes('170.57')) throw Error('Confirm the current Diwali pricing before publishing this artwork.');
    const bytes = await fs.readFile(path.join(__dirname, '../../output/imagegen/diwali-red-v1.png'));
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: 'image/png' }), 'diwali-red-v1.png');
    const response = await fetch('http://localhost:4000/offers/upload', { method: 'POST', body: form });
    if (!response.ok) throw Error(`Upload failed: ${response.status}`);
    const uploaded = await response.json();
    if (uploaded.storage !== 'r2' || !uploaded.url.includes('/applybro/offers/')) throw Error('Unexpected image storage');
    const publicImage = await fetch(uploaded.url);
    if (!publicImage.ok || !bytes.equals(Buffer.from(await publicImage.arrayBuffer()))) throw Error('Public image verification failed');
    await prisma.dailyDeal.update({ where: { id: deal.id }, data: { iconUrl: uploaded.url, iconType: 'custom', popupOnOpen: true } });
    console.log('Diwali red artwork uploaded to R2, public bytes verified, active popup updated.');
  } finally { await prisma.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
