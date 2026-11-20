// Isolated scheduler regression. No real account, token, or employer requests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');
function fixture(history){
 const device={id:'new-device',userId:'owner'},created=[];
 const db={user:{findUnique:async()=>({activeMode:'AUTO_APPLY',autoApplyConsent:true,dailyApplyLimit:6,subscription:{active:true,trialEnds:new Date(Date.now()+86400000)}})},jobApplication:{findMany:async()=>[]},$executeRaw:async()=>0,$queryRaw:async(strings,...values)=>{
  const sql=strings.join('?');
  if(sql.includes('"selectedPortals"'))return [{selectedPortals:['Naukri.com','LinkedIn']}];
  if(sql.includes("\"kind\"='DISCOVER'")){
   // Evaluate the discovery cooldown against old/new device history.
   const scoped=sql.includes('"deviceId"=?'),excludeCancelled=sql.includes('"stage"<>\'CANCELLED\'');
   const portal=values[scoped?2:1];
   return history.filter(r=>r.portal===portal&&(!scoped||r.deviceId===values[1])&&(!excludeCancelled||r.stage!=='CANCELLED'));
  }
  return [];
 }};
 const service=new CompanionService(db);
 service.create=async(_user,data)=>{created.push(data);return {id:'new-'+data.portal,...data};};
 return {run:()=>service.autoBatch(device),created};
}
test('re-pairing immediately discovers both portals despite cancelled previous-device searches',async()=>{
 process.env.COMPANION_AUTO_APPLY_ENABLED='true';
 const f=fixture(['Naukri.com','LinkedIn'].map(portal=>({deviceId:'old-device',portal,stage:'CANCELLED'})));
 const result=await f.run();assert.equal(result.runs.length,2);assert.deepEqual(f.created.map(r=>r.portal),['Naukri.com','LinkedIn']);
});
test('cancelled search on the current device cannot suppress fresh discovery',async()=>{
 const f=fixture([{deviceId:'new-device',portal:'Naukri.com',stage:'CANCELLED'}]);
 assert.equal((await f.run()).runs.length,2);
});
test('completed current-device discovery retains its cooldown while the other portal proceeds',async()=>{
 const f=fixture([{deviceId:'new-device',portal:'Naukri.com',stage:'DISCOVERED'}]);
 const result=await f.run();assert.equal(result.runs.length,1);assert.equal(result.runs[0].portal,'LinkedIn');
});
