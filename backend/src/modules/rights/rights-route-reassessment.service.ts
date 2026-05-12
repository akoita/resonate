import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, RightsEvidenceBundle } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  UPLOAD_RIGHTS_POLICY_VERSION,
  UPLOAD_RIGHTS_ROUTES,
  dedupeFlags,
  getUploadRightsActions,
  normalizeSourceType,
  type UploadRightsFlag,
  type UploadRightsRoute,
} from "./upload-rights-policy";

const REASSESSMENT_TRIGGERS = [
  "evidence_submitted",
  "trusted_source_linked",
  "trusted_source_revoked",
  "dispute_opened",
  "appeal_opened",
  "dmca_takedown",
  "fingerprint_conflict",
  "audit_sample",
  "manual_review",
] as const;

const REASSESSMENT_REVIEW_ACTIONS = [
  "apply_route",
  "confirm_current",
  "dismiss",
] as const;

export type RightsRouteReassessmentTrigger =
  (typeof REASSESSMENT_TRIGGERS)[number];
export type RightsRouteReassessmentReviewAction =
  (typeof REASSESSMENT_REVIEW_ACTIONS)[number];

function trimOrNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertOneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  field: string,
): T {
  const normalized = value?.trim().toLowerCase();
  if (normalized && (allowed as readonly string[]).includes(normalized)) {
    return normalized as T;
  }
  throw new BadRequestException(`Invalid ${field}`);
}

function assertRoute(value: string | null | undefined, field = "route"): UploadRightsRoute {
  const normalized = value?.trim().toUpperCase();
  if (normalized && (UPLOAD_RIGHTS_ROUTES as readonly string[]).includes(normalized)) {
    return normalized as UploadRightsRoute;
  }
  throw new BadRequestException(`Invalid ${field}`);
}

function parseFlags(value: Prisma.JsonValue | null | undefined): UploadRightsFlag[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is UploadRightsFlag => typeof entry === "string") as UploadRightsFlag[];
}

function flagsForRoute(route: UploadRightsRoute, existingFlags: readonly string[] = []) {
  const actions = getUploadRightsActions(route);
  const routeFlags: UploadRightsFlag[] = [];

  if (!actions.marketplaceAllowed) {
    routeFlags.push("RESTRICT_MARKETPLACE");
  }
  if (actions.payoutRelease === "none" || actions.payoutRelease === "held") {
    routeFlags.push("RESTRICT_PAYOUTS");
  }
  if (route === "LIMITED_MONITORING") {
    routeFlags.push("NEEDS_PROOF_OF_CONTROL");
  }
  if (route === "QUARANTINED_REVIEW" || route === "BLOCKED") {
    routeFlags.push("NEEDS_HUMAN_REVIEW");
  }
  if (route === "QUARANTINED_REVIEW") {
    routeFlags.push("DISPUTE_ELIGIBLE");
  }

  if (actions.marketplaceAllowed && actions.payoutRelease !== "held") {
    const removable = new Set<UploadRightsFlag>([
      "NEEDS_PROOF_OF_CONTROL",
      "NEEDS_HUMAN_REVIEW",
      "RESTRICT_MARKETPLACE",
      "RESTRICT_PAYOUTS",
    ]);
    return dedupeFlags(existingFlags.filter((flag) => !removable.has(flag as UploadRightsFlag)));
  }

  return dedupeFlags(existingFlags, routeFlags);
}

@Injectable()
export class RightsRouteReassessmentService {
  async createReassessment(input: {
    releaseId: string;
    trigger: string;
    reason?: string | null;
    actorAddress?: string | null;
    recommendedRoute?: string | null;
    evidenceSubjectType?: string | null;
    evidenceSubjectId?: string | null;
    trustedSourceLinkId?: string | null;
    rightsUpgradeRequestId?: string | null;
    flags?: string[] | null;
  }) {
    const trigger = assertOneOf(input.trigger, REASSESSMENT_TRIGGERS, "trigger");
    const release = await this.getReleaseForUpdate(input.releaseId);
    const recommendedRoute = input.recommendedRoute
      ? assertRoute(input.recommendedRoute, "recommendedRoute")
      : null;

    const reason = trimOrNull(input.reason) || this.defaultReasonForTrigger(trigger);

    return prisma.rightsRouteReassessment.create({
      data: {
        releaseId: release.id,
        trigger,
        status: "pending_review",
        previousRoute: release.rightsRoute,
        recommendedRoute,
        reason,
        actorAddress: trimOrNull(input.actorAddress)?.toLowerCase(),
        evidenceSubjectType: trimOrNull(input.evidenceSubjectType),
        evidenceSubjectId: trimOrNull(input.evidenceSubjectId),
        trustedSourceLinkId: trimOrNull(input.trustedSourceLinkId),
        rightsUpgradeRequestId: trimOrNull(input.rightsUpgradeRequestId),
        policyVersion: release.rightsPolicyVersion || UPLOAD_RIGHTS_POLICY_VERSION,
        flags: (input.flags || parseFlags(release.rightsFlags)) as Prisma.InputJsonValue,
      },
      include: this.reassessmentInclude(),
    });
  }

  async createReassessmentFromEvidenceBundle(bundle: RightsEvidenceBundle) {
    if (bundle.subjectType === "release") {
      return this.createReassessment({
        releaseId: bundle.subjectId,
        trigger: "evidence_submitted",
        reason:
          "New rights evidence was submitted for this release and should be reviewed against the current route.",
        actorAddress: bundle.submittedByAddress,
        evidenceSubjectType: bundle.subjectType,
        evidenceSubjectId: bundle.subjectId,
      }).catch((error) => {
        if (error instanceof NotFoundException) {
          return null;
        }
        throw error;
      });
    }

    if (bundle.subjectType === "track") {
      const track = await prisma.track.findUnique({
        where: { id: bundle.subjectId },
        select: { releaseId: true },
      });
      if (!track) {
        return null;
      }
      return this.createReassessment({
        releaseId: track.releaseId,
        trigger: "evidence_submitted",
        reason:
          "New rights evidence was submitted for a track in this release and should be reviewed against the current route.",
        actorAddress: bundle.submittedByAddress,
        evidenceSubjectType: bundle.subjectType,
        evidenceSubjectId: bundle.subjectId,
      });
    }

    return null;
  }

  async listPendingReassessments(limit: number) {
    return prisma.rightsRouteReassessment.findMany({
      where: { status: "pending_review" },
      include: this.reassessmentInclude(),
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(limit || 20, 1), 100),
    });
  }

  async listReleaseHistory(releaseId: string, requesterAddress?: string | null, role = "listener") {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { artist: { select: { userId: true } } },
    });
    if (!release) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }

    if (role !== "admin") {
      const normalized = requesterAddress?.toLowerCase();
      if (!normalized || release.artist.userId.toLowerCase() !== normalized) {
        throw new ForbiddenException("You can only view route history for your own releases");
      }
    }

    return prisma.rightsRouteReassessment.findMany({
      where: { releaseId },
      include: this.reassessmentInclude(),
      orderBy: { createdAt: "desc" },
    });
  }

  async reviewReassessment(input: {
    reassessmentId: string;
    action: string;
    reviewedBy: string;
    nextRoute?: string | null;
    reason?: string | null;
  }) {
    const action = assertOneOf(input.action, REASSESSMENT_REVIEW_ACTIONS, "action");
    const reassessment = await prisma.rightsRouteReassessment.findUnique({
      where: { id: input.reassessmentId },
      include: { release: true },
    });
    if (!reassessment) {
      throw new NotFoundException("Rights route reassessment not found");
    }
    if (reassessment.status !== "pending_review") {
      throw new BadRequestException("This reassessment has already been reviewed");
    }

    const reviewedBy = input.reviewedBy.toLowerCase();
    const reason = trimOrNull(input.reason) || reassessment.reason;

    if (action === "dismiss") {
      return prisma.rightsRouteReassessment.update({
        where: { id: reassessment.id },
        data: {
          status: "dismissed",
          reviewedBy,
          reviewedAt: new Date(),
          reason,
        },
        include: this.reassessmentInclude(),
      });
    }

    if (action === "confirm_current") {
      return prisma.rightsRouteReassessment.update({
        where: { id: reassessment.id },
        data: {
          status: "confirmed_current",
          nextRoute: reassessment.release.rightsRoute,
          reviewedBy,
          reviewedAt: new Date(),
          reason,
        },
        include: this.reassessmentInclude(),
      });
    }

    const nextRoute = input.nextRoute
      ? assertRoute(input.nextRoute, "nextRoute")
      : reassessment.recommendedRoute
        ? assertRoute(reassessment.recommendedRoute, "recommendedRoute")
        : null;
    if (!nextRoute) {
      throw new BadRequestException("nextRoute is required when applying a reassessment");
    }

    return this.applyRouteChange({
      reassessmentId: reassessment.id,
      releaseId: reassessment.releaseId,
      nextRoute,
      actorAddress: reviewedBy,
      reason,
      trigger: reassessment.trigger as RightsRouteReassessmentTrigger,
      existingFlags: parseFlags(reassessment.release.rightsFlags),
    });
  }

  async sampleLowFrictionAudits(input?: {
    limit?: number;
    actorAddress?: string | null;
    reason?: string | null;
  }) {
    const limit = Math.min(Math.max(input?.limit || 20, 1), 100);
    const releases = await prisma.release.findMany({
      where: {
        rightsRoute: { in: ["STANDARD_ESCROW", "TRUSTED_FAST_PATH"] },
        rightsReassessments: {
          none: {
            trigger: "audit_sample",
            status: "pending_review",
          },
        },
      },
      orderBy: [
        { rightsEvaluatedAt: "asc" },
        { createdAt: "asc" },
      ],
      take: limit,
      select: {
        id: true,
        rightsRoute: true,
        rightsFlags: true,
        rightsPolicyVersion: true,
      },
    });

    const created = [];
    for (const release of releases) {
      created.push(
        await prisma.rightsRouteReassessment.create({
          data: {
            releaseId: release.id,
            trigger: "audit_sample",
            status: "pending_review",
            previousRoute: release.rightsRoute,
            recommendedRoute: release.rightsRoute,
            reason:
              trimOrNull(input?.reason) ||
              "This low-friction release was selected for policy audit sampling.",
            actorAddress: trimOrNull(input?.actorAddress)?.toLowerCase(),
            policyVersion: release.rightsPolicyVersion || UPLOAD_RIGHTS_POLICY_VERSION,
            flags: parseFlags(release.rightsFlags) as Prisma.InputJsonValue,
          },
          include: this.reassessmentInclude(),
        }),
      );
    }

    return created;
  }

  async createTrustedSourceRevocationReassessments(input: {
    linkId: string;
    artistId: string;
    sourceType: string;
    revokedBy: string;
    reason?: string | null;
  }) {
    const sourceType = normalizeSourceType(`trusted_${input.sourceType}`);
    const releases = await prisma.release.findMany({
      where: {
        artistId: input.artistId,
        rightsRoute: "TRUSTED_FAST_PATH",
        rightsSourceType: sourceType,
      },
      select: {
        id: true,
        rightsFlags: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const reason =
      trimOrNull(input.reason) ||
      "Trusted-source link was revoked; release moved out of trusted fast path pending normal controls.";

    const applied = [];
    for (const release of releases) {
      const reassessment = await this.createReassessment({
        releaseId: release.id,
        trigger: "trusted_source_revoked",
        recommendedRoute: "STANDARD_ESCROW",
        reason,
        actorAddress: input.revokedBy,
        trustedSourceLinkId: input.linkId,
        flags: parseFlags(release.rightsFlags),
      });
      applied.push(
        await this.applyRouteChange({
          reassessmentId: reassessment.id,
          releaseId: release.id,
          nextRoute: "STANDARD_ESCROW",
          actorAddress: input.revokedBy,
          reason,
          trigger: "trusted_source_revoked",
          existingFlags: parseFlags(release.rightsFlags),
        }),
      );
    }

    return applied;
  }

  private async applyRouteChange(input: {
    reassessmentId: string;
    releaseId: string;
    nextRoute: UploadRightsRoute;
    actorAddress: string;
    reason: string;
    trigger: RightsRouteReassessmentTrigger | string;
    existingFlags: readonly string[];
  }) {
    const now = new Date();
    const nextFlags = flagsForRoute(input.nextRoute, input.existingFlags);

    return prisma.$transaction(async (tx) => {
      await tx.release.update({
        where: { id: input.releaseId },
        data: {
          rightsRoute: input.nextRoute,
          rightsFlags: nextFlags as Prisma.InputJsonValue,
          rightsReason: input.reason,
          rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
          rightsEvaluatedAt: now,
        },
      });

      await tx.track.updateMany({
        where: { releaseId: input.releaseId },
        data: {
          rightsRoute: input.nextRoute,
          rightsFlags: nextFlags as Prisma.InputJsonValue,
          rightsReason: input.reason,
          rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
          rightsEvaluatedAt: now,
        },
      });

      return tx.rightsRouteReassessment.update({
        where: { id: input.reassessmentId },
        data: {
          status: "applied",
          nextRoute: input.nextRoute,
          reviewedBy: input.actorAddress,
          reviewedAt: now,
          reason: input.reason,
          policyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
          flags: nextFlags as Prisma.InputJsonValue,
        },
        include: this.reassessmentInclude(),
      });
    });
  }

  private async getReleaseForUpdate(releaseId: string) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        rightsRoute: true,
        rightsFlags: true,
        rightsPolicyVersion: true,
      },
    });
    if (!release) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }
    return release;
  }

  private defaultReasonForTrigger(trigger: RightsRouteReassessmentTrigger) {
    switch (trigger) {
      case "audit_sample":
        return "Release selected for rights-route audit sampling.";
      case "trusted_source_revoked":
        return "Trusted-source status changed and release route should be reassessed.";
      case "evidence_submitted":
        return "New rights evidence was submitted and release route should be reassessed.";
      case "dmca_takedown":
        return "DMCA signal requires rights-route reassessment.";
      case "fingerprint_conflict":
        return "Fingerprint conflict requires rights-route reassessment.";
      case "dispute_opened":
      case "appeal_opened":
        return "Dispute activity requires rights-route reassessment.";
      default:
        return "Manual rights-route reassessment requested.";
    }
  }

  private reassessmentInclude() {
    return {
      release: {
        select: {
          id: true,
          title: true,
          artistId: true,
          rightsRoute: true,
          rightsFlags: true,
          rightsReason: true,
          rightsSourceType: true,
          artist: {
            select: {
              id: true,
              userId: true,
              displayName: true,
            },
          },
        },
      },
    } satisfies Prisma.RightsRouteReassessmentInclude;
  }
}
