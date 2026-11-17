import {BrowserSessionService} from './browser-session.service';
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { GeminiService } from './gemini.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BrowserReceiptService } from './browser-receipt.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProfileController],
  providers: [BrowserSessionService, ProfileService, GeminiService, BrowserReceiptService],
  exports: [ProfileService, GeminiService],
})
export class ProfileModule {}
