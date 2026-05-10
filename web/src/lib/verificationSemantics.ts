export type HumanVerificationState = "unverified" | "human_verified";

export type ContentProvenanceState =
  | "unverified"
  | "self_attested"
  | "fingerprint_cleared";

export type RightsVerificationState =
  | "not_reviewed"
  | "platform_review_pending"
  | "platform_reviewed"
  | "rights_verified"
  | "rights_disputed";

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
  platform_review_pending: {
    label: "Platform Review Pending",
    description: "Rights evidence is waiting for platform review.",
    color: "#f59e0b",
  },
  platform_reviewed: {
    label: "Platform Reviewed",
    description: "Resonate reviewed submitted evidence, but this is not the same as verified ownership rights.",
    color: "#3b82f6",
  },
  rights_verified: {
    label: "Rights Verified",
    description: "Resonate has enough evidence to represent likely recording ownership or publishing authority.",
    color: "#10b981",
  },
  rights_disputed: {
    label: "Rights Disputed",
    description: "Rights are disputed, blocked, or denied for this release.",
    color: "#ef4444",
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
  return status === "platform_review_pending" ||
    status === "platform_reviewed" ||
    status === "rights_verified" ||
    status === "rights_disputed"
    ? status
    : "not_reviewed";
}

export function normalizePlatformReviewState(status?: string | null): PlatformReviewState {
  return status === "platform_review_pending" || status === "platform_reviewed"
    ? status
    : "not_reviewed";
}
