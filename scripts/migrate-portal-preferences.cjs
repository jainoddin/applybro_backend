require('dotenv').config();
const {PrismaClient}=require('@prisma/client');const fs=require('node:fs');const db=new PrismaClient();
(async()=>{try{await db.$executeRawUnsafe(fs.readFileSync('prisma/portal-preferences.sql','utf8'));console.log('Portal preference storage ready. Existing accounts preserved.');}finally{await db.$disconnect();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
