import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  PART_BAR_OPTIONS,
  PART_ROLES,
  PART_STYLE_RAW_MAX_CHARS,
  PART_TAKES_MAX,
  PART_TAKES_MIN,
  type PartRole,
} from "./remix-parts";

/**
 * POST /remix/projects/:id/parts/generate (#1901). The service re-validates
 * (the pipe keeps unknown fields and does not coerce) and sanitizes `style`
 * (control characters stripped, whitespace collapsed, capped at 80 chars).
 */
export class GeneratePartsDto {
  @IsIn(PART_ROLES as unknown as string[])
  role!: PartRole;

  @IsIn(PART_BAR_OPTIONS as unknown as number[])
  bars!: 4 | 8;

  @IsOptional()
  @IsString()
  @MaxLength(PART_STYLE_RAW_MAX_CHARS)
  style?: string | null;

  @IsOptional()
  @IsInt()
  @Min(PART_TAKES_MIN)
  @Max(PART_TAKES_MAX)
  takes?: number;
}
