import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { LiveSources } from './live-sources';
import { CompanionService } from './companion.service';
import { CompanionController } from './companion.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [JobsController, CompanionController],
  providers: [JobsService, LiveSources, CompanionService],
  exports: [JobsService],
})
export class JobsModule {}
