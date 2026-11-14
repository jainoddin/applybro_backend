import { Body,Controller,Get,Param,Post,Req,UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CloudAgentService } from './agent.service';
@Controller('agent') @UseGuards(AuthGuard)
export class CloudAgentController {
 constructor(private readonly agent:CloudAgentService){}
 @Get('status') status(@Req()req:any){return this.agent.status(req.authUser.id);}
 @Post('settings') settings(@Req()req:any,@Body()body:any){return this.agent.settings(req.authUser.id,body);}
 @Post('queue') queue(@Req()req:any){return this.agent.queueMatches(req.authUser.id);}
 @Get('runs/:id/screen') screen(@Req()req:any,@Param('id')id:string){return this.agent.screen(req.authUser.id,id);}
 @Post('runs/:id/unlock') unlock(@Req()req:any,@Param('id')id:string){return this.agent.unlock(req.authUser.id,id);}
 @Post('runs/:id/redeem') redeem(@Req()req:any,@Param('id')id:string,@Body()body:any){return this.agent.redeem(req.authUser.id,id,body?.token);}
 @Post('runs/:id/control') control(@Req()req:any,@Param('id')id:string,@Body()body:any){return this.agent.control(req.authUser.id,id,body);}
 @Post('runs/:id/cancel') cancel(@Req()req:any,@Param('id')id:string){return this.agent.cancel(req.authUser.id,id);}
}
