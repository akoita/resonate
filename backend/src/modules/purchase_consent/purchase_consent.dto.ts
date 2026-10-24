import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import {
  PURCHASE_CONSENT_LICENSE_TYPES,
  PURCHASE_CONSENT_SURFACE_NAMES,
} from "./purchase_consent.constants";

/** Body of `POST /purchase-consents`: the buyer's choice at checkout, before paying. */
export class RecordPurchaseConsentDto {
  @IsIn(PURCHASE_CONSENT_SURFACE_NAMES)
  surface!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subjectId!: string;

  /** True: "deliver now". False: "wait 14 days" (not offered for a mint). */
  @IsBoolean()
  consented!: boolean;

  /** The explicit checkbox: required (and only valid) with `consented`. */
  @IsBoolean()
  acknowledgedWaiver!: boolean;

  /** The wording version the buyer was shown (`GET /purchase-consents/wording`). */
  @IsString()
  @MaxLength(64)
  textVersion!: string;

  @IsOptional()
  @IsIn(PURCHASE_CONSENT_LICENSE_TYPES)
  licenseType?: string;

  /** Only for a surface with no catalogue item to look up (a credit top-up). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subjectLabel?: string;
}

/** Body of `POST /purchase-consents/:id/link`: attach the payment once it is known. */
export class LinkPurchaseConsentDto {
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/)
  transactionHash?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  purchaseRef?: string;
}
