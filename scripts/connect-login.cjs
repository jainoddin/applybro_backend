// One authenticated HTTP operation: reuse the current session, start only if absent/expired.
async function connectLogin(relay,owner,options={}){
 const session=relay.sessions.get(owner);
 if(session&&session.expiresAt>Date.now()){session.previewEnabled=options.preview!==false;return relay.refresh(owner);}
 return relay.start(owner,options);
}
module.exports={connectLogin};
