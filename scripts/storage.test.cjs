const { test } = require('node:test');
const assert = require('node:assert/strict');
const { S3Client } = require('@aws-sdk/client-s3');
const { R2StorageService } = require('../dist/storage/r2.service');
const { OffersService } = require('../dist/offers/offers.service');
const keys = ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL','DATABASE_URL','R2_PREFIX','R2_ENDPOINT_URL'];
const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
function configured() { Object.assign(process.env,{R2_ACCOUNT_ID:'0'.repeat(32),R2_ACCESS_KEY_ID:'1'.repeat(32),R2_SECRET_ACCESS_KEY:'2'.repeat(64),R2_BUCKET_NAME:'test-assets',R2_PUBLIC_URL:'https://assets.example.com',R2_PREFIX:'',R2_ENDPOINT_URL:'https://example.r2.cloudflarestorage.com'}); }
test('R2 and database failure semantics', async t => {
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const send=S3Client.prototype.send;const fetch=global.fetch;
 try {
  await t.test('missing configuration rejects uploads',async()=>{for(const k of keys)delete process.env[k];await assert.rejects(new R2StorageService().uploadImage(png,'image.png','image/png'),error=>error.getStatus()===503);});
  await t.test('rejects disguised files before contacting storage',async()=>{configured();let called=false;S3Client.prototype.send=async()=>{called=true;};await assert.rejects(new R2StorageService().uploadImage(Buffer.from('not an image'),'a.png','image/png'),error=>error.getStatus()===400);assert.equal(called,false);});
  await t.test('R2 signature failure never returns a local URL',async()=>{configured();S3Client.prototype.send=async()=>{throw Object.assign(new Error('denied'),{name:'SignatureDoesNotMatch'});};await assert.rejects(new R2StorageService().uploadImage(png,'a.png','image/png'),error=>error.getStatus()===503&&error.message.includes('access key'));});
  await t.test('successful PUT still requires public verification',async()=>{configured();S3Client.prototype.send=async()=>({});global.fetch=async()=>({ok:false,status:403});await assert.rejects(new R2StorageService().uploadImage(png,'a.png','image/png'),error=>error.getStatus()===503&&error.message.includes('public access'));});
  await t.test('successful public R2 upload returns HTTPS URL',async()=>{configured();S3Client.prototype.send=async()=>({});global.fetch=async()=>({ok:true});const url=await new R2StorageService().uploadImage(png,'../../unsafe.jpg','image/png');assert.match(url,/^https:\/\/assets\.example\.com\/offers\/[a-f0-9-]+\.png$/);});
  await t.test('shared bucket uploads remain isolated under applybro prefix',async()=>{configured();process.env.R2_PREFIX='applybro';let objectKey;S3Client.prototype.send=async(command)=>{objectKey=command.input.Key;return{};};global.fetch=async()=>({ok:true});const url=await new R2StorageService().uploadImage(png,'a.png','image/png');assert.match(objectKey,/^applybro\/offers\//);assert.ok(url.includes('/applybro/offers/'));});
  await t.test('database offline cannot fake banner/deal success',async()=>{delete process.env.DATABASE_URL;const service=new OffersService({},{});await assert.rejects(service.createBanner({title:'Test'}),error=>error.getStatus()===503);await assert.rejects(service.createDeal({planName:'Test'}),error=>error.getStatus()===503);await assert.rejects(service.deleteBanner('missing'),error=>error.getStatus()===503);assert.deepEqual(await service.getBanners(),[]);});
 } finally {S3Client.prototype.send=send;global.fetch=fetch;for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
});
