// One authenticated HTTP operation: reuse the current session, start only if absent/expired.
async function connectLogin(relay,owner,options={}){
 if(relay.busy?.has(owner))return{status:'LOGIN_PROCESSING',version:0,fields:[],buttons:[],message:'Finishing your current sign-in step. Please wait a moment.'};
 const session=relay.sessions.get(owner);
 if(session&&session.expiresAt>Date.now()){session.previewEnabled=options.preview!==false;return relay.refresh(owner);}
 return relay.start(owner,options);
}
module.exports={connectLogin};
