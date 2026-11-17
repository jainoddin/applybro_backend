import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createHmac,timingSafeEqual} from 'crypto';
import {PrismaService} from '../prisma/prisma.service';
function nativeReceiptMatches(confirmation:any,job:any){
 try{const url=new URL(confirmation?.url),match=/^Applied to\s+["“]([^"”\n]+)["”]$/i.exec(String(confirmation?.text||'').trim());const normalize=(value:string)=>value.replace(/\s+/g,' ').trim().toLowerCase();return url.origin==='https://www.naukri.com'&&/^\/myapply\/saveApply\/?$/.test(url.pathname)&&!!match&&normalize(match[1])===normalize(String(job?.title||''));}catch{return false;}
}
export function verifyBrowserReceipt(raw:Buffer,signature:unknown,key:string){
 if(!/^[a-f0-9]{64}$/i.test(key||'')||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature)||!Buffer.isBuffer(raw))return false;
 return timingSafeEqual(createHmac('sha256',key).update(raw).digest(),Buffer.from(signature.slice(7),'hex'));
}
@Injectable()
export class BrowserReceiptService {
 constructor(private readonly db:PrismaService){}
 async record(userId:string,raw:Buffer,signature:unknown,body:any){
  const key=process.env.PRIVATE_BROWSER_CALLBACK_KEY;if(!key)throw new ServiceUnavailableException('Private browser receipt recording is not configured.');
  if(!verifyBrowserReceipt(raw,signature,key)||body?.userId!==userId)throw new ForbiddenException('Receipt must come from the private browser service.');
  const {taskId,job,confirmation,signedAt}=body;
  if(typeof taskId!=='string'||!/^[-a-f0-9]{36}$/.test(taskId)||typeof signedAt!=='number'||Math.abs(Date.now()-signedAt)>300000||![job?.title,job?.company,confirmation?.text].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||!(/(application (has been |was )?(submitted|received)|thank you for (applying|your application)|successfully applied)/i.test(confirmation.text)||nativeReceiptMatches(confirmation,job)))throw new BadRequestException('A current employer confirmation is required.');
  let url:string,listing:string;try{const u=new URL(confirmation.url),j=new URL(job.url);if(u.protocol!=='https:'||u.username||u.password||j.origin!=='https://www.naukri.com'||!/^\/job-listings-/.test(j.pathname))throw Error();url=u.origin+u.pathname;listing=j.origin+j.pathname;}catch{throw new BadRequestException('Invalid application receipt URL.');}
  const appliedAt=new Date(confirmation.at);if(!Number.isFinite(appliedAt.getTime())||appliedAt.getTime()>Date.now()+60000)throw new BadRequestException('Invalid confirmation time.');
  const existing=await this.db.jobApplication.findUnique({where:{id:taskId}});
  if(existing&&existing.userId!==userId)throw new ForbiddenException();
  const data={jobTitle:job.title.trim(),companyName:job.company.trim(),portal:'NAUKRI' as const,matchScore:Math.max(0,Math.min(100,Number(job.score)||0)),applyMode:'AUTO_APPLY' as const,status:'APPLIED' as const,appliedAt,matchReasons:{url:listing,source:'verified-private-browser',receipt:{text:confirmation.text,url,at:appliedAt.toISOString()}}};
  await this.db.jobApplication.upsert({where:{id:taskId},create:{id:taskId,userId,...data},update:data});
  return {recorded:true,applicationId:taskId};
 }
}
