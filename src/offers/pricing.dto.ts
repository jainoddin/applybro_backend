import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsString, Max, MaxLength, Min, ArrayMaxSize, MinLength, IsOptional } from 'class-validator';

export class PricingPlanDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) discountPercent?: number;
  @IsOptional() @IsBoolean() gstIncluded?: boolean;
  @IsOptional() @IsBoolean() requiresStudentVerification?: boolean;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsString() @MaxLength(350) description: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000000) monthlyPrice: number;
  // Total annual price, explicitly configured by the admin.
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000000) yearlyPrice: number;
  @IsIn(['INR', 'USD', 'EUR', 'GBP']) currency: string;
  @IsInt() @Min(0) @Max(365) trialDays: number;
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(200, { each: true }) features: string[];
  @IsString() @MinLength(1) @MaxLength(60) ctaText: string;
  @IsBoolean() popular: boolean;
  @IsBoolean() isActive: boolean;
  @IsInt() @Min(0) @Max(10000) order: number;
}
