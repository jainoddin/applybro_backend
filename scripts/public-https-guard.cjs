const dns=require('node:dns/promises');
function createPublicHttpsGuard({isPublic,lookup=(host)=>dns.lookup(host,{all:true}),now=Date.now,ttl=30000,maxHosts=128}={}){
 const cache=new Map();
 return async function check(value){
  let u;try{u=new URL(value);}catch{return 'INVALID_PUBLIC_HTTPS_DESTINATION';}
  if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password)return 'INVALID_PUBLIC_HTTPS_DESTINATION';
  let entry=cache.get(u.hostname);
  if(!entry||entry.expires<=now()){
   if(cache.size>=maxHosts)cache.delete(cache.keys().next().value);
   entry={expires:now()+ttl,pending:Promise.resolve().then(()=>lookup(u.hostname)).then(addresses=>addresses.length&&addresses.every(a=>isPublic(a.address))?null:'NON_PUBLIC_ADDRESS').catch(()=> 'DNS_LOOKUP_FAILED')};
   cache.set(u.hostname,entry);
  }
  return entry.pending;
 };
}
module.exports={createPublicHttpsGuard};
