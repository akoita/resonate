import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import {
  ENTITLEMENT_GRANT_PLANS,
  ENTITLEMENT_GRANT_SOURCES,
  type EntitlementGrantPlan,
  type EntitlementGrantSource,
} from "./entitlements.policy";

/** The longest internal note an admin can keep on a grant. */
export const ENTITLEMENT_GRANT_REASON_MAX = 500;

/**
 * `POST /admin/entitlements/grants` (#2406). An admin grants a person the
 * `pro` plan, optionally from a date, until a date (or open-ended), with an
 * internal note. The note is never written into the audit log.
 */
export class CreateEntitlementGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  userId!: string;

  @IsOptional()
  @IsIn(ENTITLEMENT_GRANT_PLANS)
  plan?: EntitlementGrantPlan;

  @IsOptional()
  @IsIn(ENTITLEMENT_GRANT_SOURCES)
  source?: EntitlementGrantSource;

  @IsOptional()
  @IsISO8601({ strict: true })
  validFrom?: string;

  /** Absent or null for an open-ended grant. */
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true })
  validUntil?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ENTITLEMENT_GRANT_REASON_MAX)
  reason!: string;
}

/** `GET /admin/entitlements/grants?userId=` (#2406). */
export class ListEntitlementGrantsQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  userId!: string;
}
