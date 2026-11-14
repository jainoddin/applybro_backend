// Run locally with the new service-account file path. Never print its contents.
const fs=require('node:fs');const path=require('node:path');const {createPrivateKey}=require('node:crypto');const dotenv=require('dotenv');
try{
 const source=process.argv[2];if(!source)throw new Error();
 const envPath=path.resolve(__dirname,'../.env');const previous=fs.readFileSync(envPath,'utf8');const config=dotenv.parse(previous);
 const raw=fs.readFileSync(source,'utf8').replace(/^\uFEFF/,'');const account=JSON.parse(raw);
 if(account.type!=='service_account'||account.project_id!==config.FIREBASE_PROJECT_ID||!account.client_email)throw new Error();
 createPrivateKey(account.private_key);
 const encoded=Buffer.from(JSON.stringify(account),'utf8').toString('base64');
 const retained=previous.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?FIREBASE_SERVICE_ACCOUNT_(BASE64|JSON|PATH)\s*=/.test(line));
 fs.writeFileSync(envPath,retained.join('\n').replace(/\s*$/,'')+'\nFIREBASE_SERVICE_ACCOUNT_BASE64='+encoded+'\n');
 console.log('Firebase service-account credentials saved to backend .env. Project and private key validated. Restart the backend.');
}catch{console.error('Could not configure Firebase. Provide a readable, valid service-account JSON for the configured project. No credentials were printed.');process.exitCode=1;}
