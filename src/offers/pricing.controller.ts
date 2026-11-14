import { Body, Controller, Delete, Get, Param, Post, Put, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingPlanDto } from './pricing.dto';

@Controller('pricing')
export class PricingController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list() { return this.prisma.pricingPlan.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }); }
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
