import { IsNumber, IsObject, IsOptional, IsString } from "class-validator";
import type { StemPricingDto } from "./stem-pricing.service";

/**
 * Stem pricing bodies (#2197). Type checks only: price bounds and ownership are
 * the service's. The fields are typed as `StemPricingDto` declares them, but
 * none is required on the wire: the upsert's update path writes only the fields
 * that are sent.
 */
export class StemPricingBodyDto implements StemPricingDto {
  @IsOptional()
  @IsNumber()
  basePlayPriceUsd!: number;

  @IsOptional()
  @IsNumber()
  remixLicenseUsd!: number;

  @IsOptional()
  @IsNumber()
  commercialLicenseUsd!: number;

  @IsOptional()
  @IsNumber()
  floorUsd!: number;

  @IsOptional()
  @IsNumber()
  ceilingUsd!: number;

  @IsOptional()
  @IsNumber()
  listingDurationDays!: number | null;
}

export class BatchStemPricingBodyDto extends StemPricingBodyDto {
  @IsString()
  releaseId!: string;
}

export class BatchUpsertStemPricingBodyDto {
  @IsString()
  releaseId!: string;

  /** Stem id to pricing; the service reads each entry. */
  @IsObject()
  pricingMap!: Record<string, StemPricingDto>;
}
