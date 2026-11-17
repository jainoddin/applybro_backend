const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {backendOrigin,authenticate}=require('./naukri-login-relay.cjs');
test('Browser helper routes authentication to the configured local backend and preserves authorization',async()=>{
 const before=process.env.APPLYBRO_BACKEND_URL;let path;const server=http.createServer((req,res)=>{path=req.url;res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer fixture'){res.writeHead(401);res.end('{}');return;}res.end(JSON.stringify({id:'fixture-user'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.APPLYBRO_BACKEND_URL='http://127.0.0.1:'+server.address().port;
 try{assert.equal(await authenticate({headers:{authorization:'Bearer fixture'}}),'fixture-user');assert.equal(path,'/auth/me');await assert.rejects(()=>authenticate({headers:{}}),/Sign in/);for(const bad of ['http://remote.example','https://user:secret@example.com','https://example.com/path','https://example.com?token=x']){process.env.APPLYBRO_BACKEND_URL=bad;assert.throws(()=>backendOrigin());}}finally{await new Promise(r=>server.close(r));if(before===undefined)delete process.env.APPLYBRO_BACKEND_URL;else process.env.APPLYBRO_BACKEND_URL=before;}
});
