import { IsNumber, IsString } from "class-validator";

/** Curation bodies (#2197). Type checks only; the service stores what it is given. */
export class CuratorStakeDto {
  @IsString()
  curatorId!: string;

  @IsNumber()
  amountUsd!: number;
}

export class CuratorReportDto {
  @IsString()
  curatorId!: string;

  @IsString()
  trackId!: string;

  @IsString()
  reason!: string;
}
