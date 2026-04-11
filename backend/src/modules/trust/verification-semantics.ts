export const HUMAN_VERIFICATION_STATES = [
  "unverified",
  "human_verified",
] as const;

export const PLATFORM_REVIEW_STATES = [
  "not_reviewed",
  "platform_review_pending",
  "platform_reviewed",
] as const;

export const RIGHTS_VERIFICATION_STATES = [
  "not_reviewed",
  "platform_review_pending",
  "platform_reviewed",
  "rights_verified",
  "rights_disputed",
] as const;

export const CONTENT_PROVENANCE_STATES = [
  "unverified",
  "self_attested",
  "fingerprint_cleared",
] as const;

export type HumanVerificationState =
  (typeof HUMAN_VERIFICATION_STATES)[number];
export type PlatformReviewState = (typeof PLATFORM_REVIEW_STATES)[number];
export type RightsVerificationState =
  (typeof RIGHTS_VERIFICATION_STATES)[number];
export type ContentProvenanceState =
  (typeof CONTENT_PROVENANCE_STATES)[number];

export function deriveCreatorVerificationStates(input: {
  economicTier?: string | null;
  humanVerificationStatus?: string | null;
  humanVerifiedAt?: Date | null;
}) {
  const economicTier = (input.economicTier || "new").toLowerCase();
  const humanVerificationStatus: HumanVerificationState =
    input.humanVerificationStatus === "human_verified" ||
    input.humanVerificationStatus === "verified"
      ? "human_verified"
      : "unverified";

  return {
    economicTier,
    humanVerificationStatus,
    humanVerifiedAt: input.humanVerifiedAt?.toISOString() ?? null,
    // The manual trust-tier override reflects platform trust review, but it
    // remains distinct from any release-level rights verification outcome.
    platformReviewStatus:
      economicTier === "verified"
        ? ("platform_reviewed" as PlatformReviewState)
        : ("not_reviewed" as PlatformReviewState),
  };
}

export function deriveReleaseVerificationStates(input: {
  attested: boolean;
  rightsRoute?: string | null;
  rightsUpgradeRequestStatus?: string | null;
}) {
  const route = (input.rightsRoute || "").toUpperCase();
  const requestStatus = (input.rightsUpgradeRequestStatus || "").toLowerCase();
  const provenanceStatus: ContentProvenanceState = input.attested
    ? "self_attested"
    : "unverified";

  let rightsVerificationStatus: RightsVerificationState = "not_reviewed";
  if (
    requestStatus === "submitted" ||
    requestStatus === "under_review" ||
    requestStatus === "more_evidence_requested"
  ) {
    rightsVerificationStatus = "platform_review_pending";
  } else if (requestStatus === "approved_standard_escrow") {
    rightsVerificationStatus = "platform_reviewed";
  } else if (requestStatus === "approved_trusted_fast_path") {
    rightsVerificationStatus = "rights_verified";
  } else if (requestStatus === "denied") {
    rightsVerificationStatus = "rights_disputed";
  } else if (route === "QUARANTINED_REVIEW") {
    rightsVerificationStatus = "platform_review_pending";
  } else if (route === "BLOCKED") {
    rightsVerificationStatus = "rights_disputed";
  }

  return {
    provenanceStatus,
    rightsVerificationStatus,
  };
}
