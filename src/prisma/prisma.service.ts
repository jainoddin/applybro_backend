import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { databaseErrorSummary } from './database-error';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    if (process.env.DATABASE_URL) {
      try {
        await this.$connect();
        this.logger.log("Connected to PostgreSQL via Prisma!");
      } catch (err) {
        this.logger.error(`PostgreSQL startup connection failed: ${databaseErrorSummary(err)}`);
      }
    } else {
      this.logger.error("DATABASE_URL is not set. Database-backed routes are unavailable.");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
