import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { AuthModule } from '../auth/auth.module';
@Module({ imports: [PrismaModule, AuthModule], controllers: [StudentController], providers: [StudentService] })
export class StudentModule {}
