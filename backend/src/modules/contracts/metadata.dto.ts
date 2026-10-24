import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import type { RightsEvidenceDraftInput } from "../rights/rights-evidence";

/**
 * Metadata and rights bodies (#2197). Type checks only. The handlers keep their
 * own presence checks and answer them with their own messages (`action`,
 * `submitter`, `party`, `evidenceURI`, `vote`, `jurorAddr`), so those fields
 * stay optional here; a field that is sent must have the right type. Evidence
 * drafts are normalized by the rights services.
 */
export class SubmitDisputeEvidenceDto {
  @IsOptional()
  @IsString()
  submitter!: string;

  @IsOptional()
  @IsString()
  party!: string;

  @IsOptional()
  @IsString()
  evidenceURI!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

/** `deadlineHours` stays undecorated: the service clamps it with `Math.max`, which also reads numeric strings. */
export class EscalateDisputeToJuryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jurors!: string[];

  deadlineHours?: number;
}

export class CastJuryVoteDto {
  @IsOptional()
  @IsString()
  jurorAddr!: string;

  @IsOptional()
  @IsString()
  vote!: "reporter" | "creator";
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  disputeFiled?: boolean;

  @IsOptional()
  @IsBoolean()
  disputeResolved?: boolean;

  @IsOptional()
  @IsBoolean()
  disputeAppealed?: boolean;

  @IsOptional()
  @IsBoolean()
  evidenceSubmitted?: boolean;

  @IsOptional()
  @IsBoolean()
  listingExpiringSoon?: boolean;

  @IsOptional()
  @IsBoolean()
  listingExpired?: boolean;
}

export class VerifyCuratorHumanityDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  proof?: string;
}

export class TrustedSourceLinkRequestDto {
  @IsOptional()
  @IsString()
  requestedSourceType?: string;

  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  requestedTrustLevel?: string;

  @IsOptional()
  @IsString()
  proofSummary?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  feedUrl?: string;

  @IsOptional()
  @IsObject()
  traceability?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  evidences?: RightsEvidenceDraftInput[];
}

export class ReviewTrustedSourceLinkRequestDto {
  @IsOptional()
  @IsString()
  action?: "under_review" | "approve" | "deny";

  @IsOptional()
  @IsString()
  decisionReason?: string;

  @IsOptional()
  @IsString()
  trustLevel?: string;

  @IsOptional()
  @IsString()
  reviewState?: string;
}

export class RevokeTrustedSourceLinkDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReleaseRightsUpgradeRequestDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  requestedRoute?: string;

  /** A missing list is read as empty, as before. */
  @IsOptional()
  @IsArray()
  evidences!: RightsEvidenceDraftInput[];
}

export class ReviewReleaseRightsUpgradeRequestDto {
  @IsOptional()
  @IsString()
  action!:
    | "under_review"
    | "more_evidence_requested"
    | "approved_standard_escrow"
    | "approved_trusted_fast_path"
    | "denied";

  @IsOptional()
  @IsString()
  decisionReason?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  evidences?: RightsEvidenceDraftInput[];
}

export class CreateRightsRouteReassessmentDto {
  @IsOptional()
  @IsString()
  trigger?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  recommendedRoute?: string;

  @IsOptional()
  @IsString()
  evidenceSubjectType?: string;

  @IsOptional()
  @IsString()
  evidenceSubjectId?: string;

  @IsOptional()
  @IsString()
  trustedSourceLinkId?: string;

  @IsOptional()
  @IsString()
  rightsUpgradeRequestId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flags?: string[];
}

export class ReviewRightsRouteReassessmentDto {
  @IsOptional()
  @IsString()
  action?: "apply_route" | "confirm_current" | "dismiss";

  @IsOptional()
  @IsString()
  nextRoute?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
