import {BrowserSessionService} from './browser-session.service';
import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ProfileService } from './profile.service';
import { BrowserReceiptService } from './browser-receipt.service';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService,private readonly receipts:BrowserReceiptService,private readonly sessions:BrowserSessionService) {}
  @Post('browser-session')
  async browserSession(@Req()request:any,@Body()body:any,@Res({passthrough:true})response:Response){
    response.setHeader('Cache-Control','no-store');
    return this.sessions.exchange(request.authUser.id,request.rawBody,request.headers['x-applybro-browser-signature'],body);
  }
  @Post('browser-receipt')
  async browserReceipt(@Req()request:any,@Body()body:any){return this.receipts.record(request.authUser.id,request.rawBody,request.headers['x-applybro-browser-signature'],body);}

  @Get()
  async getProfile(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.profileService.getProfile(request.authUser.id);
  }

  @Get('browser-material')
  async browserMaterial(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.profileService.browserMaterial(request.authUser.id);
  }

  @Post('setup')
  async saveSetup(
    @Req() request: any,
    @Body() body: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.profileService.saveSetup(request.authUser.id, body);
  }

  @Post('parse-resume')
  async parseResume(
    @Req() request: any,
    @Body() body: { fileBase64: string; fileName: string; mimeType?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.profileService.parseResumeWithAi(request.authUser.id, body);
  }
}
