const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ContactService}=require('../dist/contact/contact.service');
const {ContactController}=require('../dist/contact/contact.controller');
const {ContactDto}=require('../dist/contact/contact.dto');
const {plainToInstance}=require('class-transformer');
const {validate}=require('class-validator');
const valid={name:'Preview Visitor',email:'visitor@example.com',subject:'General question',message:'I have a question about setting up my profile.',consent:true,website:''};
const config={get:key=>({CONTACT_TO_EMAIL:'helloapplybro@gmail.com',FRONTEND_URL:'http://localhost:3002'})[key]};
test('contact form delivery and abuse handling',async t=>{const original=global.fetch;try{
 await t.test('validates and normalizes input',async()=>{const dto=plainToInstance(ContactDto,{...valid,name:'  Visitor Name  ',email:'VISITOR@EXAMPLE.COM'});assert.equal((await validate(dto)).length,0);assert.equal(dto.name,'Visitor Name');assert.equal(dto.email,'visitor@example.com');const invalid=plainToInstance(ContactDto,{...valid,email:'bad',message:'short',consent:false,subject:'injected\r\nsubject'});assert.ok((await validate(invalid)).length>=4);});
 await t.test('HTML template, fixed recipient and reply-to are configured',async()=>{let request;global.fetch=async(url,options)=>{request={url,options};return{ok:true,json:async()=>({success:'true'})};};const result=await new ContactService(config).send(valid);assert.equal(result.success,true);assert.equal(request.url,'https://formsubmit.co/ajax/helloapplybro%40gmail.com');const body=JSON.parse(request.options.body);assert.equal(body._template,'table');assert.equal(body._replyto,valid.email);assert.equal(body._url,'http://localhost:3002/contact');assert.equal(request.options.headers.Referer,body._url);assert.equal(body._cc,undefined);});
 await t.test('activation/provider refusal never returns sent success',async()=>{global.fetch=async()=>({ok:true,json:async()=>({success:'false',message:'Needs Activation'})});await assert.rejects(new ContactService(config).send(valid),error=>error.getStatus()===503);});
 await t.test('network failure returns actionable unavailable response',async()=>{global.fetch=async()=>{throw new Error('network failure')};await assert.rejects(new ContactService(config).send(valid),error=>error.getStatus()===503);});
 await t.test('honeypot submissions never reach the email service',async()=>{let called=false;global.fetch=async()=>{called=true;throw new Error('unexpected')};const result=await new ContactService(config).send({...valid,website:'spam'});assert.equal(result.success,true);assert.equal(called,false);});
 await t.test('rate limits each client and ignores forged forwarding header',async()=>{const controller=new ContactController({send:async()=>({success:true})});const request={ip:'127.0.0.1',socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'spoof'}};for(let i=0;i<5;i++)await controller.send(valid,request);await assert.rejects(controller.send(valid,request),error=>error.getStatus()===429);});
}finally{global.fetch=original;}});
