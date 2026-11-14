import { Body, Controller, Header, Module, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { NaukriTestService } from './naukri-test.service';

class LoginInput {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(512) password: string;
}
@Controller('naukri-test') @UseGuards(AuthGuard)
class NaukriTestController {
  constructor(private readonly test: NaukriTestService) {}
  @Post('start') @Header('Cache-Control','no-store') start(@Req() req:any) { return this.test.start(req.authUser.id); }
  @Post('login') @Header('Cache-Control','no-store') login(@Req() req:any,@Body() body:LoginInput) { return this.test.login(req.authUser.id,body.email,body.password); }
  @Post('close') @Header('Cache-Control','no-store') close(@Req() req:any) { return this.test.close(req.authUser.id); }
}
@Module({imports:[AuthModule],controllers:[NaukriTestController],providers:[NaukriTestService]})
export class NaukriTestModule {}
