import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  Prisma,
  TrustedSourceLinkRequestStatus,
  TrustedSourceReviewState,
  TrustedSourceTrustLevel,
  TrustedSourceType,
} from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  normalizeEvidenceBundleInput,
  type NormalizedRightsEvidenceBundle,
  type RightsEvidenceDraftInput,
} from "./rights-evidence";

const TRUSTED_SOURCE_TYPES = [
  "distributor",
  "label",
  "official_artist_team",
  "catalog_operator",
] as const satisfies readonly TrustedSourceType[];

const TRUSTED_SOURCE_TRUST_LEVELS = [
  "standard",
  "high",
  "very_high",
] as const satisfies readonly TrustedSourceTrustLevel[];

type TrustedSourceLinkRequestAction = "under_review" | "approve" | "deny";

function assertEnum<T extends string>(
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

function trimOrNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSourceKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new BadRequestException("sourceKey must include letters or numbers");
  }
  return normalized;
}

function effectiveSourceType(type: TrustedSourceType) {
  return `trusted_${type}`;
}

@Injectable()
export class TrustedSourceService {
  async getActiveTrustedSourceContext(artistId: string) {
    const link = await prisma.trustedSourceArtistLink.findFirst({
      where: {
        artistId,
        status: "active",
        trustedSource: {
          reviewState: "active",
          revokedAt: null,
        },
      },
      include: {
        trustedSource: true,
      },
      orderBy: [
        { trustLevel: "desc" },
        { approvedAt: "desc" },
      ],
    });

    if (!link) {
      return null;
    }

    return {
      linkId: link.id,
      trustedSourceId: link.trustedSourceId,
      sourceType: effectiveSourceType(link.sourceType),
      sourceName: link.trustedSource.name,
      trustLevel: link.trustLevel,
      reason: `Upload came from approved ${link.sourceType.replaceAll("_", " ")} source ${link.trustedSource.name}.`,
    };
  }

  async submitLinkRequest(input: {
    requesterAddress: string;
    requestedSourceType?: string | null;
    sourceName?: string | null;
    sourceKey?: string | null;
    requestedTrustLevel?: string | null;
    proofSummary?: string | null;
    domain?: string | null;
    feedUrl?: string | null;
    traceability?: Record<string, unknown> | null;
    evidences?: RightsEvidenceDraftInput[] | null;
  }) {
    const requesterAddress = input.requesterAddress.trim().toLowerCase();
    if (!requesterAddress) {
      throw new BadRequestException("requesterAddress is required");
    }

    const artist = await prisma.artist.findUnique({
      where: { userId: requesterAddress },
      select: { id: true, displayName: true },
    });
    if (!artist) {
      throw new ForbiddenException("Only artist accounts can request trusted-source linking");
    }

    const requestedSourceType = assertEnum(
      input.requestedSourceType,
      TRUSTED_SOURCE_TYPES,
      "requestedSourceType",
    );
    const sourceName = trimOrNull(input.sourceName);
    if (!sourceName) {
      throw new BadRequestException("sourceName is required");
    }
    const proofSummary = trimOrNull(input.proofSummary);
    if (!proofSummary || proofSummary.length < 20) {
      throw new BadRequestException("A proofSummary of at least 20 characters is required");
    }

    const requestedTrustLevel = input.requestedTrustLevel
      ? assertEnum(input.requestedTrustLevel, TRUSTED_SOURCE_TRUST_LEVELS, "requestedTrustLevel")
      : "standard";
    const sourceKey = normalizeSourceKey(input.sourceKey || sourceName);

    const existingOpen = await prisma.trustedSourceLinkRequest.findFirst({
      where: {
        artistId: artist.id,
        requestedSourceType,
        sourceKey,
        status: { in: ["submitted", "under_review"] },
      },
      select: { id: true },
    });
    if (existingOpen) {
      throw new ConflictException("A trusted-source link request for this source is already open");
    }

    const existingSource = await prisma.trustedSource.findUnique({
      where: {
        type_sourceKey: {
          type: requestedSourceType,
          sourceKey,
        },
      },
      select: { id: true },
    });

    const request = await prisma.$transaction(async (tx) => {
      const trustedSourceId =
        existingSource?.id ||
        (input.domain || input.feedUrl || input.traceability
          ? (
              await tx.trustedSource.create({
                data: {
                  type: requestedSourceType,
                  name: sourceName,
                  sourceKey,
                  trustLevel: requestedTrustLevel,
                  reviewState: "pending_review",
                  domain: trimOrNull(input.domain),
                  feedUrl: trimOrNull(input.feedUrl),
                  traceability:
                    (input.traceability as Prisma.InputJsonValue | undefined) ?? undefined,
                  createdByAddress: requesterAddress,
                },
              })
            ).id
          : undefined);

      const requestRecord = await tx.trustedSourceLinkRequest.create({
        data: {
          artistId: artist.id,
          trustedSourceId,
          requesterAddress,
          requestedSourceType,
          sourceName,
          sourceKey,
          requestedTrustLevel,
          proofSummary,
        },
      });

      if (input.evidences?.length) {
        await this.persistEvidenceBundle(
          normalizeEvidenceBundleInput({
            subjectType: "trusted_source_link_request",
            subjectId: requestRecord.id,
            submittedByRole: "creator",
            submittedByAddress: requesterAddress,
            purpose: "trusted_source_link_request",
            summary: proofSummary,
            evidences: input.evidences,
          }),
          tx,
        );
      }

      return requestRecord;
    });

    return this.getLinkRequestById(request.id, requesterAddress, "creator");
  }

  async listMyLinkRequests(requesterAddress: string) {
    const artist = await prisma.artist.findUnique({
      where: { userId: requesterAddress.toLowerCase() },
      select: { id: true },
    });
    if (!artist) {
      return [];
    }

    const requests = await prisma.trustedSourceLinkRequest.findMany({
      where: { artistId: artist.id },
      include: this.linkRequestInclude(),
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(requests.map((request) => this.decorateLinkRequest(request)));
  }

  async listMyTrustedSourceLinks(requesterAddress: string) {
    const artist = await prisma.artist.findUnique({
      where: { userId: requesterAddress.toLowerCase() },
      select: { id: true },
    });
    if (!artist) {
      return [];
    }

    return prisma.trustedSourceArtistLink.findMany({
      where: { artistId: artist.id },
      include: { trustedSource: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async listPendingLinkRequests(limit: number) {
    const requests = await prisma.trustedSourceLinkRequest.findMany({
      where: { status: { in: ["submitted", "under_review"] } },
      include: this.linkRequestInclude(),
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    return Promise.all(requests.map((request) => this.decorateLinkRequest(request)));
  }

  async getLinkRequestById(
    id: string,
    requesterAddress?: string | null,
    role = "listener",
  ) {
    const request = await prisma.trustedSourceLinkRequest.findUnique({
      where: { id },
      include: this.linkRequestInclude(),
    });
    if (!request) {
      throw new NotFoundException("Trusted-source link request not found");
    }

    if (role !== "admin" && requesterAddress) {
      const normalized = requesterAddress.toLowerCase();
      const ownerUserId = request.artist.userId?.toLowerCase();
      if (!ownerUserId || ownerUserId !== normalized) {
        throw new ForbiddenException("You can only view your own trusted-source link requests");
      }
    }

    return this.decorateLinkRequest(request);
  }

  async reviewLinkRequest(input: {
    id: string;
    action: TrustedSourceLinkRequestAction;
    reviewedBy: string;
    decisionReason?: string | null;
    trustLevel?: string | null;
    reviewState?: string | null;
  }) {
    const request = await prisma.trustedSourceLinkRequest.findUnique({
      where: { id: input.id },
      include: { artist: true, trustedSource: true },
    });
    if (!request) {
      throw new NotFoundException("Trusted-source link request not found");
    }
    if (request.status === "approved" || request.status === "denied") {
      throw new BadRequestException("This trusted-source link request has already been finalized");
    }

    const reviewedBy = input.reviewedBy.toLowerCase();
    const decisionReason = trimOrNull(input.decisionReason);

    if (input.action === "under_review") {
      await prisma.trustedSourceLinkRequest.update({
        where: { id: request.id },
        data: {
          status: "under_review",
          decisionReason,
          reviewedBy,
          reviewedAt: new Date(),
        },
      });
      return this.getLinkRequestById(request.id, null, "admin");
    }

    if (input.action === "deny") {
      await prisma.trustedSourceLinkRequest.update({
        where: { id: request.id },
        data: {
          status: "denied",
          decisionReason:
            decisionReason || "Trusted-source linking was denied after review.",
          reviewedBy,
          reviewedAt: new Date(),
        },
      });
      return this.getLinkRequestById(request.id, null, "admin");
    }

    const trustLevel = input.trustLevel
      ? assertEnum(input.trustLevel, TRUSTED_SOURCE_TRUST_LEVELS, "trustLevel")
      : request.requestedTrustLevel;
    const reviewState = input.reviewState
      ? assertEnum(
          input.reviewState,
          ["active", "suspended", "revoked"] as const satisfies readonly TrustedSourceReviewState[],
          "reviewState",
        )
      : "active";

    await prisma.$transaction(async (tx) => {
      const source = request.trustedSourceId
        ? await tx.trustedSource.update({
            where: { id: request.trustedSourceId },
            data: {
              name: request.sourceName,
              sourceKey: request.sourceKey,
              trustLevel,
              reviewState,
              reviewedBy,
              reviewedAt: new Date(),
            },
          })
        : await tx.trustedSource.upsert({
            where: {
              type_sourceKey: {
                type: request.requestedSourceType,
                sourceKey: request.sourceKey,
              },
            },
            create: {
              type: request.requestedSourceType,
              name: request.sourceName,
              sourceKey: request.sourceKey,
              trustLevel,
              reviewState,
              createdByAddress: request.requesterAddress,
              reviewedBy,
              reviewedAt: new Date(),
            },
            update: {
              name: request.sourceName,
              trustLevel,
              reviewState,
              reviewedBy,
              reviewedAt: new Date(),
              revokedAt: reviewState === "revoked" ? new Date() : null,
            },
          });

      await tx.trustedSourceArtistLink.upsert({
        where: {
          artistId_trustedSourceId: {
            artistId: request.artistId,
            trustedSourceId: source.id,
          },
        },
        create: {
          artistId: request.artistId,
          trustedSourceId: source.id,
          status: reviewState === "active" ? "active" : "suspended",
          trustLevel,
          sourceType: request.requestedSourceType,
          approvedBy: reviewedBy,
          approvedAt: new Date(),
          metadata: {
            requestId: request.id,
          },
        },
        update: {
          status: reviewState === "active" ? "active" : "suspended",
          trustLevel,
          sourceType: request.requestedSourceType,
          approvedBy: reviewedBy,
          approvedAt: new Date(),
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
        },
      });

      await tx.trustedSourceLinkRequest.update({
        where: { id: request.id },
        data: {
          trustedSourceId: source.id,
          status: "approved",
          decisionReason:
            decisionReason || "Trusted-source link approved after evidence review.",
          reviewedBy,
          reviewedAt: new Date(),
        },
      });
    });

    return this.getLinkRequestById(request.id, null, "admin");
  }

  async revokeArtistLink(input: {
    linkId: string;
    revokedBy: string;
    reason?: string | null;
  }) {
    const link = await prisma.trustedSourceArtistLink.findUnique({
      where: { id: input.linkId },
    });
    if (!link) {
      throw new NotFoundException("Trusted-source artist link not found");
    }

    return prisma.trustedSourceArtistLink.update({
      where: { id: input.linkId },
      data: {
        status: "revoked",
        revokedBy: input.revokedBy.toLowerCase(),
        revokedAt: new Date(),
        revokeReason:
          trimOrNull(input.reason) ||
          "Trusted-source link revoked after review.",
      },
      include: { trustedSource: true },
    });
  }

  private linkRequestInclude() {
    return {
      artist: {
        select: {
          id: true,
          userId: true,
          displayName: true,
        },
      },
      trustedSource: true,
    } satisfies Prisma.TrustedSourceLinkRequestInclude;
  }

  private async decorateLinkRequest(
    request: Prisma.TrustedSourceLinkRequestGetPayload<{
      include: ReturnType<TrustedSourceService["linkRequestInclude"]>;
    }>,
  ) {
    const evidenceBundles = await prisma.rightsEvidenceBundle.findMany({
      where: {
        subjectType: "trusted_source_link_request",
        subjectId: request.id,
      },
      include: {
        evidences: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      ...request,
      evidenceBundles,
    };
  }

  private async persistEvidenceBundle(
    normalized: NormalizedRightsEvidenceBundle,
    tx: Prisma.TransactionClient,
  ) {
    return tx.rightsEvidenceBundle.create({
      data: {
        subjectType: normalized.subjectType,
        subjectId: normalized.subjectId,
        submittedByRole: normalized.submittedByRole,
        submittedByAddress: normalized.submittedByAddress,
        purpose: normalized.purpose,
        summary: normalized.summary,
        evidences: {
          create: normalized.evidences.map((evidence) => ({
            subjectType: evidence.subjectType,
            subjectId: evidence.subjectId,
            submittedByRole: evidence.submittedByRole,
            submittedByAddress: evidence.submittedByAddress,
            kind: evidence.kind,
            title: evidence.title,
            description: evidence.description,
            sourceUrl: evidence.sourceUrl,
            sourceLabel: evidence.sourceLabel,
            claimedRightsholder: evidence.claimedRightsholder,
            artistName: evidence.artistName,
            releaseTitle: evidence.releaseTitle,
            publicationDate: evidence.publicationDate,
            isrc: evidence.isrc,
            upc: evidence.upc,
            fingerprintConfidence: evidence.fingerprintConfidence,
            strength: evidence.strength,
            verificationStatus: evidence.verificationStatus,
            attachments: (evidence.attachments as Prisma.InputJsonValue | undefined) ?? undefined,
            metadata: (evidence.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
          })),
        },
      },
    });
  }
}
