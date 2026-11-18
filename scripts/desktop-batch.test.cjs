const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CompanionService}=require('../dist/jobs/companion.service');
function service({hosted=false,remaining=5,pending=[],selected=['LinkedIn','Naukri.com']}={}){
 const queries=[],created=[];
 const db={user:{findUnique:async()=>({id:'owner',activeMode:'AUTO_APPLY',autoApplyConsent:true,dailyApplyLimit:5,subscription:{active:true,trialEnds:new Date(Date.now()+86400000)}})},$queryRaw:async strings=>{const sql=strings.join('?');queries.push(sql);if(sql.includes('"AgentPreference"'))return hosted?[{userId:'owner'}]:[];if(sql.includes('"selectedPortals"'))return [{selectedPortals:selected}];if(sql.includes('"stage" IN'))return pending;return [];}};
 const s=new CompanionService(db);s.remaining=async()=>remaining;s.create=async(owner,data)=>{assert.equal(owner,'owner');created.push(data);return {id:String(created.length),...data};};
 return {s,queries,created};
}
test('desktop scheduling respects daily quota before discovery',async()=>{process.env.COMPANION_AUTO_APPLY_ENABLED='true';const w=service({remaining:0});const r=await w.s.autoBatch({id:'device',userId:'owner'});assert.equal(r.runs.length,0);assert.equal(w.created.length,0);});
test('hosted and desktop processing cannot run together',async()=>{const w=service({hosted:true});await assert.rejects(()=>w.s.autoBatch({id:'device',userId:'owner'}),/Pause Hosted/);assert.equal(w.created.length,0);});
test('safe pending runs are recovered without creating duplicate discovery',async()=>{const w=service({pending:[{id:'existing'}]});const r=await w.s.autoBatch({id:'device',userId:'owner'});assert.equal(r.runs[0].id,'existing');assert.equal(w.created.length,0);assert.ok(w.queries.some(q=>q.includes('"deviceId"=')&&q.includes("('CREATED','OPENED')")));});
test('only explicitly selected supported portals are searched',async()=>{const w=service({selected:['Naukri.com','Google for Jobs']});await w.s.autoBatch({id:'device',userId:'owner'});assert.deepEqual(w.created,[{kind:'DISCOVER',portal:'Naukri.com',autoDiscover:true}]);});
test('deployment feature gate fails closed',async()=>{delete process.env.COMPANION_AUTO_APPLY_ENABLED;const w=service();await assert.rejects(()=>w.s.autoBatch({id:'device',userId:'owner'}),/not enabled/);assert.equal(w.created.length,0);});
