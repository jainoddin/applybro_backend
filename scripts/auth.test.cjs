const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../dist/auth/auth.service');
const { StudentService } = require('../dist/student/student.service');
test('Firebase tokens must be verified, refreshed profiles come only from verified claims', async () => {
  let saved, verification;
  const prisma = { user: { upsert: async value => { saved = value; return { id: 'db-user', createdAt: new Date('2026-11-13T00:00:00Z'), ...value.create }; } }, subscription: { upsert: async value => value.create } };
  const service = new AuthService(prisma);
  service.firebase = () => ({ verifyIdToken: async (token, revoked) => { verification = { token, revoked }; if (token === 'invalid') throw Object.assign(Error(),{code:'auth/invalid-id-token'}); return { uid: 'firebase-user', email: 'PERSON@example.test', name: 'Person', email_verified: true, firebase: { sign_in_provider: 'google.com' } }; } });
  await assert.rejects(() => service.verify(''), error => error.getStatus() === 401);
  await assert.rejects(() => service.verify('Bearer invalid'), error => error.getStatus() === 401);
  const decoded = await service.verify('Bearer valid-test-token');
  assert.deepEqual(verification, { token: 'valid-test-token', revoked: true });
  const user = await service.sync(decoded);
  assert.equal(user.firebaseUid, 'firebase-user');
  assert.equal(saved.where.firebaseUid, 'firebase-user');
  assert.equal(saved.create.email, 'person@example.test');
  assert.equal(saved.update.name,undefined);
  assert(!('passwordHash' in saved.create));
  assert(!('accessToken' in saved.create));
  assert.equal(saved.select.passwordHash, undefined);
  service.firebase = () => ({ verifyIdToken: async () => ({ uid: 'anonymous', firebase: { sign_in_provider: 'anonymous' } }) });
  await assert.rejects(() => service.verify('Bearer valid-test-token'), error => error.getStatus() === 401);
});

test('Firebase network failures remain unavailable, while revoked tokens require sign-in',async()=>{
 const service=new AuthService({});
 for(const code of ['EACCES','auth/internal-error','auth/invalid-credential']){
  service.firebase=()=>({verifyIdToken:async()=>{throw Object.assign(Error(),{code});}});
  await assert.rejects(()=>service.verify('Bearer fixture'),error=>error.getStatus()===503);
 }
 for(const code of ['auth/id-token-expired','auth/id-token-revoked','auth/user-disabled']){
  service.firebase=()=>({verifyIdToken:async()=>{throw Object.assign(Error(),{code});}});
  await assert.rejects(()=>service.verify('Bearer fixture'),error=>error.getStatus()===401);
 }
});
test('same email with another Firebase UID is never silently merged', async () => {
  const service = new AuthService({ user: { upsert: async () => { throw { code: 'P2002' }; } } });
  await assert.rejects(() => service.sync({ uid: 'another', email: 'person@example.test', firebase: { sign_in_provider: 'github.com' } }), error => error.getStatus() === 409);
});
test('student application cannot be read/claimed by another signed-in user', async () => {
  const service = new StudentService({ studentVerification: { findUnique: async () => ({ id: 'application', userId: 'owner', tokenHash: 'unused', status: 'APPROVED' }) } });
  await assert.rejects(() => service.status('application', '', 'attacker'), error => error.getStatus() === 401);
  await assert.rejects(() => service.claim('application', '', 'attacker'), error => error.getStatus() === 401);
});
test('login return URLs stay on the current site and cannot create auth loops', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../../frontend-web/src/lib/auth-navigation.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, URL });
  for (const input of ['https://attacker.test', '//attacker.test', '/\\attacker.test', '/login?next=/login', '/register', 'javascript:alert(1)']) assert.equal(exports.safeNext(input), '/dashboard');
  assert.equal(exports.safeNext('/student-offer'), '/student-offer');
  assert.equal(exports.safeNext('/get-started?plan=student&billing=yearly'), '/get-started?plan=student&billing=yearly');
  assert.equal(exports.loginHref('/student-offer'), '/login?next=%2Fstudent-offer');
});
