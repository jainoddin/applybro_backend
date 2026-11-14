// Upload project-owned site images to R2. Credentials remain in backend environment only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const root = path.resolve(__dirname, '../..');
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const configFile = option('--config-file') || path.join(root, 'backend-api/.env');
const env = { ...parseEnv(fs.readFileSync(configFile, 'utf8')), ...process.env };
if (!env.R2_ACCOUNT_ID) env.R2_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || new URL(env.R2_ENDPOINT_URL).hostname.split('.')[0];
const prefix = option('--prefix') || [env.R2_PREFIX, 'site/images'].filter(Boolean).join('/');
if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error('Invalid storage prefix');
const required = ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL'];
for (const key of required) if (!env[key]) throw new Error(`Missing ${key}`);
const base = new URL(env.R2_PUBLIC_URL);
if (base.protocol !== 'https:') throw new Error('R2_PUBLIC_URL must use HTTPS');
const s3 = new S3Client({ region:'auto', endpoint:env.R2_ENDPOINT_URL || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}, requestChecksumCalculation:"WHEN_REQUIRED", responseChecksumValidation:"WHEN_REQUIRED", maxAttempts:2 });
const directory = path.join(root,'frontend-web/public/images');
const manifestPath = path.join(root,'frontend-web/src/lib/image-assets.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath,'utf8')) : {};
(async()=>{
 for(const file of fs.readdirSync(directory).filter(x=>/\.(png|jpe?g|webp|avif)$/i.test(x))){
  const body=fs.readFileSync(path.join(directory,file));
  const hash=crypto.createHash('sha256').update(body).digest('hex').slice(0,16);
  const key=`${prefix}/${hash}-${file}`;
  const type=file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':file.endsWith('.avif')?'image/avif':'image/jpeg';
  let exists=false;
  try{const head=await s3.send(new HeadObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key}));exists=head.ContentLength===body.length;}catch(error){if(!['NotFound','NoSuchKey'].includes(error.name)&&![403,404].includes(error.$metadata?.httpStatusCode))throw error;}
  if(!exists)await s3.send(new PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key,Body:body,ContentType:type,CacheControl:'public, max-age=31536000, immutable'}));
  const url=`${env.R2_PUBLIC_URL.replace(/\/$/,'')}/${key}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Public verification failed for ${file}: HTTP ${response.status}`);
  const downloaded=Buffer.from(await response.arrayBuffer());
  if(!body.equals(downloaded))throw new Error(`Public image contents differ for ${file}`);
  manifest[`/images/${file}`]=url;
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(`${exists?'Verified':'Uploaded and verified'}: ${file}`);
 }
 console.log(`Complete: ${Object.keys(manifest).length} verified image URLs. Source files not modified by uploader.`);
})().catch(error=>{let detail=String(error.message||''); for(const k of required)detail=detail.split(env[k]).join('[redacted]'); console.error(`Upload failed: ${error.name}${error.$metadata?.httpStatusCode?` (HTTP ${error.$metadata.httpStatusCode})`:''} ${detail.slice(0,300)}`);process.exitCode=1;});
