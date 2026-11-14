require('dotenv').config();
const fs=require('node:fs');
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{try{for(const statement of fs.readFileSync('prisma/companion.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);console.log('Companion tables and indexes ready.');}finally{await db.$disconnect();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
