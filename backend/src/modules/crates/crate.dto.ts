import { IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { CrateTransitionFacts } from "./crate_ordering";
import type { CrateEntitlements } from "./crate-entitlements";
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

export type CrateDto = {
  id: string;
  status: string;
  title: string | null;
  filters: CrateFilters;
  createdAt: string;
  updatedAt: string;
  entitlements: CrateEntitlements;
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

/** `GET /crates/:id`. */
export type GetCrateResponse = { crate: CrateDto };

/** `POST /crates/requests`. */
export type CreateCrateResponse = {
  crate: CrateDto;
  request: CrateRequestDto;
  coverage: CrateCoverage;
};
