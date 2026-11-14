require('dotenv').config();
const assert=require('node:assert/strict');const {PrismaClient}=require('@prisma/client');const {ProfileService}=require('../dist/profile/profile.service');
const db=new PrismaClient();
(async()=>{let id;
 try{
   const user=await db.user.create({data:{email:`portal-test-${Date.now()}@example.invalid`,name:'Portal persistence fixture'}});id=user.id;
   const service=new ProfileService(db,{});
   const all=['Company Career Portals','LinkedIn','Google for Jobs','Naukri.com','Indeed','Wellfound / AngelList','Glassdoor','ZipRecruiter'];
   let profile=await service.getProfile(id);
   await service.saveSetup(id,{...profile,portals:all,primaryPortal:'Naukri.com',steps:[true,true,true,false]});
   // Fresh service instance proves the values are read back from PostgreSQL, not a local object/cache.
   profile=await new ProfileService(db,{}).getProfile(id);assert.deepEqual(profile.portals,all);assert.equal(profile.primaryPortal,'Naukri.com');
   profile=await service.saveSetup(id,{...profile,portals:['LinkedIn','Company Career Portals'],primaryPortal:'Naukri.com'});
   assert.deepEqual((await service.getProfile(id)).portals,['LinkedIn','Company Career Portals']);assert.equal(profile.primaryPortal,'LinkedIn');
   await assert.rejects(()=>service.saveSetup(id,{...profile,name:'Do not commit invalid save',portals:['Fake Portal']}));
   assert.notEqual((await service.getProfile(id)).name,'Do not commit invalid save');
   await service.saveSetup(id,{...profile,portals:[],primaryPortal:''});assert.deepEqual((await service.getProfile(id)).portals,[]);
   assert.equal(await db.portalConnection.count({where:{userId:id}}),0,'Selection must not fabricate a portal account connection');
   console.log('PASS: all eight choices survive a fresh DB read; subset, empty selection, primary portal and invalid-save handling verified. No portal connection was fabricated.');
 }finally{if(id)await db.user.delete({where:{id}});await db.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
