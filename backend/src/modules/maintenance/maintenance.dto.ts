import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from "class-validator";

/**
 * Request bodies of the admin maintenance routes (#2362, deferred from #2197).
 *
 * Types only: value rules (batch ceilings, date parsing, unknown stem types) stay
 * in the services, which clamp or ignore what they do not accept. Every field is
 * optional because every route runs with defaults on an empty body.
 */

/** `POST /admin/stems/backfill-audio-features`. */
export class StemFeatureBackfillDto {
  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: string[];

  @IsOptional()
  @IsBoolean()
  refresh?: boolean;

  @IsOptional()
  @IsBoolean()
  retryFailed?: boolean;
}

/** `POST /admin/embeddings/backfill`. */
export class EmbeddingBackfillDto {
  @IsOptional()
  @IsNumber()
  limit?: number;
}

/**
 * `POST /admin/erasure/run-due`. The service also accepts a numeric string and
 * ignores a value it cannot read, so only an actual number is checked here.
 */
export class RunDueErasuresDto {
  @IsOptional()
  @ValidateIf((_object, value) => typeof value !== "string")
  @IsInt()
  @Min(1)
  limit?: number | string;
}

/** `POST /admin/analytics/warehouse/load` and `/backfill`. */
export class AnalyticsWarehouseLoadDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  eventFamily?: string;

  @IsOptional()
  @IsString()
  runId?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/** `POST /admin/community/cohorts/generate`. */
export class CommunityCohortGenerationDto {
  @IsOptional()
  @IsNumber()
  minimumSize?: number;

  /** An ISO date; a value that does not parse falls back to the current time in the service. */
  @IsOptional()
  @IsString()
  now?: string;
}

/**
 * `PATCH /admin/community/moderation/reports/:reportId`. A missing action is
 * answered by the service with its own message, so presence is not checked here.
 */
export class ResolveCommunityModerationReportDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
