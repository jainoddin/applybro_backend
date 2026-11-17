const {test}=require('node:test'),assert=require('node:assert/strict');
const {connectLogin}=require('./connect-login.cjs');
test('Connect while an action is running waits without opening or refreshing another browser',async()=>{
 const relay={busy:new Set(['owner']),sessions:new Map(),start:()=>assert.fail('must not start twice'),refresh:()=>assert.fail('must not overlap')};
 const result=await connectLogin(relay,'owner');assert.equal(result.status,'LOGIN_PROCESSING');assert.equal(result.signedIn,undefined);assert.deepEqual(result.fields,[]);
});
