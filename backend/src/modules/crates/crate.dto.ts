import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { CrateLicenseOptionDto } from "./crate_license_rights";
import type { CrateQuoteDto } from "./crate_quote.dto";
import type { CrateTransitionFacts } from "./crate_ordering";
import type { CrateEntitlements } from "./crate-entitlements";
import {
  CRATE_WATCH_DTO_MODES,
  CRATE_WATCH_MAX_DAYS,
  CRATE_WATCH_MIN_DAYS,
} from "./crate_watch";
import {
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
  CRATE_REQUEST_MAX_TEXT_LENGTH,
  type CrateCoverage,
  type CrateFilters,
  type CrateLicenseType,
  type CrateRequestSource,
} from "./crate.types";

/**
 * HTTP contracts for the Crate Digger (#1962, docs/rfc/taste-engine.md §5.1-5.2).
 *
 * The request body is validated by the global ValidationPipe (class DTOs only);
 * the service still enforces that exactly one of `text`, `referenceTrackId` and
 * `filters` is present, and runs `filters` through the crate filter sanitizer.
 */
export class CreateCrateRequestDto {
  /** The DJ's request in their own words. Never stored or logged. */
  @IsOptional()
  @IsString()
  @MaxLength(CRATE_REQUEST_MAX_TEXT_LENGTH)
  text?: string;

  /** "More like this": a catalog track to build the crate around. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenceTrackId?: string;

  /** Edited filter chips, as last shown to the DJ. Sanitized by the service. */
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  /** How many lines to ask for (text and reference-track requests). */
  @IsOptional()
  @IsInt()
  @Min(CRATE_MIN_COUNT)
  @Max(CRATE_MAX_COUNT)
  count?: number;
}

/** Longest crate title, after trimming. */
export const CRATE_TITLE_MAX_LENGTH = 80;

export const CRATE_STATUSES = ["draft", "saved"] as const;
export type CrateStatus = (typeof CRATE_STATUSES)[number];

/** One line of a `PATCH /crates/:id` body. */
export class UpdateCrateItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  trackId!: string;

  /** Omitted keeps the line's current value. */
  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}

/**
 * The `watch` member of `PATCH /crates/:id` (#1967). `mode` "auto_buy" passes
 * the DTO so the service can answer it with its own fixed code
 * (`watch_mode_unavailable`); any other unknown mode is a 400 here.
 * `expiresInDays` defaults to 90 and is ignored for "off".
 */
export class UpdateCrateWatchDto {
  @IsIn([...CRATE_WATCH_DTO_MODES])
  mode!: (typeof CRATE_WATCH_DTO_MODES)[number];

  @IsOptional()
  @IsInt()
  @Min(CRATE_WATCH_MIN_DAYS)
  @Max(CRATE_WATCH_MAX_DAYS)
  expiresInDays?: number;
}

/**
 * `PATCH /crates/:id` (#1963). `items`, when present, is the full new order of
 * the crate: every current line exactly once, nothing added (omitting a line
 * removes it). The service enforces that and answers 400 `invalid_items`.
 */
export class UpdateCrateDto {
  /** Trimmed by the service; empty or null clears the title. */
  @IsOptional()
  @IsString()
  @MaxLength(CRATE_TITLE_MAX_LENGTH)
  title?: string | null;

  @IsOptional()
  @IsIn([...CRATE_STATUSES])
  status?: CrateStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => UpdateCrateItemDto)
  items?: UpdateCrateItemDto[];

  /** Watch for new releases that fit the crate (#1967); saved crates only. */
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCrateWatchDto)
  watch?: UpdateCrateWatchDto;
}

/** `POST /crates/:id/items` (#2032): one track to append to the crate. */
export class AddCrateItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  trackId!: string;
}

/** A current non-original, non-master stem of a crate line. */
export type CrateItemStemDto = {
  type: string;
  /** Rounded mean of the stem's quality ratings; null when unrated. */
  qualityScore: number | null;
};

export type CrateItemDto = {
  /** 0-based order in the set path. */
  position: number;
  locked: boolean;
  trackId: string;
  title: string;
  artistId: string | null;
  artistName: string | null;
  /**
   * False when the track is no longer publicly playable (withdrawn, removed,
   * under review). The line stays in the crate rather than disappearing.
   */
  available: boolean;
  tempoBpm: number | null;
  camelot: string | null;
  energy: number | null;
  stemTypes: string[];
  /** The track's current `original` stem, for previews; null when it has none. */
  originalStemId: string | null;
  /** Current stems (never original or master), sorted by type. */
  stems: CrateItemStemDto[];
  /** One entry per tier the track lists or prices, in license-tier order. */
  licenseOptions: CrateLicenseOptionDto[];
  listedLicenseTypes: string[];
  /** Indicative USD price per tier; a tier with no StemPricing is absent. */
  indicativePriceUsd: Partial<Record<CrateLicenseType, number>>;
  /** Indicative line price for the crate's filters, or null when unknown. */
  linePriceUsd: number | null;
  verifiedHuman: boolean;
  aiDisclosureLevel: string | null;
  /** Why the ranker liked it. Present when the crate is created, omitted on GET. */
  explanation?: string[];
  /** What changes going to the next line; null on the last line. */
  transitionToNext: CrateTransitionFacts | null;
};

/** One newly playable track that fit a watching crate (#1967). */
export type CrateWatchMatchDto = {
  trackId: string;
  /** The release page that plays the track; null when unknown. */
  releaseId: string | null;
  title: string;
  artistName: string | null;
  matchedAt: string;
};

/**
 * What a crate is watching for (#1967). `mode` is what is in effect now: "off"
 * for a draft crate and for a watch that has run out (`expiresAt` then says
 * when it ended). `summary` counts this UTC month and is computed when the crate
 * is read, never sent on a schedule. `recentMatches` is newest first, at most
 * 20, and lists only tracks that are still publicly playable.
 */
export type CrateWatchDto = {
  mode: "off" | "notify";
  expiresAt: string | null;
  summary: { month: string; matches: number; notified: number };
  recentMatches: CrateWatchMatchDto[];
};

export type CrateDto = {
  id: string;
  status: string;
  title: string | null;
  filters: CrateFilters;
  createdAt: string;
  updatedAt: string;
  entitlements: CrateEntitlements;
  watch: CrateWatchDto;
  items: CrateItemDto[];
};

export type CrateRequestDto = {
  id: string;
  source: CrateRequestSource;
  parserStrategy: "deterministic" | "model-assisted";
  /**
   * Phrases of the request text that mapped to no filter. Returned here only:
   * never stored, never logged.
   */
  unparsed: string[];
};

/**
 * `GET /crates/:id`. `latestQuote` (#1964) is the crate's most recent quote
 * (any status), or null when it has none; the other quote routes return the
 * same shape.
 */
export type GetCrateResponse = { crate: CrateDto; latestQuote: CrateQuoteDto | null };

/** `POST /crates/requests`. */
export type CreateCrateResponse = {
  crate: CrateDto;
  request: CrateRequestDto;
  coverage: CrateCoverage;
};

/** One crate in `GET /crates`. */
export type CrateSummaryDto = {
  id: string;
  title: string | null;
  status: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

/** `GET /crates`: the caller's crates, newest `updatedAt` first. */
export type ListCratesResponse = { crates: CrateSummaryDto[] };

/** `POST /crates/:id/items/:trackId/swap`. */
export type SwapCrateItemResponse = { crate: CrateDto; swapped: boolean };
