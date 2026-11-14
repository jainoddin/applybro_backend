const manifest = require('../../frontend-web/src/lib/image-assets.json');
(async () => {
  const bytes = Buffer.from(await (await fetch(manifest['/images/career-laptop.jpg'])).arrayBuffer());
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'r2-verification.jpg');
  const response = await fetch('http://localhost:4000/offers/upload', { method: 'POST', body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(`Upload HTTP ${response.status}`);
  if (data.storage !== 'r2' || !data.url.includes('/applybro/offers/')) throw new Error('Unexpected storage/prefix');
  const publicImage = await fetch(data.url);
  const matches = bytes.equals(Buffer.from(await publicImage.arrayBuffer()));
  if (!matches) throw new Error('Public image bytes differ');
  console.log('Backend upload: R2, applybro/offers prefix, public bytes verified.');
  const home = await fetch('http://localhost:3002');
  const html = await home.text();
  console.log(JSON.stringify({ home: home.status, r2Images: html.includes('/applybro/site/images/') }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
