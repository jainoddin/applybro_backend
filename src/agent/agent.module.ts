import {Module} from '@nestjs/common';
import {PrismaModule} from '../prisma/prisma.module';import {AuthModule} from '../auth/auth.module';import {JobsModule} from '../jobs/jobs.module';
import {CloudAgentService} from './agent.service';import {CloudAgentController} from './agent.controller';
import {WhatsAppService} from './whatsapp.service';import {WhatsAppController} from './whatsapp.controller';
import {WhatsAppOtpService} from './whatsapp-otp.service';
@Module({imports:[PrismaModule,AuthModule,JobsModule],providers:[CloudAgentService,WhatsAppService,WhatsAppOtpService],controllers:[CloudAgentController,WhatsAppController],exports:[CloudAgentService,WhatsAppService]})
export class CloudAgentModule{}
