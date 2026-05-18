export type HumanVerificationState = "unverified" | "human_verified";

export type ContentProvenanceState =
  | "unverified"
  | "self_attested"
  | "fingerprint_cleared";

export type RightsVerificationState =
  | "not_reviewed"
  | "evidence_submitted"
  | "evidence_requested"
  | "under_review"
  | "approved_with_limits"
  | "rights_verified"
  | "denied"
  | "disputed";

export type RightsReviewState = RightsVerificationState;

export type RightsUploaderClassification =
  | "unverified_uploader"
  | "verified_independent"
  | "trusted_creator"
  | "trusted_source_account";

export type PlatformReviewState =
  | "not_reviewed"
  | "platform_review_pending"
  | "platform_reviewed";

export type VerificationDisplay = {
  label: string;
  description: string;
  color: string;
};

export const HUMAN_VERIFICATION_COPY: Record<HumanVerificationState, VerificationDisplay> = {
  unverified: {
    label: "Not Human Verified",
    description: "No personhood or anti-sybil check is recorded for this wallet.",
    color: "#6b7280",
  },
  human_verified: {
    label: "Human Verified",
    description: "This wallet passed a personhood or anti-sybil check. This does not verify music ownership rights.",
    color: "#10b981",
  },
};

export const CONTENT_PROVENANCE_COPY: Record<ContentProvenanceState, VerificationDisplay> = {
  unverified: {
    label: "Not Self-Attested",
    description: "No creator wallet self-attestation is recorded for this release.",
    color: "#6b7280",
  },
  self_attested: {
    label: "Self-Attested On-Chain",
    description: "The creator wallet signed provenance for this release. This is not independent rights verification.",
    color: "#10b981",
  },
  fingerprint_cleared: {
    label: "Fingerprint Cleared",
    description: "Configured fingerprint checks did not find a conflicting match.",
    color: "#10b981",
  },
};

export const RIGHTS_VERIFICATION_COPY: Record<RightsVerificationState, VerificationDisplay> = {
  not_reviewed: {
    label: "Rights Not Reviewed",
    description: "Resonate has not independently reviewed rights evidence for this release.",
    color: "#6b7280",
  },
  evidence_submitted: {
    label: "Evidence Submitted",
    description: "The creator submitted rights evidence and it is waiting for ops review.",
    color: "#f59e0b",
  },
  evidence_requested: {
    label: "Evidence Requested",
    description: "Ops requested stronger rights evidence before deciding marketplace access.",
    color: "#f59e0b",
  },
  under_review: {
    label: "Under Review",
    description: "Ops is reviewing submitted release rights evidence.",
    color: "#f59e0b",
  },
  approved_with_limits: {
    label: "Approved With Limits",
    description: "Resonate reviewed submitted evidence and approved marketplace access with standard escrow limits. This is not verified ownership rights.",
    color: "#3b82f6",
  },
  rights_verified: {
    label: "Rights Verified",
    description: "Resonate has enough evidence to represent likely recording ownership or publishing authority.",
    color: "#10b981",
  },
  denied: {
    label: "Denied",
    description: "The submitted rights evidence was denied for marketplace access.",
    color: "#ef4444",
  },
  disputed: {
    label: "Disputed",
    description: "Rights are disputed, blocked, or contradicted for this release.",
    color: "#ef4444",
  },
};

export const RIGHTS_REVIEW_COPY = RIGHTS_VERIFICATION_COPY;

export const RIGHTS_UPLOADER_CLASSIFICATION_COPY: Record<
  RightsUploaderClassification,
  VerificationDisplay
> = {
  unverified_uploader: {
    label: "Unverified Uploader",
    description: "Uploads can publish under limited monitoring while proof of control is collected.",
    color: "#f59e0b",
  },
  verified_independent: {
    label: "Verified Independent",
    description: "The artist has enough account trust to use standard escrow, but rights remain release-scoped.",
    color: "#3b82f6",
  },
  trusted_creator: {
    label: "Trusted Creator",
    description: "The creator has stronger platform trust and still uses auditable release rights review.",
    color: "#8b5cf6",
  },
  trusted_source_account: {
    label: "Trusted Source Account",
    description: "An approved distributor, label, artist-team, or catalog-operator link can use the trusted fast path.",
    color: "#10b981",
  },
};

export const PLATFORM_REVIEW_COPY: Record<PlatformReviewState, VerificationDisplay> = {
  not_reviewed: {
    label: "Not Platform Reviewed",
    description: "No platform review state is recorded for this creator.",
    color: "#6b7280",
  },
  platform_review_pending: {
    label: "Platform Review Pending",
    description: "Platform review is pending.",
    color: "#f59e0b",
  },
  platform_reviewed: {
    label: "Platform Reviewed",
    description: "This creator has a platform-reviewed economic trust tier. This does not independently verify release rights.",
    color: "#3b82f6",
  },
};

export function normalizeHumanVerificationState(status?: string | null): HumanVerificationState {
  return status === "human_verified" || status === "verified"
    ? "human_verified"
    : "unverified";
}

export function normalizeContentProvenanceState(
  status?: string | null,
  attested = false,
): ContentProvenanceState {
  if (status === "fingerprint_cleared") return "fingerprint_cleared";
  if (status === "self_attested" || (status == null && attested)) return "self_attested";
  return "unverified";
}

export function normalizeRightsVerificationState(status?: string | null): RightsVerificationState {
  if (status === "platform_review_pending") return "under_review";
  if (status === "platform_reviewed") return "approved_with_limits";
  if (status === "rights_disputed") return "disputed";

  return status === "evidence_submitted" ||
    status === "evidence_requested" ||
    status === "under_review" ||
    status === "approved_with_limits" ||
    status === "rights_verified" ||
    status === "denied" ||
    status === "disputed"
    ? status
    : "not_reviewed";
}

export function normalizePlatformReviewState(status?: string | null): PlatformReviewState {
  return status === "platform_review_pending" || status === "platform_reviewed"
    ? status
    : "not_reviewed";
}
