// Move existing published local banner images to verified R2 URLs.
const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseEnv } = require('node:util');
(async () => {
  const env = parseEnv(await fs.readFile(path.join(__dirname, '../.env'), 'utf8'));
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    for (const banner of await prisma.offerBanner.findMany()) {
      if (!banner.imageUrl.startsWith('/offers/')) continue;
      const root = path.resolve(__dirname, '../../frontend-web/public/offers');
      const file = path.resolve(root, banner.imageUrl.slice('/offers/'.length));
      if (!file.startsWith(root + path.sep)) throw Error('Invalid banner path');
      const bytes = await fs.readFile(file);
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: 'image/png' }), path.basename(file));
      const response = await fetch('http://localhost:4000/offers/upload', { method: 'POST', body: form });
      if (!response.ok) throw Error(`Upload HTTP ${response.status}`);
      const data = await response.json();
      if (data.storage !== 'r2' || !data.url.includes('/applybro/offers/')) throw Error('Unexpected storage');
      const publicImage = await fetch(data.url);
      if (!publicImage.ok || !bytes.equals(Buffer.from(await publicImage.arrayBuffer()))) throw Error('Public verification failed');
      await prisma.offerBanner.update({ where: { id: banner.id }, data: { imageUrl: data.url } });
      console.log('Published banner updated to verified R2 URL.');
    }
  } finally { await prisma.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
