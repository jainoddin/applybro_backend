import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    if (process.env.DATABASE_URL) {
      try {
        await this.$connect();
        this.logger.log("Connected to PostgreSQL via Prisma!");
      } catch (err) {
        this.logger.warn("Could not connect to PostgreSQL. Running in offline/fallback mode.");
      }
    } else {
      this.logger.warn("DATABASE_URL is not set. Running Prisma in fallback mode.");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

