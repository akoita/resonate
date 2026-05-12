import type {
  Release,
  ReleaseContentProtectionData,
  ReleaseRightsUpgradeRequestedRoute,
  RightsEvidenceKind,
  RightsEvidenceStrength,
  TrustedSourceArtistLinkRecord,
  TrustedSourceTrustLevel,
  TrustedSourceType,
} from "./api";

export type RightsOnboardingPrefill = {
  requestedRoute: ReleaseRightsUpgradeRequestedRoute;
  evidenceKind: RightsEvidenceKind;
  title: string;
  sourceUrl: string;
  claimedRightsholder: string;
  sourceLabel: string;
  artistName: string;
  description: string;
  strength: RightsEvidenceStrength;
  summary: string;
};

export type GuidedRightsOnboardingContext = {
  mode: "guided_trusted_source";
  signalLabel: string;
  reasons: string[];
  recommendedRoute: ReleaseRightsUpgradeRequestedRoute;
  trustedSourceLinkId: string;
  trustedSourceId: string;
  trustedSourceName: string;
  trustedSourceType: TrustedSourceType;
  trustedSourceTrustLevel: TrustedSourceTrustLevel;
  prefill: RightsOnboardingPrefill;
};

export type ManualRightsOnboardingContext = {
  mode: "manual";
  fallbackReason: string;
};

export type RightsOnboardingContext =
  | GuidedRightsOnboardingContext
  | ManualRightsOnboardingContext;

const TRUST_LEVEL_RANK: Record<TrustedSourceTrustLevel, number> = {
  standard: 0,
  high: 1,
  very_high: 2,
};

function normalizeUrlCandidate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("ipfs://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function trustedSourceEvidenceUrl(link: TrustedSourceArtistLinkRecord) {
  return (
    normalizeUrlCandidate(link.trustedSource?.feedUrl) ||
    normalizeUrlCandidate(link.trustedSource?.domain) ||
    normalizeUrlCandidate(link.trustedSource?.sourceKey)
  );
}

function formatSourceType(type: TrustedSourceType) {
  return type.replaceAll("_", " ");
}

function chooseBestTrustedSourceLink(links: TrustedSourceArtistLinkRecord[]) {
  return [...links]
    .filter((link) => link.status === "active" && link.trustedSource?.reviewState === "active")
    .sort((a, b) => TRUST_LEVEL_RANK[b.trustLevel] - TRUST_LEVEL_RANK[a.trustLevel])[0] || null;
}

function recommendedRouteForTrustLevel(
  trustLevel: TrustedSourceTrustLevel,
): ReleaseRightsUpgradeRequestedRoute {
  return trustLevel === "high" || trustLevel === "very_high"
    ? "TRUSTED_FAST_PATH"
    : "STANDARD_ESCROW";
}

function evidenceStrengthForTrustLevel(
  trustLevel: TrustedSourceTrustLevel,
): RightsEvidenceStrength {
  return trustLevel === "very_high" ? "very_high" : "high";
}

export function buildReleaseRightsOnboardingContext(input: {
  release?: Release | null;
  releaseProtection?: ReleaseContentProtectionData | null;
  trustedSourceLinks?: TrustedSourceArtistLinkRecord[] | null;
}): RightsOnboardingContext {
  const release = input.release;

  if (!release) {
    return { mode: "manual", fallbackReason: "Release context is not loaded yet." };
  }

  if ((release.rightsRoute || "").toUpperCase() === "BLOCKED") {
    return {
      mode: "manual",
      fallbackReason: "Blocked releases require manual rights review before marketplace access.",
    };
  }

  const trustedSourceLink = chooseBestTrustedSourceLink(input.trustedSourceLinks || []);

  if (!trustedSourceLink?.trustedSource) {
    return {
      mode: "manual",
      fallbackReason: "No active trusted-source link is available for guided onboarding.",
    };
  }

  const trustedSource = trustedSourceLink.trustedSource;
  const trustedSourceName = trustedSource.name;
  const recommendedRoute = recommendedRouteForTrustLevel(trustedSourceLink.trustLevel);
  const artistName = release.primaryArtist || release.artist?.displayName || "";
  const claimedRightsholder = release.label || artistName || trustedSourceName;
  const sourceTypeLabel = formatSourceType(trustedSourceLink.sourceType);
  const sourceUrl = trustedSourceEvidenceUrl(trustedSourceLink);
  const humanVerified =
    input.releaseProtection?.humanVerificationStatus === "human_verified";

  const reasons = [
    `Active ${sourceTypeLabel} link: ${trustedSourceName}`,
    `${trustedSourceLink.trustLevel.replaceAll("_", " ")} trusted-source trust level`,
  ];
  if (humanVerified) {
    reasons.push("Human verification is present as a supporting anti-sybil signal");
  }

  return {
    mode: "guided_trusted_source",
    signalLabel: `${trustedSourceName} trusted-source link`,
    reasons,
    recommendedRoute,
    trustedSourceLinkId: trustedSourceLink.id,
    trustedSourceId: trustedSourceLink.trustedSourceId,
    trustedSourceName,
    trustedSourceType: trustedSourceLink.sourceType,
    trustedSourceTrustLevel: trustedSourceLink.trustLevel,
    prefill: {
      requestedRoute: recommendedRoute,
      evidenceKind: "trusted_catalog_reference",
      title: `${trustedSourceName} catalog link`,
      sourceUrl,
      claimedRightsholder,
      sourceLabel: trustedSource.domain || trustedSourceName,
      artistName,
      description:
        `Approved ${sourceTypeLabel} link ${trustedSourceName} connects this artist profile to the release catalog context. ` +
        "Reviewers should confirm the linked source supports marketplace access for this release.",
      strength: evidenceStrengthForTrustLevel(trustedSourceLink.trustLevel),
      summary:
        `${release.title} is connected to approved ${sourceTypeLabel} ${trustedSourceName}. ` +
        `Please review the linked source evidence for ${recommendedRoute.replaceAll("_", " ")} marketplace access.`,
    },
  };
}
