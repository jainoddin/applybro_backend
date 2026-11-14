import { Module } from "@nestjs/common";
import { OffersController } from "./offers.controller";
import { OffersService } from "./offers.service";
import { StorageModule } from "../storage/storage.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PricingController } from "./pricing.controller";

@Module({
  imports: [StorageModule, PrismaModule],
  controllers: [OffersController, PricingController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
