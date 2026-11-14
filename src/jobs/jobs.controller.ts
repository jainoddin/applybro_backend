import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('matches')
  async getMatchedJobs(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.getMatchedJobs(request.authUser.id);
  }

  @Post('apply/:id')
  async applyJob(
    @Req() request: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.applyJob(request.authUser.id, id);
  }

  @Post('auto-apply-run')
  async runAutoApply(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.runAutoApplyBatch(request.authUser.id);
  }

  @Post('toggle-auto-apply')
  async toggleAutoApply(
    @Req() request: any,
    @Body() body: { enable: boolean },
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.toggleAutoApply(request.authUser.id, body.enable);
  }

  @Get('applications')
  async getAppliedJobs(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.getAppliedJobs(request.authUser.id);
  }

  @Post('connect-portal')
  async connectPortal(
    @Req() request: any,
    @Body() body: { portal: string; status?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.connectPortal(request.authUser.id, body.portal);
  }

  @Post('discover')
  async discoverMoreJobs(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.jobsService.discoverMoreJobs(request.authUser.id);
  }
}

