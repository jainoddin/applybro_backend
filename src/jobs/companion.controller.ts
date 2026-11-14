import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CompanionService } from './companion.service';
@Controller('companion')
export class CompanionController{
 constructor(private readonly companion:CompanionService){}
 @Post('pair') @UseGuards(AuthGuard) pair(@Req()req:any){return this.companion.pair(req.authUser.id);}
 @Get('status') @UseGuards(AuthGuard) status(@Req()req:any){return this.companion.status(req.authUser.id);}
 @Post('revoke') @UseGuards(AuthGuard) revoke(@Req()req:any){return this.companion.revoke(req.authUser.id);}
 @Post('disconnect-portal') @UseGuards(AuthGuard) disconnectPortal(@Req()req:any,@Body()body:any){return this.companion.disconnectPortal(req.authUser.id,body?.portal);}
 @Post('runs') @UseGuards(AuthGuard) create(@Req()req:any,@Body()body:any){return this.companion.create(req.authUser.id,body);}
 @Post('runs/:id/cancel') @UseGuards(AuthGuard) cancel(@Req()req:any,@Param('id')id:string){return this.companion.cancel(req.authUser.id,id);}
 @Get('device/runs/:id') async task(@Req()req:any,@Param('id')id:string){return this.companion.task(await this.companion.device(req.headers.authorization),id);}
 @Post('device/runs/:id') async report(@Req()req:any,@Param('id')id:string,@Body()body:any){return this.companion.report(await this.companion.device(req.headers.authorization),id,body);}
 @Post('device/runs/:id/import') async importJobs(@Req()req:any,@Param('id')id:string,@Body()body:any){return this.companion.importJobs(await this.companion.device(req.headers.authorization),id,body);}
 @Post('device/observe') async observe(@Req()req:any,@Body()body:any){return this.companion.observeJob(await this.companion.device(req.headers.authorization),body);}
 @Post('device/runs/:id/inspect') async inspect(@Req()req:any,@Param('id')id:string,@Body()body:any){return this.companion.observeJob(await this.companion.device(req.headers.authorization),body,id);}
}
