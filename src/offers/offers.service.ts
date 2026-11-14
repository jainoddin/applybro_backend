import { Injectable, Logger, ServiceUnavailableException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { R2StorageService } from "../storage/r2.service";

export interface OfferBannerDto {
  id: string;
  title: string;
  subtitle: string;
  ctaText?: string;
  imageUrl: string;
  ctaLink: string;
  order: number;
  badgeText?: string;
  badgeType?: string;
  isActive?: boolean;
}

export interface DailyDealDto {
  popupOnOpen?: boolean;
  id: string;
  tag: string;
  tagColor: "pink" | "amber" | "purple" | "indigo" | string;
  timer: string;
  iconType: "rocket" | "crown" | "diya" | "document" | "custom" | string;
  iconUrl?: string;
  discountText: string;
  originalPrice: string;
  discountedPrice: string;
  planName: string;
  ctaText: string;
  ctaLink: string;
  order: number;
  isActive?: boolean;
}

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  // Public reads stay empty when the database is unavailable; writes fail explicitly.
  private bannersFallback: OfferBannerDto[] = [];
  private dealsFallback: DailyDealDto[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Storage: R2StorageService
  ) {}

  async uploadBannerImage(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string
  ): Promise<{ url: string; storage: "r2" }> {
    const url = await this.r2Storage.uploadImage(fileBuffer, originalName, mimeType);
    return { url, storage: "r2" };
  }

  async getBanners(): Promise<OfferBannerDto[]> {
    try {
      if (process.env.DATABASE_URL) {
        const records = await this.prisma.offerBanner.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
        if (records.length > 0) {
          return records.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: r.subtitle,
            imageUrl: r.imageUrl,
            ctaLink: r.ctaLink,
            ctaText: r.ctaText,
            order: r.order,
            badgeText: r.badgeText || undefined,
            badgeType: r.badgeType || "ribbon",
            isActive: r.isActive,
          }));
        }
      }
    } catch (err) {
      this.logger.warn("Database read failed; returning empty banners.");
    }
    return this.bannersFallback;
  }

  async createBanner(data: Partial<OfferBannerDto>): Promise<OfferBannerDto> {
    const newBanner: OfferBannerDto = {
      id: `banner-${Date.now()}`,
      title: data.title || "Special Offer",
      subtitle: data.subtitle || "Limited time offer",
      imageUrl: data.imageUrl || "/offers/offer-1.png",
      ctaLink: data.ctaLink || "/pricing",
      ctaText: data.ctaText || "View Offer",
      order: data.order ?? this.bannersFallback.length + 1,
      badgeText: data.badgeText,
      badgeType: data.badgeType || "ribbon",
      isActive: true,
    };

    try {
      if (process.env.DATABASE_URL) {
        const created = await this.prisma.offerBanner.create({
          data: {
            title: newBanner.title,
            subtitle: newBanner.subtitle,
            imageUrl: newBanner.imageUrl,
            ctaLink: newBanner.ctaLink,
            ctaText: newBanner.ctaText,
            order: newBanner.order,
            badgeText: newBanner.badgeText,
            badgeType: newBanner.badgeType,
            isActive: true,
          },
        });
        return {
          id: created.id,
          title: created.title,
          subtitle: created.subtitle,
          imageUrl: created.imageUrl,
          ctaLink: created.ctaLink,
          ctaText: created.ctaText,
          order: created.order,
          badgeText: created.badgeText || undefined,
          badgeType: created.badgeType || "ribbon",
          isActive: created.isActive,
        };
      }
    } catch (err) {
      this.logger.error("Banner database write failed.");
    }

    throw new ServiceUnavailableException("Banner could not be saved to the database. No temporary record was created.");
  }

  async deleteBanner(id: string): Promise<boolean> {
    try {
      if (process.env.DATABASE_URL) {
        await this.prisma.offerBanner.delete({ where: { id } });
        return true;
      }
    } catch (err) {
      if (err?.code === "P2025") throw new NotFoundException("Banner not found.");
      this.logger.warn("Banner database delete failed.");
    }
    throw new ServiceUnavailableException("Banner could not be deleted from the database.");
  }

  async getDeals(): Promise<DailyDealDto[]> {
    try {
      if (process.env.DATABASE_URL) {
        const records = await this.prisma.dailyDeal.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
        if (records.length > 0) {
          return records as unknown as DailyDealDto[];
        }
      }
    } catch (err) {
      this.logger.warn("Database read failed; returning empty deals.");
    }
    return this.dealsFallback;
  }

  async createDeal(data: Partial<DailyDealDto>): Promise<DailyDealDto> {
    const newDeal: DailyDealDto = {
      popupOnOpen: data.popupOnOpen === true,
      id: `deal-${Date.now()}`,
      tag: data.tag || "Special Deal",
      tagColor: data.tagColor || "pink",
      timer: data.timer || "24h : 00m",
      iconType: data.iconType || "rocket",
      iconUrl: data.iconUrl,
      discountText: data.discountText || "20% OFF",
      originalPrice: data.originalPrice || "₹999",
      discountedPrice: data.discountedPrice || "₹799",
      planName: data.planName || "Standard Plan",
      ctaText: data.ctaText || "Claim Offer →",
      ctaLink: data.ctaLink || "/pricing",
      order: data.order ?? this.dealsFallback.length + 1,
      isActive: true,
    };

    try {
      if (process.env.DATABASE_URL) {
        const created = await this.prisma.dailyDeal.create({
          data: {
            popupOnOpen: newDeal.popupOnOpen,
            tag: newDeal.tag,
            tagColor: newDeal.tagColor,
            timer: newDeal.timer,
            iconType: newDeal.iconType,
            iconUrl: newDeal.iconUrl,
            discountText: newDeal.discountText,
            originalPrice: newDeal.originalPrice,
            discountedPrice: newDeal.discountedPrice,
            planName: newDeal.planName,
            ctaText: newDeal.ctaText,
            ctaLink: newDeal.ctaLink,
            order: newDeal.order,
            isActive: true,
          },
        });
        return created as unknown as DailyDealDto;
      }
    } catch (err) {
      this.logger.error("Deal database write failed.");
    }

    throw new ServiceUnavailableException("Deal could not be saved to the database. No temporary record was created.");
  }

  async deleteDeal(id: string): Promise<boolean> {
    try {
      if (process.env.DATABASE_URL) {
        await this.prisma.dailyDeal.delete({ where: { id } });
        return true;
      }
    } catch (err) {
      if (err?.code === "P2025") throw new NotFoundException("Deal not found.");
      this.logger.warn("Deal database delete failed.");
    }
    throw new ServiceUnavailableException("Deal could not be deleted from the database.");
  }

  findAll(): Promise<OfferBannerDto[]> {
    return this.getBanners();
  }
}
