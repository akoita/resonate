import type { UploadRightsRoute } from "../rights/upload-rights-policy";

export const REMIX_POLICY_VERSION = "2026-06-11.v3";

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
  "artist_remix_disabled",
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
   * Source opt-in hook. Artist-level remix consent defaults to allowed, and
   * disabled artist consent is a global revocation override.
   */
  sourceOptedIn: boolean;
  /** Artist.remixConsent resolved server-side from the source release artist. */
  artistRemixConsent?: "allowed" | "disabled";
  /**
   * True when the caller named specific stems (project creation, generation,
   * stem-scoped CTAs): every selected stem must then be licensed and
   * remixable. False for track-default requests (release-page CTA), where
   * one licensed stem is enough and non-remixable mints are simply excluded
   * rather than blocking the track.
   */
  explicitStemSelection: boolean;
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

  if (reasons.length === 0 && input.artistRemixConsent === "disabled") {
    reasons.push({
      code: "artist_remix_disabled",
      message: "The artist has disabled Remix Studio access for this source.",
    });
  } else if (reasons.length === 0 && !input.sourceOptedIn) {
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

  // Explicitly selecting a non-remixable mint is a hard denial. For
  // track-default requests those stems are excluded from consideration
  // instead, so one locked stem cannot block remixing the rest of the track.
  if (input.explicitStemSelection) {
    const nonRemixableStems = input.stems.filter(
      (stem) => stem.mintRemixable === false,
    );
    for (const stem of nonRemixableStems) {
      reasons.push({
        code: "stem_not_remixable",
        message: `Stem ${stem.stemId} was minted without remix rights.`,
      });
    }
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

  const candidateStems = input.explicitStemSelection
    ? input.stems
    : input.stems.filter((stem) => stem.mintRemixable !== false);
  const licensedStems = candidateStems.filter((stem) => stem.licensed);
  // Explicit selections must be fully licensed (they become project/
  // generation inputs verbatim). Track-default requests are CTA gating:
  // one licensed stem makes the track remixable with the licensed subset.
  const licenseSatisfied = input.explicitStemSelection
    ? candidateStems.length > 0 && licensedStems.length === candidateStems.length
    : licensedStems.length > 0;
  if (!licenseSatisfied) {
    return {
      allowed: false,
      requiredLicense: "remix",
      allowedActions: [],
      reasons: [
        {
          code: "license_required",
          message:
            candidateStems.length === 0
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
