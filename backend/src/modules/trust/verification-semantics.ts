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
  "evidence_submitted",
  "evidence_requested",
  "under_review",
  "approved_with_limits",
  "rights_verified",
  "denied",
  "disputed",
] as const;

export const RIGHTS_REVIEW_STATES = RIGHTS_VERIFICATION_STATES;

export const RELEASE_RIGHTS_UPGRADE_REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "more_evidence_requested",
  "approved_standard_escrow",
  "approved_trusted_fast_path",
  "denied",
] as const;

export const RELEASE_RIGHTS_UPGRADE_STATUS_TO_REVIEW_STATE = {
  submitted: "evidence_submitted",
  under_review: "under_review",
  more_evidence_requested: "evidence_requested",
  approved_standard_escrow: "approved_with_limits",
  approved_trusted_fast_path: "rights_verified",
  denied: "denied",
} as const;

export const RELEASE_RIGHTS_UPGRADE_TRANSITIONS = {
  submitted: [
    "under_review",
    "more_evidence_requested",
    "approved_standard_escrow",
    "approved_trusted_fast_path",
    "denied",
  ],
  under_review: [
    "under_review",
    "more_evidence_requested",
    "approved_standard_escrow",
    "approved_trusted_fast_path",
    "denied",
  ],
  more_evidence_requested: ["submitted"],
  approved_standard_escrow: [],
  approved_trusted_fast_path: [],
  denied: [],
} as const satisfies Record<
  ReleaseRightsUpgradeRequestStatus,
  readonly ReleaseRightsUpgradeRequestStatus[]
>;

export const CONTENT_PROVENANCE_STATES = [
  "unverified",
  "self_attested",
  "fingerprint_cleared",
] as const;

export type HumanVerificationState =
  (typeof HUMAN_VERIFICATION_STATES)[number];
export type PlatformReviewState = (typeof PLATFORM_REVIEW_STATES)[number];
export type ReleaseRightsUpgradeRequestStatus =
  (typeof RELEASE_RIGHTS_UPGRADE_REQUEST_STATUSES)[number];
export type RightsVerificationState =
  (typeof RIGHTS_VERIFICATION_STATES)[number];
export type RightsReviewState = RightsVerificationState;
export type ContentProvenanceState =
  (typeof CONTENT_PROVENANCE_STATES)[number];

function isReleaseRightsUpgradeRequestStatus(
  status?: string | null,
): status is ReleaseRightsUpgradeRequestStatus {
  return RELEASE_RIGHTS_UPGRADE_REQUEST_STATUSES.includes(
    status as ReleaseRightsUpgradeRequestStatus,
  );
}

export function isReleaseRightsUpgradeTransitionAllowed(
  from: string,
  to: string,
) {
  if (
    !isReleaseRightsUpgradeRequestStatus(from) ||
    !isReleaseRightsUpgradeRequestStatus(to)
  ) {
    return false;
  }

  const allowedTransitions = RELEASE_RIGHTS_UPGRADE_TRANSITIONS[from] as readonly string[];
  return allowedTransitions.includes(to);
}

export function getRightsReviewStateForRelease(input: {
  rightsRoute?: string | null;
  rightsUpgradeRequestStatus?: string | null;
}): RightsReviewState {
  const route = (input.rightsRoute || "").toUpperCase();
  const requestStatus = (input.rightsUpgradeRequestStatus || "").toLowerCase();

  if (isReleaseRightsUpgradeRequestStatus(requestStatus)) {
    return RELEASE_RIGHTS_UPGRADE_STATUS_TO_REVIEW_STATE[requestStatus];
  }

  if (route === "BLOCKED") {
    return "disputed";
  }

  if (route === "QUARANTINED_REVIEW") {
    return "under_review";
  }

  return "not_reviewed";
}

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
  const provenanceStatus: ContentProvenanceState = input.attested
    ? "self_attested"
    : "unverified";
  const rightsReviewState = getRightsReviewStateForRelease(input);

  return {
    provenanceStatus,
    rightsReviewState,
    rightsVerificationStatus: rightsReviewState,
  };
}
