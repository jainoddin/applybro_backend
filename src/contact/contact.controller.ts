import { Body, Controller, HttpCode, HttpException, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ContactDto } from "./contact.dto";
import { ContactService } from "./contact.service";
@Controller("contact")
export class ContactController {
 private readonly attempts=new Map<string,{count:number;until:number}>();
 constructor(private readonly service:ContactService){}
 @Post() @HttpCode(200)
 async send(@Body() body:ContactDto,@Req() request:Request){
  const now=Date.now();
  for(const [key,value] of this.attempts)if(value.until<=now)this.attempts.delete(key);
  const ip=request.ip||request.socket.remoteAddress||"unknown";
  const current=this.attempts.get(ip);
  if((current&&current.count>=5)||(!current&&this.attempts.size>=10000))throw new HttpException("Too many messages. Please wait 15 minutes before trying again.",429);
  this.attempts.set(ip,{count:(current?.count||0)+1,until:current?.until||now+15*60*1000});
  return this.service.send(body);
 }
}
