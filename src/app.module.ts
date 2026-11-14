import { ContactModule } from "./contact/contact.module";
import { StudentModule } from "./student/student.module";
import { AuthModule } from "./auth/auth.module";
import { ProfileModule } from "./profile/profile.module";
import { JobsModule } from "./jobs/jobs.module";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "path";
import { Module } from "@nestjs/common";
import { OffersModule } from "./offers/offers.module";
import { CloudAgentModule } from './agent/agent.module';
import { HealthController } from './health.controller';
import { NaukriTestModule } from './naukri-test/naukri-test.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(__dirname, "../.env") }),
    OffersModule,
    ContactModule,
    StudentModule,
    AuthModule,
    ProfileModule,
    JobsModule,
    CloudAgentModule,
    NaukriTestModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
