import { Controller, Get, Post, Param, Body, Headers, Req, Res, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { StudentService } from './student.service';
import { StudentSubmissionDto, StudentReviewDto, StudentAdminLoginDto } from './student.dto';
const upload = FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
@Controller('student')
export class StudentController {
  constructor(private readonly service: StudentService) {}
  @Post('submit') @UseGuards(AuthGuard) @UseInterceptors(upload)
  submit(@Body() data: StudentSubmissionDto, @UploadedFile() file: Express.Multer.File, @Req() request: Request) {
    this.service.rateLimit(`submit:${request.ip}`);
    return this.service.submit(data, file, undefined, undefined, (request as any).authUser.id);
  }
  @Post('admin/login')
  login(@Body() data: StudentAdminLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.service.rateLimit(`login:${request.ip}`, 5);
    const token = this.service.login(data.key);
    response.cookie('student_review', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/student/admin', maxAge: 8 * 3600000 });
    return { success: true };
  }
  @Post('admin/logout')
  logout(@Headers('cookie') cookie: string, @Res({ passthrough: true }) response: Response) {
    this.service.logout(cookie);
    response.clearCookie('student_review', { path: '/student/admin' });
    return { success: true };
  }
  @Get('admin/requests')
  list(@Headers('cookie') cookie: string, @Res({ passthrough: true }) response: Response) {
    this.service.authorize(cookie); response.setHeader('Cache-Control', 'no-store');
    return this.service.list();
  }
  @Get('admin/:id/image')
  async image(@Param('id') id: string, @Headers('cookie') cookie: string, @Res() response: Response) {
    this.service.authorize(cookie);
    const record = await this.service.image(id);
    response.set({ 'Content-Type': record.imageMime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="student-id"' });
    response.send(record.imageBytes);
  }
  @Post('admin/:id/review')
  review(@Param('id') id: string, @Headers('cookie') cookie: string, @Body() data: StudentReviewDto) {
    this.service.authorize(cookie); return this.service.review(id, data);
  }
  @Get('mine') @UseGuards(AuthGuard)
  mine(@Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.service.mine(request.authUser.id);
  }
  @Get(':id/status') @UseGuards(AuthGuard)
  status(@Param('id') id: string, @Headers('authorization') authorization: string, @Req() request: any, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.status(id, '', request.authUser.id);
  }
  @Post(':id/resubmit') @UseGuards(AuthGuard) @UseInterceptors(upload)
  resubmit(@Param('id') id: string, @Headers('authorization') authorization: string, @Body() data: StudentSubmissionDto, @UploadedFile() file: Express.Multer.File, @Req() request: Request) {
    this.service.rateLimit(`submit:${request.ip}`);
    return this.service.submit(data, file, id, '', (request as any).authUser.id);
  }
  @Post(':id/claim') @UseGuards(AuthGuard)
  claim(@Param('id') id: string, @Req() request: any) {
    return this.service.claim(id, '', request.authUser.id);
  }
}
