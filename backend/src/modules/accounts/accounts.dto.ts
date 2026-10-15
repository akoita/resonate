import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";
import { ACCOUNT_NOTE_MAX, ACCOUNT_STATUS_REASONS } from "./account_status.service";

const REASONS = [...ACCOUNT_STATUS_REASONS] as string[];

export class SuspendAccountDto {
  @IsIn(REASONS)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  until?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ACCOUNT_NOTE_MAX)
  note?: string;
}

export class UnsuspendAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(ACCOUNT_NOTE_MAX)
  note?: string;
}

export class CloseAccountDto {
  @IsIn(REASONS)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(ACCOUNT_NOTE_MAX)
  note?: string;

  @IsOptional()
  @IsBoolean()
  scheduleErasure?: boolean;
}
