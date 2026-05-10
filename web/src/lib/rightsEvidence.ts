import type {
  RightsEvidenceKind,
  RightsEvidenceStrength,
  RightsEvidenceVerificationStatus,
} from "./api";

export type CreatorRightsEvidenceOption = {
  value: RightsEvidenceKind;
  label: string;
  hint: string;
  titlePlaceholder: string;
  sourceUrlPlaceholder: string;
  sourceLabelPlaceholder: string;
  contextPlaceholder: string;
};

export const SUBMITTED_RIGHTS_EVIDENCE_COPY =
  "Submitted evidence starts a platform review. It is not verified ownership until reviewers approve the request.";

export const CREATOR_RIGHTS_EVIDENCE_OPTIONS: CreatorRightsEvidenceOption[] = [
  {
    value: "proof_of_control",
    label: "Proof of control",
    hint: "Official profile, verified social, artist website, or distributor dashboard proof.",
    titlePlaceholder: "Official distributor dashboard",
    sourceUrlPlaceholder: "https://...",
    sourceLabelPlaceholder: "Distributor portal, official artist site",
    contextPlaceholder: "Explain how this source proves you control the release profile or release dashboard.",
  },
  {
    value: "legal_notice",
    label: "Publishing authority",
    hint: "Signed declaration, authorization letter, split sheet, label agreement, or publisher confirmation.",
    titlePlaceholder: "Signed publishing authorization",
    sourceUrlPlaceholder: "https://...",
    sourceLabelPlaceholder: "Publisher letter, label authorization",
    contextPlaceholder: "Name the authorizing party and describe the publishing or label authority being granted.",
  },
  {
    value: "prior_publication",
    label: "Prior distribution",
    hint: "Canonical release pages, prior publication records, official DSP links, or dated announcements.",
    titlePlaceholder: "Original DSP release page",
    sourceUrlPlaceholder: "https://...",
    sourceLabelPlaceholder: "DSP page, Bandcamp release, dated announcement",
    contextPlaceholder: "Describe how the publication date and artist identity match this release.",
  },
  {
    value: "rights_metadata",
    label: "Ownership metadata",
    hint: "ISRC, UPC, label copy, distributor metadata, split sheet, or rights package reference.",
    titlePlaceholder: "ISRC and UPC metadata package",
    sourceUrlPlaceholder: "https://...",
    sourceLabelPlaceholder: "Metadata sheet, distributor export",
    contextPlaceholder: "Call out ISRC, UPC, label, rightsholder, and any metadata that ties this release to you.",
  },
  {
    value: "trusted_catalog_reference",
    label: "Trusted catalog reference",
    hint: "Label, distributor, publisher, or trusted catalog record that links you to this release.",
    titlePlaceholder: "Trusted catalog listing",
    sourceUrlPlaceholder: "https://...",
    sourceLabelPlaceholder: "Label catalog, publisher catalog",
    contextPlaceholder: "Explain why this catalog source is trusted and how it links the release to you.",
  },
];

export const RIGHTS_EVIDENCE_STRENGTH_OPTIONS: Array<{
  value: RightsEvidenceStrength;
  label: string;
}> = [
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

export function getCreatorRightsEvidenceOption(kind: RightsEvidenceKind) {
  return (
    CREATOR_RIGHTS_EVIDENCE_OPTIONS.find((option) => option.value === kind) ??
    CREATOR_RIGHTS_EVIDENCE_OPTIONS[0]
  );
}

export function formatRightsEvidenceKindLabel(kind: RightsEvidenceKind | string) {
  return (
    CREATOR_RIGHTS_EVIDENCE_OPTIONS.find((option) => option.value === kind)?.label ??
    kind.replaceAll("_", " ")
  );
}

export function formatRightsEvidenceVerificationStatusLabel(
  status?: RightsEvidenceVerificationStatus | string | null,
) {
  switch (status) {
    case "verified":
      return "Reviewer verified evidence";
    case "rejected":
      return "Rejected evidence";
    case "system_generated":
      return "System signal";
    case "unverified":
    default:
      return "Submitted evidence";
  }
}

export function getRightsEvidenceVerificationTone(
  status?: RightsEvidenceVerificationStatus | string | null,
) {
  switch (status) {
    case "verified":
      return {
        borderColor: "rgba(16,185,129,0.28)",
        background: "rgba(16,185,129,0.08)",
        color: "#34d399",
      };
    case "rejected":
      return {
        borderColor: "rgba(239,68,68,0.28)",
        background: "rgba(239,68,68,0.08)",
        color: "#ef4444",
      };
    case "system_generated":
      return {
        borderColor: "rgba(59,130,246,0.28)",
        background: "rgba(59,130,246,0.08)",
        color: "#60a5fa",
      };
    case "unverified":
    default:
      return {
        borderColor: "rgba(245,158,11,0.28)",
        background: "rgba(245,158,11,0.08)",
        color: "#f59e0b",
      };
  }
}

export function normalizeRightsEvidenceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withProtocol =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("ipfs://")
      ? trimmed
      : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (!["http:", "https:", "ipfs:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return withProtocol;
  } catch {
    throw new Error("Please enter a valid URL, including https:// if needed.");
  }
}

export function normalizeRightsEvidenceUrlList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeRightsEvidenceUrl(line));
}
