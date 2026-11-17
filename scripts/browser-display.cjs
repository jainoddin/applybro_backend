// Separate Xvfb display per helper; readiness comes from its own process, not another socket.
const {spawn}=require('node:child_process');
function createDisplayManager({launch=spawn,platform=process.platform,env=process.env,timeoutMs=5000}={}){
 let child=null,pending=null,screen=null;
 const stop=()=>{const old=child;child=null;pending=null;screen=null;old?.kill();};
 async function display(){
  if(platform!=='linux'||env.DISPLAY)return env.DISPLAY;
  if(screen&&child&&child.exitCode===null&&!child.killed)return screen;
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>{
   let settled=false,buffer='';
   const processChild=launch('Xvfb',['-displayfd','1','-screen','0','1280x900x24','-nolisten','tcp'],{stdio:['ignore','pipe','ignore']});child=processChild;
   const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);if(child===processChild){child=null;screen=null;}processChild.kill();reject(Object.assign(Error('The private browser display could not start.'),{status:503}));};
   const timer=setTimeout(fail,timeoutMs);
   processChild.once('error',fail);
   processChild.once('exit',()=>{if(child===processChild){child=null;screen=null;}fail();});
   processChild.stdout.on('data',chunk=>{buffer+=chunk.toString();if(!buffer.includes('\n'))return;const number=buffer.trim();if(!/^\d{1,5}$/.test(number))return fail();if(settled)return;settled=true;clearTimeout(timer);screen=':'+number;resolve(screen);});
  });
  try{return await pending;}finally{pending=null;}
 }
 return{display,stop};
}
module.exports={createDisplayManager};
