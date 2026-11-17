import {Body,Controller,ForbiddenException,Get,Post,Query,Req,UseGuards,Header} from '@nestjs/common';
import {AuthGuard} from '../auth/auth.guard';
import {WhatsAppService} from './whatsapp.service';
import {validWhatsAppSignature} from './whatsapp-policy';
import {WhatsAppOtpService} from './whatsapp-otp.service';
@Controller('agent/whatsapp')
export class WhatsAppController {
 constructor(private readonly whatsapp:WhatsAppService,private readonly otp:WhatsAppOtpService){}
 private browser(req:any,body:any){const key=process.env.PRIVATE_BROWSER_CALLBACK_KEY;if(!/^[a-f0-9]{64}$/i.test(key||'')||!Buffer.isBuffer(req.rawBody)||body?.userId!==req.authUser.id||typeof body?.signedAt!=='number'||Math.abs(Date.now()-body.signedAt)>300000||!validWhatsAppSignature(req.rawBody,req.headers['x-applybro-browser-signature'],key))throw new ForbiddenException();}
 @Post('browser-otp/ask') @UseGuards(AuthGuard) @Header('Cache-Control','no-store') askOtp(@Req()req:any,@Body()body:any){this.browser(req,body);return this.otp.ask(req.authUser.id,body);}
 @Post('browser-otp/poll') @UseGuards(AuthGuard) @Header('Cache-Control','no-store') pollOtp(@Req()req:any,@Body()body:any){this.browser(req,body);return this.otp.poll(req.authUser.id,body);}
 @Post('browser-otp/cancel') @UseGuards(AuthGuard) @Header('Cache-Control','no-store') cancelOtp(@Req()req:any,@Body()body:any){this.browser(req,body);return this.otp.cancel(req.authUser.id,body);}
 @Get('status') @UseGuards(AuthGuard) status(@Req()req:any){return this.whatsapp.status(req.authUser.id);}
 @Post('pair') @UseGuards(AuthGuard) pair(@Req()req:any,@Body()body:any){return this.whatsapp.pair(req.authUser.id,body);}
 @Post('disconnect') @UseGuards(AuthGuard) disconnect(@Req()req:any){return this.whatsapp.disconnect(req.authUser.id);}
 @Post('reuse') @UseGuards(AuthGuard) reuse(@Req()req:any,@Body()body:any){return this.whatsapp.reuseSettings(req.authUser.id,body);}
 @Get('answers') @UseGuards(AuthGuard) answers(@Req()req:any){return this.whatsapp.listAnswers(req.authUser.id);}
 @Post('answers/delete') @UseGuards(AuthGuard) deleteAnswer(@Req()req:any,@Body()body:any){return this.whatsapp.deleteAnswer(req.authUser.id,body?.key);}
 @Post('answers/update') @UseGuards(AuthGuard) updateAnswer(@Req()req:any,@Body()body:any){return this.whatsapp.updateAnswer(req.authUser.id,body);}
 @Get('webhook') verify(@Query()query:any){
  if(!process.env.WHATSAPP_VERIFY_TOKEN||query['hub.mode']!=='subscribe'||query['hub.verify_token']!==process.env.WHATSAPP_VERIFY_TOKEN)throw new ForbiddenException();
  return query['hub.challenge'];
 }
 @Post('webhook') async receive(@Req()req:any,@Body()body:any){
  if(!Buffer.isBuffer(req.rawBody)||!validWhatsAppSignature(req.rawBody,req.headers['x-hub-signature-256'],process.env.WHATSAPP_APP_SECRET||''))throw new ForbiddenException();
  await this.whatsapp.inbound(body);return {received:true};
 }
}
