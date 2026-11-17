// Refresh/reopen can replace only an unfinished login, never a verified connection.
async function closePendingLogin(relay,owner,{attemptId}={}){
 if(relay.busy?.has(owner))return{closed:false,busy:true};
 return relay.locked(owner,async()=>{
  const session=relay.sessions.get(owner);
  if(!session)return{closed:true};
  if(attemptId&&session.uiAttemptId&&session.uiAttemptId!==attemptId)return{closed:false,replaced:true};
  if(session.signedIn||session.connectionConfirmed||session.workflow)return{closed:false,kept:true};
  // The portal may have completed login just before the tab was closed.
  const view=await relay.snapshot(session);
  if(view.signedIn||view.status==='SIGNED_IN')return{closed:false,kept:true};
  return relay.close(owner);
 });
}
async function connectLogin(relay,owner,options={}){
 if(relay.busy?.has(owner))return{status:'LOGIN_PROCESSING',version:0,fields:[],buttons:[],message:'Finishing your current sign-in step. Please wait a moment.'};
 let session=relay.sessions.get(owner);
 if(options.resetPending&&session&&session.expiresAt>Date.now()){
  await closePendingLogin(relay,owner);session=relay.sessions.get(owner);
 }
 let result;
 if(session&&session.expiresAt>Date.now()){session.previewEnabled=options.preview!==false;result=await relay.refresh(owner);}
 else result=await relay.start(owner,options);
 session=relay.sessions.get(owner);if(session&&options.attemptId)session.uiAttemptId=options.attemptId;
 return result;
}
module.exports={connectLogin,closePendingLogin};
