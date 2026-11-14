const {test}=require('node:test');const assert=require('node:assert/strict');
const {loadFirebaseAccount}=require('../dist/auth/firebase-credentials');
const account={type:'service_account',project_id:'test-project',client_email:'fixture@example.invalid',private_key:'fixture-not-a-real-key'};
test('base64 env credentials do not depend on a downloaded file',()=>{
 const result=loadFirebaseAccount({FIREBASE_PROJECT_ID:'test-project',FIREBASE_SERVICE_ACCOUNT_BASE64:Buffer.from(JSON.stringify(account)).toString('base64'),FIREBASE_SERVICE_ACCOUNT_PATH:'missing-file.json'});assert.equal(result.project_id,'test-project');
});
test('JSON env credentials are accepted',()=>{assert.equal(loadFirebaseAccount({FIREBASE_PROJECT_ID:'test-project',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(account)}).client_email,account.client_email);});
test('wrong-project, malformed or missing credentials fail closed without exposing their contents',()=>{
 for(const env of [{FIREBASE_PROJECT_ID:'other',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(account)},{FIREBASE_PROJECT_ID:'test-project',FIREBASE_SERVICE_ACCOUNT_JSON:'sensitive-invalid-payload'},{FIREBASE_PROJECT_ID:'test-project',FIREBASE_SERVICE_ACCOUNT_BASE64:'!sensitive!'},{FIREBASE_PROJECT_ID:'test-project'}])assert.throws(()=>loadFirebaseAccount(env),error=>!error.message.includes('sensitive'));
});
