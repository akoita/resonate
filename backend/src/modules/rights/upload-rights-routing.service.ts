import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  compareRouteSeverity,
  dedupeFlags,
  evaluateUploadRightsDecision,
  getUploadRightsActions,
  normalizeSourceType,
  parseTrustedSourceTypes,
  type UploadRightsDecision,
  type UploadRightsFlag,
  type UploadRightsRoute,
} from "./upload-rights-policy";

@Injectable()
export class UploadRightsRoutingService {
  private getTrustedSourceTypes() {
    return parseTrustedSourceTypes(process.env.TRUSTED_UPLOAD_SOURCES);
  }

  async evaluateAndPersistInitialDecision(input: {
    releaseId: string;
    artistId: string;
    title?: string | null;
    primaryArtist?: string | null;
    sourceType?: string | null;
  }): Promise<UploadRightsDecision> {
    const uploaderTier = await this.getUploaderTier(input.artistId);
    const metadataConflict = await this.findMetadataConflict({
      releaseId: input.releaseId,
      artistId: input.artistId,
      title: input.title,
      primaryArtist: input.primaryArtist,
    });

    const decision = evaluateUploadRightsDecision({
      sourceType: input.sourceType || "direct_upload",
      trustedSourceTypes: this.getTrustedSourceTypes(),
      uploaderTier,
      hasMetadataConflict: !!metadataConflict,
      hasQuarantinedContent: false,
      hasDmcaContent: false,
    });

    const flags = metadataConflict
      ? dedupeFlags(decision.flags, [
          "MAJOR_CATALOG_RISK",
          "NEEDS_HUMAN_REVIEW",
          "DISPUTE_ELIGIBLE",
        ])
      : decision.flags;

    const finalDecision: UploadRightsDecision = {
      ...decision,
      flags,
      reason: metadataConflict
        ? `Upload metadata conflicts with existing release ${metadataConflict.id}. ${decision.reason}`
        : decision.reason,
    };

    await this.persistReleaseDecision(input.releaseId, finalDecision);
    return finalDecision;
  }

  async syncTrackRightsFromContentStatus(trackId: string) {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: {
        release: {
          select: {
            id: true,
            artistId: true,
            rightsRoute: true,
            rightsFlags: true,
            rightsReason: true,
            rightsPolicyVersion: true,
            rightsSourceType: true,
          },
        },
      },
    });

    if (!track) {
      throw new NotFoundException(`Track ${trackId} not found`);
    }

    const uploaderTier = await this.getUploaderTier(track.release.artistId);
    const decision = evaluateUploadRightsDecision({
      sourceType: track.release.rightsSourceType || "direct_upload",
      trustedSourceTypes: this.getTrustedSourceTypes(),
      uploaderTier,
      hasMetadataConflict: false,
      hasQuarantinedContent: track.contentStatus === "quarantined",
      hasDmcaContent: track.contentStatus === "dmca_removed",
    });

    await prisma.track.update({
      where: { id: trackId },
      data: this.serializeTrackDecision(decision),
    });

    const mergedReleaseRoute = this.pickStricterRoute(
      this.parseRoute(track.release.rightsRoute),
      decision.route,
    );
    const mergedReleaseFlags = dedupeFlags(
      this.parseFlags(track.release.rightsFlags),
      decision.flags,
    );

    await prisma.release.update({
      where: { id: track.release.id },
      data: {
        rightsRoute: mergedReleaseRoute,
        rightsFlags: mergedReleaseFlags as Prisma.InputJsonValue,
        rightsReason:
          mergedReleaseRoute === decision.route
            ? decision.reason
            : track.release.rightsReason,
        rightsPolicyVersion:
          track.release.rightsPolicyVersion || decision.policyVersion,
        rightsEvaluatedAt: new Date(),
      },
    });

    return decision;
  }

  async assertMarketplaceAllowedForStem(stemId: string) {
    const stem = await prisma.stem.findUnique({
      where: { id: stemId },
      include: {
        track: {
          include: {
            release: {
              select: {
                id: true,
                title: true,
                rightsRoute: true,
              },
            },
          },
        },
      },
    });

    if (!stem) {
      throw new NotFoundException(`Stem ${stemId} not found`);
    }

    const route = this.getMostRestrictiveRoute(
      stem.track.rightsRoute,
      stem.track.release.rightsRoute,
    );

    if (!route) {
      return;
    }

    const actions = getUploadRightsActions(route);
    if (!actions.marketplaceAllowed) {
      throw new ForbiddenException(
        `Marketplace minting is disabled while this release is routed as ${route}.`,
      );
    }
  }

  private async persistReleaseDecision(
    releaseId: string,
    decision: UploadRightsDecision,
  ) {
    const serialized = this.serializeReleaseDecision(decision);

    await prisma.release.update({
      where: { id: releaseId },
      data: serialized,
    });

    await prisma.track.updateMany({
      where: { releaseId },
      data: {
        rightsRoute: decision.route,
        rightsFlags: decision.flags as Prisma.InputJsonValue,
        rightsReason: decision.reason,
        rightsPolicyVersion: decision.policyVersion,
        rightsEvaluatedAt: new Date(),
      },
    });
  }

  private serializeReleaseDecision(decision: UploadRightsDecision) {
    return {
      rightsRoute: decision.route,
      rightsFlags: decision.flags as Prisma.InputJsonValue,
      rightsReason: decision.reason,
      rightsPolicyVersion: decision.policyVersion,
      rightsSourceType: decision.sourceType,
      rightsEvaluatedAt: new Date(),
    };
  }

  private serializeTrackDecision(decision: UploadRightsDecision) {
    return {
      rightsRoute: decision.route,
      rightsFlags: decision.flags as Prisma.InputJsonValue,
      rightsReason: decision.reason,
      rightsPolicyVersion: decision.policyVersion,
      rightsEvaluatedAt: new Date(),
    };
  }

  private async getUploaderTier(artistId: string): Promise<string> {
    const trust = await prisma.creatorTrust.findUnique({
      where: { artistId },
      select: { tier: true },
    });

    return (trust?.tier || "new").toLowerCase();
  }

  private async findMetadataConflict(input: {
    releaseId: string;
    artistId: string;
    title?: string | null;
    primaryArtist?: string | null;
  }) {
    const title = input.title?.trim();
    if (!title) {
      return null;
    }

    return prisma.release.findFirst({
      where: {
        id: { not: input.releaseId },
        artistId: { not: input.artistId },
        status: { in: ["ready", "published"] },
        title: { equals: title, mode: "insensitive" },
        ...(input.primaryArtist?.trim()
          ? {
              primaryArtist: {
                equals: input.primaryArtist.trim(),
                mode: "insensitive" as const,
              },
            }
          : {}),
      },
      select: {
        id: true,
        artistId: true,
        title: true,
        primaryArtist: true,
      },
    });
  }

  private parseRoute(value?: string | null): UploadRightsRoute | null {
    if (!value) {
      return null;
    }

    return value as UploadRightsRoute;
  }

  private pickStricterRoute(
    currentRoute: UploadRightsRoute | null,
    nextRoute: UploadRightsRoute,
  ): UploadRightsRoute {
    if (!currentRoute) {
      return nextRoute;
    }

    return compareRouteSeverity(nextRoute, currentRoute) >= 0
      ? nextRoute
      : currentRoute;
  }

  private getMostRestrictiveRoute(
    ...routes: Array<string | null | undefined>
  ): UploadRightsRoute | null {
    let strictestRoute: UploadRightsRoute | null = null;

    for (const rawRoute of routes) {
      const route = this.parseRoute(rawRoute);
      if (!route) {
        continue;
      }
      if (!strictestRoute || compareRouteSeverity(route, strictestRoute) > 0) {
        strictestRoute = route;
      }
    }

    return strictestRoute;
  }

  private parseFlags(value: Prisma.JsonValue | null): UploadRightsFlag[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is UploadRightsFlag => typeof entry === "string") as UploadRightsFlag[];
  }
}
