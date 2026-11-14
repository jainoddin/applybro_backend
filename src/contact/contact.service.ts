import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ContactDto } from "./contact.dto";
@Injectable()
export class ContactService {
 private readonly logger=new Logger(ContactService.name);
 constructor(private readonly config:ConfigService){}
 async send(data:ContactDto):Promise<{success:true;message:string}>{
  if(data.website)return {success:true,message:"Thank you for your message."};
  const recipient=this.config.get<string>("CONTACT_TO_EMAIL");
  if(!recipient||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))throw new ServiceUnavailableException("Contact email is not configured. Please try again later.");
  const sourceUrl = new URL("/contact", this.config.get<string>("FRONTEND_URL") || "http://localhost:3000").toString();
  try{
   const response=await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(recipient)}`,{
    method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json",Referer:sourceUrl},signal:AbortSignal.timeout(20000),
    body:JSON.stringify({name:data.name,email:data.email,subject:data.subject,message:data.message,_subject:`ApplyBro Contact: ${data.subject}`,_replyto:data.email,_template:"table",_captcha:"false",_url:sourceUrl}),
   });
   const result=await response.json().catch(()=>null) as {success?:boolean|string;message?:string}|null;
   if(!response.ok||(result?.success!==true&&result?.success!=="true"))throw new Error("Provider did not accept message");
   // Never log message contents, sender email or provider response objects.
   return {success:true,message:"Your message has been accepted. Thank you for reaching out!"};
  }catch{
   this.logger.warn("Contact email service did not confirm acceptance.");
   throw new ServiceUnavailableException("We could not send your message right now. Please try again later or email us directly.");
  }
 }
}
