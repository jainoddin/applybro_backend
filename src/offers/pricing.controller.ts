import { Body, Controller, Delete, Get, Param, Post, Put, NotFoundException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { databaseErrorSummary } from '../prisma/database-error';
import { PrismaService } from '../prisma/prisma.service';
import { PricingPlanDto } from './pricing.dto';

@Controller('pricing')
export class PricingController {
  private readonly logger = new Logger(PricingController.name);
  constructor(private readonly prisma: PrismaService) {}
  @Get() async list() {
    try {
      return await this.prisma.pricingPlan.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    } catch (error) {
      this.logger.error(`GET /pricing failed: ${databaseErrorSummary(error)}`);
      throw new ServiceUnavailableException('Pricing is temporarily unavailable. Please try again later.');
    }
  }
  @Get('admin') all() { return this.prisma.pricingPlan.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }); }
  @Post() create(@Body() data: PricingPlanDto) { return this.prisma.pricingPlan.create({ data }); }
  @Put(':id') async update(@Param('id') id: string, @Body() data: PricingPlanDto) {
    if (!await this.prisma.pricingPlan.findUnique({ where: { id } })) throw new NotFoundException('Plan not found');
    return this.prisma.pricingPlan.update({ where: { id }, data });
  }
  @Delete(':id') async remove(@Param('id') id: string) {
    if (!await this.prisma.pricingPlan.findUnique({ where: { id } })) throw new NotFoundException('Plan not found');
    await this.prisma.pricingPlan.delete({ where: { id } });
    return { success: true };
  }
}
