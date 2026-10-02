import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import {
  CRATE_LICENSE_TYPES,
  CRATE_STEM_TYPES,
  type CrateLicenseType,
  type CrateStemType,
} from "./crate.types";
import type { CrateTierRightsDto } from "./crate_license_rights";
import {
  CRATE_QUOTE_MAX_LINES,
  CRATE_QUOTE_MAX_STEM_TYPES,
  CRATE_QUOTE_SETTLE_DROP_REASONS,
  type CrateQuoteSettleDropReason,
} from "./crate_quote";

/**
 * HTTP contracts of the crate quote (#1964, docs/rfc/taste-engine.md §5.4).
 *
 * Request bodies are validated by the global ValidationPipe (class DTOs only);
 * the service validates them again because it is also called without HTTP.
 */

/** One crate line of a quote request, with the DJ's per-line overrides. */
export class CrateQuoteLineRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  trackId!: string;

  /** Omitted: the crate's license filter, else the cheapest listed tier. */
  @IsOptional()
  @IsIn([...CRATE_LICENSE_TYPES])
  licenseType?: CrateLicenseType;

  /** Omitted: the crate's required stems, else every listed stem at the tier. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CRATE_QUOTE_MAX_STEM_TYPES)
  @IsIn([...CRATE_STEM_TYPES], { each: true })
  stemTypes?: CrateStemType[];
}

/** `POST /crates/:id/quote`. Omitted `lines` quotes every line of the crate. */
export class CreateCrateQuoteDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CRATE_QUOTE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => CrateQuoteLineRequestDto)
  lines?: CrateQuoteLineRequestDto[];
}

/** A quoted stem the browser left out of the transaction it sent. */
export class CrateQuoteDroppedLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  quoteLineId!: string;

  @IsIn([...CRATE_QUOTE_SETTLE_DROP_REASONS])
  reason!: CrateQuoteSettleDropReason;
}

/** Most stems a quote can hold: every line times every stem type. */
export const CRATE_QUOTE_MAX_ITEMS = CRATE_QUOTE_MAX_LINES * CRATE_QUOTE_MAX_STEM_TYPES;

/** `POST /crates/:id/quotes/:quoteId/settle`. */
export class SettleCrateQuoteDto {
  /** The transaction that carried the batched user operation. */
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/)
  transactionHash!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CRATE_QUOTE_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CrateQuoteDroppedLineDto)
  dropped?: CrateQuoteDroppedLineDto[];
}

/** The proof a stem was bought: its `Sold` log, plus our own purchase row. */
export type CrateQuoteReceiptDto = {
  transactionHash: string;
  logIndex: number;
  /** `totalPaid` of the Sold log, in payment-token units. */
  totalPaidUnits: string;
  /** `StemPurchase.id` once the indexer has recorded it; else null. */
  purchaseId: string | null;
};

/**
 * One stem of a quote line. Price fields are null on a dropped stem the chain
 * was not asked to price (for example `not_listed`).
 */
export type CrateQuoteItemDto = {
  quoteLineId: string;
  stemId: string;
  stemType: string;
  /** "quoted" | "dropped" | "settled" | "failed" */
  status: string;
  /** Fixed code (crate_quote.ts) for a dropped or failed stem; else null. */
  reason: string | null;
  /** On-chain listing id, as a string. */
  listingId: string | null;
  tokenId: string | null;
  paymentToken: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Total price in payment-token units, as a string. */
  totalUnits: string | null;
  /** The same, formatted in the token's decimals. */
  total: string | null;
  totalUsd: string | null;
  /** What the artist side receives: the seller's amount plus the royalty. */
  artistShareUnits: string | null;
  /** The platform's fee from the contract's `quoteBuy` (ADR-BM-6 Line 3). */
  platformFeeUnits: string | null;
  receipt: CrateQuoteReceiptDto | null;
};

/** One crate line (track) of a quote, with the rights of its tier. */
export type CrateQuoteLineDto = {
  /** Position of the line in the crate. */
  position: number;
  trackId: string;
  title: string | null;
  artistName: string | null;
  licenseType: CrateLicenseType;
  rights: CrateTierRightsDto;
  items: CrateQuoteItemDto[];
};

export type CrateQuoteTotalDto = {
  paymentToken: string;
  symbol: string;
  decimals: number;
  totalUnits: string;
  total: string;
  totalUsd: string | null;
};

/** A crate quote. Returned by quote, settle and `GET .../quotes/:quoteId`. */
export type CrateQuoteDto = {
  id: string;
  crateId: string;
  /** "open" | "submitted" | "settled" | "partial" | "failed" */
  status: string;
  chainId: number;
  marketplaceAddress: string;
  /** The DJ's smart account the quote was priced for. */
  buyerAddress: string;
  /** The offer is good until then; a mined transaction settles regardless. */
  expiresAt: string;
  transactionHash: string | null;
  lines: CrateQuoteLineDto[];
  /** Per payment token, over stems still quoted or settled. */
  totals: CrateQuoteTotalDto[];
  /** Sum of the totals in USD, or null when any token's USD value is unknown. */
  totalUsd: string | null;
  /** The crate's `maxTotalUsd`, or null. */
  budgetUsd: number | null;
  overBudget: boolean;
};
