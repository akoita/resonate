import type { UploadRightsRoute } from "../rights/upload-rights-policy";

export const REMIX_POLICY_VERSION = "2026-06-09.v1";

export const REMIX_ACTIONS = [
  "private_draft",
  "publish_resonate",
  "export",
] as const;

export type RemixAction = (typeof REMIX_ACTIONS)[number];

export const REMIX_DENIAL_CODES = [
  "source_blocked",
  "source_quarantined",
  "source_removed",
  "source_under_monitoring",
  "source_rights_unknown",
  "source_not_opted_in",
  "stem_not_remixable",
  "license_required",
] as const;

export type RemixDenialCode = (typeof REMIX_DENIAL_CODES)[number];

export type RemixDenialReason = {
  code: RemixDenialCode;
  message: string;
};

export type RemixStemPolicyInput = {
  stemId: string;
  /** StemNftMint.remixable when a mint row exists, null when unminted. */
  mintRemixable: boolean | null;
  /** Whether the user holds a qualifying remix license/purchase for this stem. */
  licensed: boolean;
};

export type RemixEligibilityPolicyInput = {
  /** Track.rightsRoute falling back to Release.rightsRoute. */
  rightsRoute: string | null;
  /** Track.contentStatus: clean, quarantined, dmca_removed. */
  contentStatus: string;
  /**
   * Source opt-in hook. Until artist-level remix opt-in settings exist, the
   * caller passes the conservative default computed by the service.
   */
  sourceOptedIn: boolean;
  stems: RemixStemPolicyInput[];
};

export type RemixEligibilityDecision = {
  allowed: boolean;
  requiredLicense: "remix" | null;
  allowedActions: RemixAction[];
  reasons: RemixDenialReason[];
  policyVersion: string;
};

export const REMIX_ELIGIBLE_ROUTES: readonly UploadRightsRoute[] = [
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
];

function sourceDenialReasons(
  input: RemixEligibilityPolicyInput,
): RemixDenialReason[] {
  const reasons: RemixDenialReason[] = [];

  if (input.contentStatus === "quarantined") {
    reasons.push({
      code: "source_quarantined",
      message: "This source is under content review and cannot be remixed.",
    });
  }
  if (input.contentStatus === "dmca_removed") {
    reasons.push({
      code: "source_removed",
      message: "This source was removed after a rights complaint.",
    });
  }

  const route = input.rightsRoute;
  if (route === "BLOCKED") {
    reasons.push({
      code: "source_blocked",
      message: "This source is blocked by rights policy.",
    });
  } else if (route === "QUARANTINED_REVIEW") {
    reasons.push({
      code: "source_quarantined",
      message: "This source is quarantined pending rights review.",
    });
  } else if (route === "LIMITED_MONITORING") {
    // Conservative default: monitored sources are not remixable yet.
    reasons.push({
      code: "source_under_monitoring",
      message:
        "This source is under rights monitoring and is not remixable yet.",
    });
  } else if (!route || !REMIX_ELIGIBLE_ROUTES.includes(route as UploadRightsRoute)) {
    reasons.push({
      code: "source_rights_unknown",
      message: "The rights state of this source has not been verified.",
    });
  }

  if (reasons.length === 0 && !input.sourceOptedIn) {
    reasons.push({
      code: "source_not_opted_in",
      message: "The rightsholder has not enabled remixing for this source.",
    });
  }

  return reasons;
}

export function evaluateRemixEligibility(
  input: RemixEligibilityPolicyInput,
): RemixEligibilityDecision {
  const reasons = sourceDenialReasons(input);

  const nonRemixableStems = input.stems.filter(
    (stem) => stem.mintRemixable === false,
  );
  for (const stem of nonRemixableStems) {
    reasons.push({
      code: "stem_not_remixable",
      message: `Stem ${stem.stemId} was minted without remix rights.`,
    });
  }

  if (reasons.length > 0) {
    return {
      allowed: false,
      requiredLicense: null,
      allowedActions: [],
      reasons,
      policyVersion: REMIX_POLICY_VERSION,
    };
  }

  const unlicensedStems = input.stems.filter((stem) => !stem.licensed);
  if (input.stems.length === 0 || unlicensedStems.length > 0) {
    return {
      allowed: false,
      requiredLicense: "remix",
      allowedActions: [],
      reasons: [
        {
          code: "license_required",
          message:
            input.stems.length === 0
              ? "Select at least one stem and hold a remix license for it."
              : "A remix license is required for the selected stems.",
        },
      ],
      policyVersion: REMIX_POLICY_VERSION,
    };
  }

  // v1 grants private drafts only; publish/export open in later slices once
  // publication policy and exportable license terms exist.
  return {
    allowed: true,
    requiredLicense: null,
    allowedActions: ["private_draft"],
    reasons: [],
    policyVersion: REMIX_POLICY_VERSION,
  };
}
