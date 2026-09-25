import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Operator/promo grant request (#1334). Credits are USD cents; the operator
 * seeds a user's meter on staging. The upper bound keeps a fat-fingered grant
 * from minting an absurd balance ($100,000 cap).
 */
export class GrantCreditsDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reason!: string;
}

/**
 * A user out of credits asking an operator to top them up (#1334). The caller's
 * identity comes from the JWT — the body carries only an optional short note.
 */
export class RequestCreditsDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

/** Queue filter for GET /credits/requests (#1885). Defaults to `pending`. */
export const CREDIT_REQUEST_FILTERS = ["pending", "resolved", "all"] as const;

export class ListCreditRequestsQueryDto {
  @IsOptional()
  @IsIn(CREDIT_REQUEST_FILTERS)
  status?: (typeof CREDIT_REQUEST_FILTERS)[number];
}

/**
 * Operator grant of a queued credit request (#1885). Same $100,000 cap as the
 * direct grant; the recipient comes from the request, not the body.
 */
export class GrantCreditRequestDto {
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}

/** Operator dismissal of a queued credit request (#1885). */
export class DismissCreditRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
