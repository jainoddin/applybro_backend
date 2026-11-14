import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
export function decodeResume(data:any){
 if(typeof data?.fileBase64!=='string'||typeof data?.fileName!=='string')throw new BadRequestException('Choose a PDF or DOCX resume.');
 const encoded=data.fileBase64.replace(/^data:[^,]*;base64,/, '');
 if(encoded.length>7*1024*1024||!/^[a-zA-Z0-9+/\r\n]*={0,2}$/.test(encoded))throw new BadRequestException('Resume must be under 5 MB.');
 const bytes=Buffer.from(encoded,'base64');
 if(!bytes.length||bytes.length>5*1024*1024)throw new BadRequestException('Resume must be under 5 MB.');
 const pdf=/\.pdf$/i.test(data.fileName)&&bytes.subarray(0,5).toString()==='%PDF-';
 const docx=/\.docx$/i.test(data.fileName)&&bytes[0]===0x50&&bytes[1]===0x4b;
 if(!pdf&&!docx)throw new BadRequestException('Upload a valid PDF or DOCX resume.');
 return {bytes,fileName:data.fileName.replace(/^.*[\\/]/,'').slice(0,180),mimeType:pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
}
export async function savePrivateResume(db:any,userId:string,file:{bytes:Buffer;fileName:string;mimeType:string}){
 return db.$transaction(async(tx:any)=>{
  // Keep bytes immutable: an existing browser task must retain its selected
  // resume even if the user uploads a new file with the same filename.
  const id=randomUUID();
  await tx.resume.create({data:{id,userId,fileName:file.fileName,fileUrl:'private://resume/'+id,isDefault:true}});
  await tx.resume.updateMany({where:{userId},data:{isDefault:false}});
  await tx.resume.update({where:{id},data:{isDefault:true,fileUrl:'private://resume/'+id}});
  await tx.$executeRaw`UPDATE "Resume" SET "fileBytes"=${file.bytes},"mimeType"=${file.mimeType} WHERE "id"=${id} AND "userId"=${userId}`;
  await tx.user.update({where:{id:userId},data:{resumeName:file.fileName,resumeSize:file.bytes.length}});
  return id;
 });
}
