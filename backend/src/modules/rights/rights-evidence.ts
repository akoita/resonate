import { BadRequestException } from "@nestjs/common";
import type {
  RightsEvidenceBundlePurpose,
  RightsEvidenceKind,
  RightsEvidenceRole,
  RightsEvidenceStrength,
  RightsEvidenceSubjectType,
  RightsEvidenceVerificationStatus,
} from "@prisma/client";

export const RIGHTS_EVIDENCE_SUBJECT_TYPES = [
  "upload",
  "release",
  "track",
  "dispute",
] as const satisfies readonly RightsEvidenceSubjectType[];

export const RIGHTS_EVIDENCE_ROLES = [
  "reporter",
  "creator",
  "ops",
  "trusted_source",
  "system",
] as const satisfies readonly RightsEvidenceRole[];

export const RIGHTS_EVIDENCE_KINDS = [
  "trusted_catalog_reference",
  "fingerprint_match",
  "prior_publication",
  "rights_metadata",
  "proof_of_control",
  "legal_notice",
  "narrative_statement",
  "internal_review_note",
] as const satisfies readonly RightsEvidenceKind[];

export const RIGHTS_EVIDENCE_STRENGTHS = [
  "low",
  "medium",
  "high",
  "very_high",
] as const satisfies readonly RightsEvidenceStrength[];

export const RIGHTS_EVIDENCE_VERIFICATION_STATUSES = [
  "unverified",
  "verified",
  "rejected",
  "system_generated",
] as const satisfies readonly RightsEvidenceVerificationStatus[];

export const RIGHTS_EVIDENCE_BUNDLE_PURPOSES = [
  "upload_review",
  "dispute_report",
  "creator_response",
  "ops_review",
  "jury_packet",
  "rights_upgrade_request",
] as const satisfies readonly RightsEvidenceBundlePurpose[];

const DISPUTE_REPORT_PRIMARY_KINDS = new Set<RightsEvidenceKind>([
  "prior_publication",
  "trusted_catalog_reference",
  "rights_metadata",
  "proof_of_control",
]);

const DEFAULT_STRENGTH_BY_KIND: Record<RightsEvidenceKind, RightsEvidenceStrength> = {
  trusted_catalog_reference: "very_high",
  fingerprint_match: "high",
  prior_publication: "high",
  rights_metadata: "medium",
  proof_of_control: "medium",
  legal_notice: "medium",
  narrative_statement: "low",
  internal_review_note: "medium",
};

export type RightsEvidenceDraftInput = {
  kind: string;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  claimedRightsholder?: string | null;
  artistName?: string | null;
  releaseTitle?: string | null;
  publicationDate?: string | null;
  isrc?: string | null;
  upc?: string | null;
  fingerprintConfidence?: number | null;
  strength?: string | null;
  verificationStatus?: string | null;
  attachments?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type RightsEvidenceBundleInput = {
  subjectType: string;
  subjectId: string;
  submittedByRole: string;
  submittedByAddress?: string | null;
  purpose: string;
  summary?: string | null;
  evidences: RightsEvidenceDraftInput[];
};

export type DisputeReportEvidenceInput = {
  tokenId: string;
  reporterAddr: string;
  counterStake?: string;
  narrativeSummary: string;
  primaryEvidence: RightsEvidenceDraftInput;
};

export type NormalizedRightsEvidenceItem = {
  subjectType: RightsEvidenceSubjectType;
  subjectId: string;
  submittedByRole: RightsEvidenceRole;
  submittedByAddress: string | null;
  kind: RightsEvidenceKind;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  claimedRightsholder: string | null;
  artistName: string | null;
  releaseTitle: string | null;
  publicationDate: Date | null;
  isrc: string | null;
  upc: string | null;
  fingerprintConfidence: number | null;
  strength: RightsEvidenceStrength;
  verificationStatus: RightsEvidenceVerificationStatus;
  attachments: string[] | null;
  metadata: Record<string, unknown> | null;
};

export type NormalizedRightsEvidenceBundle = {
  subjectType: RightsEvidenceSubjectType;
  subjectId: string;
  submittedByRole: RightsEvidenceRole;
  submittedByAddress: string | null;
  purpose: RightsEvidenceBundlePurpose;
  summary: string | null;
  evidences: NormalizedRightsEvidenceItem[];
};

function assertEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new BadRequestException(`Invalid ${field}`);
}

function trimOrNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeUrlOrNull(value?: string | null) {
  const trimmed = trimOrNull(value);
  if (!trimmed) {
    return null;
  }

  try {
    const candidate =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("ipfs://")
        ? trimmed
        : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (!["http:", "https:", "ipfs:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return candidate;
  } catch {
    throw new BadRequestException("Invalid evidence sourceUrl");
  }
}

function normalizePublicationDate(value?: string | null) {
  const trimmed = trimOrNull(value);
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("Invalid evidence publicationDate");
  }
  return date;
}

function normalizeEvidenceItem(
  input: RightsEvidenceDraftInput,
  subjectType: RightsEvidenceSubjectType,
  subjectId: string,
  submittedByRole: RightsEvidenceRole,
  submittedByAddress: string | null,
): NormalizedRightsEvidenceItem {
  const kind = assertEnumValue(
    trimOrNull(input.kind) || "",
    RIGHTS_EVIDENCE_KINDS,
    "evidence kind",
  );
  const title = trimOrNull(input.title);

  if (!title) {
    throw new BadRequestException("Evidence title is required");
  }

  const description = trimOrNull(input.description);
  const sourceUrl = normalizeUrlOrNull(input.sourceUrl);
  const verificationStatus = assertEnumValue(
    trimOrNull(input.verificationStatus) || "unverified",
    RIGHTS_EVIDENCE_VERIFICATION_STATUSES,
    "evidence verificationStatus",
  );
  const strength = assertEnumValue(
    trimOrNull(input.strength) || DEFAULT_STRENGTH_BY_KIND[kind],
    RIGHTS_EVIDENCE_STRENGTHS,
    "evidence strength",
  );
  const fingerprintConfidence =
    input.fingerprintConfidence == null ? null : Number(input.fingerprintConfidence);

  if (
    fingerprintConfidence != null &&
    (!Number.isFinite(fingerprintConfidence) || fingerprintConfidence < 0 || fingerprintConfidence > 1)
  ) {
    throw new BadRequestException("fingerprintConfidence must be between 0 and 1");
  }

  if (
    !sourceUrl &&
    !description &&
    kind !== "narrative_statement" &&
    kind !== "internal_review_note"
  ) {
    throw new BadRequestException(
      "Evidence must include a sourceUrl or description for this kind",
    );
  }

  if (kind === "fingerprint_match" && fingerprintConfidence == null) {
    throw new BadRequestException("fingerprint_match evidence requires fingerprintConfidence");
  }

  return {
    subjectType,
    subjectId,
    submittedByRole,
    submittedByAddress,
    kind,
    title,
    description,
    sourceUrl,
    sourceLabel: trimOrNull(input.sourceLabel),
    claimedRightsholder: trimOrNull(input.claimedRightsholder),
    artistName: trimOrNull(input.artistName),
    releaseTitle: trimOrNull(input.releaseTitle),
    publicationDate: normalizePublicationDate(input.publicationDate),
    isrc: trimOrNull(input.isrc),
    upc: trimOrNull(input.upc),
    fingerprintConfidence,
    strength,
    verificationStatus,
    attachments:
      input.attachments?.map((item) => item.trim()).filter(Boolean) || null,
    metadata: input.metadata || null,
  };
}

export function normalizeEvidenceBundleInput(
  input: RightsEvidenceBundleInput,
): NormalizedRightsEvidenceBundle {
  const subjectType = assertEnumValue(
    trimOrNull(input.subjectType) || "",
    RIGHTS_EVIDENCE_SUBJECT_TYPES,
    "subjectType",
  );
  const subjectId = trimOrNull(input.subjectId);
  const submittedByRole = assertEnumValue(
    trimOrNull(input.submittedByRole) || "",
    RIGHTS_EVIDENCE_ROLES,
    "submittedByRole",
  );
  const purpose = assertEnumValue(
    trimOrNull(input.purpose) || "",
    RIGHTS_EVIDENCE_BUNDLE_PURPOSES,
    "purpose",
  );

  if (!subjectId) {
    throw new BadRequestException("subjectId is required");
  }
  if (!Array.isArray(input.evidences) || input.evidences.length === 0) {
    throw new BadRequestException("At least one evidence item is required");
  }

  const submittedByAddress = trimOrNull(input.submittedByAddress)?.toLowerCase() || null;
  const summary = trimOrNull(input.summary);
  if (purpose === "dispute_report" && !summary) {
    throw new BadRequestException("A narrative summary is required");
  }

  const evidences = input.evidences.map((item) =>
    normalizeEvidenceItem(item, subjectType, subjectId, submittedByRole, submittedByAddress),
  );

  if (purpose === "dispute_report") {
    const primaryEvidence = evidences[0];
    if (!DISPUTE_REPORT_PRIMARY_KINDS.has(primaryEvidence.kind)) {
      throw new BadRequestException("Primary dispute evidence kind is not allowed");
    }
    if (!primaryEvidence.claimedRightsholder) {
      throw new BadRequestException("claimedRightsholder is required");
    }
    if (!evidences.some((evidence) => evidence.kind === "narrative_statement")) {
      evidences.push({
        subjectType,
        subjectId,
        submittedByRole,
        submittedByAddress,
        kind: "narrative_statement",
        title: "Report summary",
        description: summary,
        sourceUrl: null,
        sourceLabel: null,
        claimedRightsholder: primaryEvidence.claimedRightsholder,
        artistName: primaryEvidence.artistName,
        releaseTitle: primaryEvidence.releaseTitle,
        publicationDate: null,
        isrc: primaryEvidence.isrc,
        upc: primaryEvidence.upc,
        fingerprintConfidence: null,
        strength: "low",
        verificationStatus: "unverified",
        attachments: null,
        metadata: null,
      });
    }
  }

  return {
    subjectType,
    subjectId,
    submittedByRole,
    submittedByAddress,
    purpose,
    summary,
    evidences,
  };
}

export function normalizeDisputeReportBundle(
  input: DisputeReportEvidenceInput,
  subjectId: string,
): NormalizedRightsEvidenceBundle {
  const summary = trimOrNull(input.narrativeSummary);
  if (!summary) {
    throw new BadRequestException("A narrative summary is required");
  }

  const primaryEvidence = normalizeEvidenceItem(
    input.primaryEvidence,
    "dispute",
    subjectId,
    "reporter",
    trimOrNull(input.reporterAddr)?.toLowerCase() || null,
  );

  if (!DISPUTE_REPORT_PRIMARY_KINDS.has(primaryEvidence.kind)) {
    throw new BadRequestException("Primary dispute evidence kind is not allowed");
  }
  if (!primaryEvidence.claimedRightsholder) {
    throw new BadRequestException("claimedRightsholder is required");
  }

  return {
    subjectType: "dispute",
    subjectId,
    submittedByRole: "reporter",
    submittedByAddress: trimOrNull(input.reporterAddr)?.toLowerCase() || null,
    purpose: "dispute_report",
    summary,
    evidences: [
      primaryEvidence,
      {
        subjectType: "dispute",
        subjectId,
        submittedByRole: "reporter",
        submittedByAddress: trimOrNull(input.reporterAddr)?.toLowerCase() || null,
        kind: "narrative_statement",
        title: "Report summary",
        description: summary,
        sourceUrl: null,
        sourceLabel: null,
        claimedRightsholder: primaryEvidence.claimedRightsholder,
        artistName: primaryEvidence.artistName,
        releaseTitle: primaryEvidence.releaseTitle,
        publicationDate: null,
        isrc: primaryEvidence.isrc,
        upc: primaryEvidence.upc,
        fingerprintConfidence: null,
        strength: "low",
        verificationStatus: "unverified",
        attachments: null,
        metadata: null,
      },
    ],
  };
}
