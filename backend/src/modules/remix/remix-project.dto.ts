import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

/**
 * Remix project bodies (#1890). Types only: the global pipe keeps unknown
 * fields and does not coerce, and the project service keeps its own value
 * checks (rights eligibility, status and mode transitions, gain bounds).
 * `aiTarget`, `effects`, `structure`, `beat` and `parts` stay undecorated
 * because the service validates those recipes in full.
 */
export class CreateRemixProjectDto {
  @IsString()
  @IsNotEmpty()
  sourceTrackId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  stemIds!: string[];

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsString()
  prompt?: string | null;
}

export class RemixStemUpdateDto {
  @IsString()
  @IsNotEmpty()
  stemId!: string;

  @IsOptional()
  @IsString()
  role?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  gainDb?: number | null;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  /** Validated by the service. */
  arrangement?: unknown;
}

export class UpdateRemixProjectDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  prompt?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemixStemUpdateDto)
  stems?: RemixStemUpdateDto[];

  /** Eligibility-checked stem additions to the session (#1312). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addStemIds?: string[];

  // Validated in full by the service; no decorators here.
  /** Persisted variation AI target (#1882). */
  aiTarget?: { kind: string; stemId?: string | null } | null;
  /** Shared effects recipe remix-fx/v4 (#1897, #1903); Pro fields need `remix.pro`. */
  effects?: unknown;
  /** Structure blocks remix-structure/v1 or v2 (#1899, #1908 build-ups). */
  structure?: unknown;
  /** Beat maker remix-beat/v1 (#1902). */
  beat?: unknown;
  /** AI part lanes remix-parts/v1 (#1901). */
  parts?: unknown;
  /** Grid correction remix-grid-override/v1 (#2539); setting one needs `remix.pro`. */
  gridOverride?: unknown;
  /** Cue and loop points remix-cues/v1 (#2540); setting them needs `remix.pro`. */
  cues?: unknown;
}

/**
 * POST /remix/projects/:id/export body (#2540). Optional: no body exports the
 * draft as rendered. The controller checks `variant` against
 * `REMIX_EXPORT_VARIANTS` itself (400 for anything else).
 */
export class ExportRemixDraftDto {
  @IsOptional()
  variant?: unknown;
}
