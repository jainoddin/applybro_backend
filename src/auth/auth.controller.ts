import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('sync') sync(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.sync(request.firebaseToken);
  }
  @Get('me') me(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return request.authUser;
  }
}
