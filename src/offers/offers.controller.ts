import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { OffersService, OfferBannerDto, DailyDealDto } from "./offers.service";

@Controller("offers")
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  getOffers(): Promise<OfferBannerDto[]> {
    return this.offersService.getBanners();
  }

  @Get("banners")
  getBanners(): Promise<OfferBannerDto[]> {
    return this.offersService.getBanners();
  }

  @Post("banners")
  createBanner(@Body() body: Partial<OfferBannerDto>): Promise<OfferBannerDto> {
    return this.offersService.createBanner(body);
  }

  @Delete("banners/:id")
  deleteBanner(@Param("id") id: string): Promise<{ success: boolean }> {
    return this.offersService.deleteBanner(id).then((success) => ({ success }));
  }

  @Get("deals")
  getDeals(): Promise<DailyDealDto[]> {
    return this.offersService.getDeals();
  }

  @Post("deals")
  createDeal(@Body() body: Partial<DailyDealDto>): Promise<DailyDealDto> {
    return this.offersService.createDeal(body);
  }

  @Delete("deals/:id")
  deleteDeal(@Param("id") id: string): Promise<{ success: boolean }> {
    return this.offersService.deleteDeal(id).then((success) => ({ success }));
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async uploadImage(@UploadedFile() file: Express.Multer.File): Promise<{ url: string; storage: "r2" }> {
    if (!file) {
      throw new BadRequestException("No image file provided");
    }
    return this.offersService.uploadBannerImage(
      file.buffer,
      file.originalname,
      file.mimetype
    );
  }
}
