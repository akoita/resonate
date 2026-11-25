import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Who the reporter is in relation to the work (#2664). */
export const DMCA_CLAIMANT_CAPACITIES = ["rights_holder", "authorized_agent", "artist_themselves", "someone_else"] as const;
export type DmcaClaimantCapacity = (typeof DMCA_CLAIMANT_CAPACITIES)[number];

/** What the notice is about (#2664). Older reports are all `copyright`. */
export const DMCA_CATEGORIES = ["copyright", "impersonation", "illegal_content", "other"] as const;
export type DmcaCategory = (typeof DMCA_CATEGORIES)[number];

export const DMCA_REASON_MAX = 5000;
export const DMCA_STATEMENT_MAX = 2000;

/**
 * Body of `POST /api/dmca/report` (#2664). Public, no account. `website` is a
 * honeypot field the web form hides from people: a value there means a bot,
 * and the notice is not stored.
 */
export class FileDmcaReportDto {
  @IsString()
  @MaxLength(64)
  trackId!: string;

  @IsString()
  @MaxLength(200)
  claimantName!: string;

  @IsOptional()
  @IsIn(DMCA_CLAIMANT_CAPACITIES)
  claimantCapacity?: DmcaClaimantCapacity;

  @IsEmail({}, { message: "claimantEmail must be an email address" })
  @MaxLength(320)
  claimantEmail!: string;

  /** The work concerned: its title, or a link to it elsewhere. */
  @IsString()
  @MaxLength(2000)
  originalWorkUrl!: string;

  /** Where the content is on Resonate (an in-app link). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contentLocation?: string;

  @IsOptional()
  @IsIn(DMCA_CATEGORIES)
  category?: DmcaCategory;

  @IsString()
  @MaxLength(DMCA_REASON_MAX)
  reason!: string;

  /** The reporter confirms the notice is accurate and made in good faith. */
  @IsOptional()
  @IsBoolean()
  goodFaith?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

/** Body of `POST /api/dmca/counter`. */
export class FileDmcaCounterDto {
  @IsString()
  @MaxLength(64)
  reportId!: string;

  @IsString()
  @MaxLength(DMCA_REASON_MAX)
  counterNotice!: string;
}

/** Body of `PATCH /api/dmca/:id/resolve`. */
export class ResolveDmcaReportDto {
  @IsIn(["upheld", "rejected"])
  outcome!: "upheld" | "rejected";

  /** Why, in plain words; shown to the uploader with the decision. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DMCA_STATEMENT_MAX)
  statementOfReasons?: string;
}
