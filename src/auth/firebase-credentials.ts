import { readFileSync } from 'fs';
import { resolve } from 'path';

export function loadFirebaseAccount(env:Record<string,string|undefined>=process.env){
  const project=env.FIREBASE_PROJECT_ID?.trim();
  if(!project)throw new Error('Firebase project is not configured.');
  let raw:string;
  try{
    if(env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim()){
      const encoded=env.FIREBASE_SERVICE_ACCOUNT_BASE64.trim();
      if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error();
      raw=Buffer.from(encoded,'base64').toString('utf8');
    }else if(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim())raw=env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else{
      const file=env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()||env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
      if(!file)throw new Error();
      raw=readFileSync(resolve(file),'utf8');
    }
    const account=JSON.parse(raw.replace(/^\uFEFF/,''));
    if(account.type!=='service_account'||account.project_id!==project||typeof account.client_email!=='string'||typeof account.private_key!=='string')throw new Error();
    return account;
  }catch{throw new Error('Firebase server credentials are missing, invalid or belong to another project.');}
}
