const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { parseEnv } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const env = parseEnv(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const api = 'http://localhost:4000/student';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB2kAAAAASUVORK5CYII=', 'base64');
const fields = { fullName: 'Test Student', nameOnId: 'Test Student', email: 'student-smoke@example.test', institution: 'Test University', studentId: 'TEST-ONLY-123' };
function form(data) { const result = new FormData(); for (const [key, value] of Object.entries(data)) result.set(key, value); result.set('image', new Blob([png], { type: 'image/png' }), 'test-id.png'); return result; }
(async () => {
  let id, cookie;
  try {
    assert.equal((await fetch(`${api}/admin/requests`)).status, 401);
    const login = await fetch(`${api}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: env.STUDENT_REVIEW_KEY }) });
    assert.equal(login.status, 201);
    cookie = login.headers.get('set-cookie').split(';')[0];
    const created = await fetch(`${api}/submit`, { method: 'POST', body: form({ ...fields, nameOnId: 'Different Name' }) });
    assert.equal(created.status, 201);
    const initial = await created.json();
    id = initial.id;
    assert.equal(initial.status, 'REJECTED', 'name mismatch auto-rejection');
    const headers = { Authorization: `Bearer ${initial.accessToken}` };
    assert.equal((await fetch(`${api}/${id}/status`)).status, 401);
    assert.equal((await fetch(`${api}/admin/${id}/image`)).status, 401);
    const image = await fetch(`${api}/admin/${id}/image`, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert(png.equals(Buffer.from(await image.arrayBuffer())));
    assert.equal((await fetch(`${api}/${id}/claim`, { method: 'POST', headers })).status, 409);
    const resubmitted = await fetch(`${api}/${id}/resubmit`, { method: 'POST', headers, body: form(fields) });
    assert.equal(resubmitted.status, 201);
    assert.equal((await resubmitted.json()).status, 'PENDING');
    assert.equal((await fetch(`${api}/${id}/resubmit`, { method: 'POST', headers, body: form(fields) })).status, 409);
    const review = data => fetch(`${api}/admin/${id}/review`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await review({ status: 'APPROVED', documentName: 'Someone Else', reason: '' })).status, 400);
    assert.equal((await review({ status: 'REJECTED', documentName: '', reason: '' })).status, 400);
    assert.equal((await review({ status: 'REJECTED', documentName: '', reason: 'Photo unclear. Re-upload a readable ID.' })).status, 201);
    const rejected = await (await fetch(`${api}/${id}/status`, { headers })).json();
    assert.match(rejected.reason, /Photo unclear/);
    await fetch(`${api}/${id}/resubmit`, { method: 'POST', headers, body: form(fields) });
    assert.equal((await review({ status: 'APPROVED', documentName: '  TEST   STUDENT ', reason: '' })).status, 201);
    const claimed = await fetch(`${api}/${id}/claim`, { method: 'POST', headers });
    assert.equal(claimed.status, 201);
    const offer = await claimed.json();
    assert.equal(offer.monthlyPrice, 142.15);
    assert.equal(offer.claimed, true);
    const again = await (await fetch(`${api}/${id}/claim`, { method: 'POST', headers })).json();
    assert.equal(again.claimId, offer.claimId, 'claim is idempotent');
    assert.equal((await review({ status: 'REJECTED', documentName: '', reason: 'Late change' })).status, 409);
    console.log('PASS: private image/access control, name mismatch rejection, review reasons, re-upload, approval gating, server-side price and idempotent claim.');
  } finally {
    if (cookie) await fetch(`${api}/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
    if (id) await prisma.studentVerification.delete({ where: { id } });
    await prisma.$disconnect();
    console.log('Temporary verification and image removed.');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
