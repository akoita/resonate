export const UPLOAD_RIGHTS_POLICY_VERSION = "2026-04-08.v1";

export const UPLOAD_RIGHTS_ROUTES = [
  "BLOCKED",
  "QUARANTINED_REVIEW",
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
] as const;

export type UploadRightsRoute = (typeof UPLOAD_RIGHTS_ROUTES)[number];

export const UPLOAD_RIGHTS_FLAGS = [
  "NEEDS_PROOF_OF_CONTROL",
  "NEEDS_HUMAN_REVIEW",
  "DISPUTE_ELIGIBLE",
  "MAJOR_CATALOG_RISK",
  "RESTRICT_MARKETPLACE",
  "RESTRICT_PAYOUTS",
] as const;

export type UploadRightsFlag = (typeof UPLOAD_RIGHTS_FLAGS)[number];

export type UploadRightsActionProfile = {
  publicVisible: boolean;
  streamingAllowed: boolean;
  stemGenerationAllowed: boolean;
  marketplaceAllowed: boolean;
  payoutRelease: "none" | "held" | "standard" | "trusted";
  escrowProfile: "max" | "strong" | "standard" | "trusted";
};

export type UploadRightsDecision = {
  route: UploadRightsRoute;
  flags: UploadRightsFlag[];
  reason: string;
  policyVersion: string;
  sourceType: string;
  actions: UploadRightsActionProfile;
};

export type UploadRightsEvaluationInput = {
  sourceType: string;
  trustedSourceTypes: string[];
  uploaderTier: string;
  hasMetadataConflict: boolean;
  hasQuarantinedContent: boolean;
  hasDmcaContent: boolean;
};

export const UPLOAD_RIGHTS_ROUTE_ACTIONS: Record<
  UploadRightsRoute,
  UploadRightsActionProfile
> = {
  BLOCKED: {
    publicVisible: false,
    streamingAllowed: false,
    stemGenerationAllowed: false,
    marketplaceAllowed: false,
    payoutRelease: "none",
    escrowProfile: "max",
  },
  QUARANTINED_REVIEW: {
    publicVisible: false,
    streamingAllowed: false,
    stemGenerationAllowed: false,
    marketplaceAllowed: false,
    payoutRelease: "none",
    escrowProfile: "max",
  },
  LIMITED_MONITORING: {
    publicVisible: true,
    streamingAllowed: true,
    stemGenerationAllowed: true,
    marketplaceAllowed: false,
    payoutRelease: "held",
    escrowProfile: "strong",
  },
  STANDARD_ESCROW: {
    publicVisible: true,
    streamingAllowed: true,
    stemGenerationAllowed: true,
    marketplaceAllowed: true,
    payoutRelease: "standard",
    escrowProfile: "standard",
  },
  TRUSTED_FAST_PATH: {
    publicVisible: true,
    streamingAllowed: true,
    stemGenerationAllowed: true,
    marketplaceAllowed: true,
    payoutRelease: "trusted",
    escrowProfile: "trusted",
  },
};

const ROUTE_SEVERITY: Record<UploadRightsRoute, number> = {
  TRUSTED_FAST_PATH: 1,
  STANDARD_ESCROW: 2,
  LIMITED_MONITORING: 3,
  QUARANTINED_REVIEW: 4,
  BLOCKED: 5,
};

export function compareRouteSeverity(
  left: UploadRightsRoute,
  right: UploadRightsRoute,
): number {
  return ROUTE_SEVERITY[left] - ROUTE_SEVERITY[right];
}

export function getUploadRightsActions(
  route: UploadRightsRoute,
): UploadRightsActionProfile {
  return UPLOAD_RIGHTS_ROUTE_ACTIONS[route];
}

export function evaluateUploadRightsDecision(
  input: UploadRightsEvaluationInput,
): UploadRightsDecision {
  const normalizedSource = normalizeSourceType(input.sourceType);
  const tier = (input.uploaderTier || "new").toLowerCase();
  const flags = new Set<UploadRightsFlag>();
  let route: UploadRightsRoute;
  let reason: string;

  if (input.hasDmcaContent) {
    route = "BLOCKED";
    flags.add("NEEDS_HUMAN_REVIEW");
    flags.add("RESTRICT_MARKETPLACE");
    flags.add("RESTRICT_PAYOUTS");
    reason = "Content is blocked because a DMCA-removed track is attached to this release.";
  } else if (input.hasQuarantinedContent) {
    route = "QUARANTINED_REVIEW";
    flags.add("NEEDS_HUMAN_REVIEW");
    flags.add("DISPUTE_ELIGIBLE");
    flags.add("RESTRICT_MARKETPLACE");
    flags.add("RESTRICT_PAYOUTS");
    reason =
      "Content is quarantined because one or more tracks match suspicious or duplicate audio already in the catalog.";
  } else if (input.hasMetadataConflict) {
    route = "QUARANTINED_REVIEW";
    flags.add("NEEDS_HUMAN_REVIEW");
    flags.add("DISPUTE_ELIGIBLE");
    flags.add("MAJOR_CATALOG_RISK");
    flags.add("RESTRICT_MARKETPLACE");
    flags.add("RESTRICT_PAYOUTS");
    reason =
      "Upload metadata conflicts with an existing catalog release and requires manual rights review.";
  } else if (input.trustedSourceTypes.includes(normalizedSource)) {
    route = "TRUSTED_FAST_PATH";
    reason =
      "Upload came from a trusted source and can follow the lowest-friction publication path.";
  } else if (tier === "verified" || tier === "trusted") {
    route = "STANDARD_ESCROW";
    reason =
      "Uploader has enough trust history to publish under the standard escrow path.";
  } else {
    route = "LIMITED_MONITORING";
    flags.add("NEEDS_PROOF_OF_CONTROL");
    flags.add("RESTRICT_MARKETPLACE");
    flags.add("RESTRICT_PAYOUTS");
    reason =
      "Upload is allowed to proceed, but the uploader does not yet have enough trust for full publication rights.";
  }

  return {
    route,
    flags: Array.from(flags),
    reason,
    policyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
    sourceType: normalizedSource,
    actions: getUploadRightsActions(route),
  };
}

export function normalizeSourceType(sourceType?: string | null): string {
  return (sourceType || "direct_upload").trim().toLowerCase() || "direct_upload";
}

export function parseTrustedSourceTypes(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((value) => normalizeSourceType(value))
    .filter(Boolean);
}

export function dedupeFlags(
  ...flagSets: Array<ReadonlyArray<UploadRightsFlag | string> | null | undefined>
): UploadRightsFlag[] {
  const merged = new Set<UploadRightsFlag>();
  for (const entries of flagSets) {
    for (const entry of entries || []) {
      if (UPLOAD_RIGHTS_FLAGS.includes(entry as UploadRightsFlag)) {
        merged.add(entry as UploadRightsFlag);
      }
    }
  }
  return Array.from(merged);
}
