const {AsyncLocalStorage}=require('node:async_hooks');
const {createHmac}=require('node:crypto');
const requestContext=new AsyncLocalStorage();
// Bearer credentials are scoped to the current authenticated request, never written to disk.
class BackendSessionStore{
 constructor(portal,{origin,key=process.env.PRIVATE_BROWSER_CALLBACK_KEY,fetcher=fetch}={}){this.portal=portal;this.origin=origin;this.key=/^[a-f0-9]{64}$/i.test(key||'')?key:null;this.fetcher=fetcher;}
 async exchange(owner,action,state){
  const context=requestContext.getStore();
  if(!this.key||!context||context.owner!==owner)throw Error('Authenticated session storage context unavailable.');
  const raw=JSON.stringify({userId:owner,portal:this.portal,action,state,signedAt:Date.now()});
  const signature='sha256='+createHmac('sha256',this.key).update(raw).digest('hex');
  const response=await this.fetcher(this.origin()+'/profile/browser-session',{method:'POST',headers:{Authorization:context.authorization,'Content-Type':'application/json','x-applybro-browser-signature':signature},body:raw,redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Persistent session storage unavailable (HTTP '+response.status+').');
  return response.json();
 }
 async load(owner){const {state}=await this.exchange(owner,'load');return state?.cookies?.length||state?.origins?.length?state:null;}
 async save(owner,state){return (await this.exchange(owner,'save',state)).saved===true;}
 async remove(owner){await this.exchange(owner,'clear');}
}
module.exports={BackendSessionStore,requestContext};
