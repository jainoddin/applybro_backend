import {Module} from '@nestjs/common';
import {PrismaModule} from '../prisma/prisma.module';import {AuthModule} from '../auth/auth.module';import {JobsModule} from '../jobs/jobs.module';
import {CloudAgentService} from './agent.service';import {CloudAgentController} from './agent.controller';
@Module({imports:[PrismaModule,AuthModule,JobsModule],providers:[CloudAgentService],controllers:[CloudAgentController],exports:[CloudAgentService]})
export class CloudAgentModule{}
