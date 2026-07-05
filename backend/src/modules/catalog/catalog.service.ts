import { BadRequestException, Injectable, OnModuleInit, NotFoundException } from "@nestjs/common";
import { LicenseType, Prisma } from "@prisma/client";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import { EncryptionService } from "../encryption/encryption.service";
import { StorageProvider } from "../storage/storage_provider";
import {
  CatalogTrackStatusEvent,
  IpNftMintedEvent,
  StemsProcessedEvent,
  StemsUploadedEvent,
} from "../../events/event_types";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";
import {
  compareRouteSeverity,
  getUploadRightsActions,
  type UploadRightsRoute,
} from "../rights/upload-rights-policy";

const PUBLIC_RELEASE_ROUTES: UploadRightsRoute[] = [
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
];
const SOURCE_STEM_TYPES = new Set(["original", "master"]);
const MAIN_ARTIST_CREDIT_ROLES = new Set(["main", "primary"]);

/** Source attribution + AI provenance for a published remix release (#1196). */
export type RemixReleaseProvenance = {
  attribution: string;
  sourceTrackId: string | null;
  sourceReleaseId: string | null;
  sourceTrackTitle: string | null;
  sourceArtistName: string | null;
  grounding: string | null;
  aiGenerated: boolean;
  remixProjectId: string | null;
};

type AudioRange = { start: number; end: number; total: number };
type AudioPayload = { data: Buffer; mimeType?: string | null; range?: AudioRange };
type AudioRequestOptions = { includeRestricted?: boolean; range?: string };
type ReleaseArtistCreditInput = {
  artistId?: string | null;
  displayName?: string | null;
  role: string;
  sortOrder?: number;
};

const RELEASE_ARTIST_CREDITS_SELECT = {
  orderBy: [{ sortOrder: "asc" as const }, { role: "asc" as const }],
  select: {
    id: true,
    releaseId: true,
    artistId: true,
    role: true,
    displayName: true,
    sortOrder: true,
    artist: {
      select: {
        id: true,
        displayName: true,
        profileType: true,
        claimStatus: true,
        imageUrl: true,
        summary: true,
      },
    },
  },
};

function sameUserId(left?: string | null, right?: string | null) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function normalizeMoodTags(value?: string[] | null) {
  const normalized = (value || [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 8);
}

function normalizeCreditName(value?: string | null) {
  return (value || "").trim().replace(/\s+/g, " ");
}

function splitFeaturedArtists(value?: string[] | string | null) {
  const entries = Array.isArray(value) ? value : (value || "").split(",");
  return entries.map(normalizeCreditName).filter(Boolean).slice(0, 20);
}

function publicArtistCreditName(
  release: {
    primaryArtist?: string | null;
    artist?: { displayName?: string | null } | null;
    artistCredits?: Array<{ role: string; displayName: string }> | null;
  },
) {
  const mainCredits = (release.artistCredits || [])
    .filter((credit) => MAIN_ARTIST_CREDIT_ROLES.has(credit.role.toLowerCase()))
    .map((credit) => normalizeCreditName(credit.displayName))
    .filter(Boolean);

  return mainCredits.join(", ")
    || normalizeCreditName(release.primaryArtist)
    || normalizeCreditName(release.artist?.displayName)
    || "Unknown Artist";
}

function sanitizeRecommendationReasons(value?: string[] | null) {
  return (value || [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [kind, rawValue] = entry.split(":");
      const safeValue = rawValue?.trim().slice(0, 40);
      if (kind === "genre" && safeValue) {
        return `Matches your ${safeValue} preference`;
      }
      if (kind === "mood" && safeValue) {
        return `Fits your ${safeValue} mood`;
      }
      if (entry === "fresh_release") {
        return "Recent catalog addition";
      }
      if (entry === "agent_pick") {
        return "Recommended by your session";
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3);
}

export type McpCatalogSearchItem = {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  moods: string[];
  releaseDate: string | null;
  artworkUrl: string | null;
  trackCount: number;
  licensable: boolean;
  deeplink: string;
};

export type PlayerActionKey =
  | "save"
  | "add_to_playlist"
  | "inspect_stems"
  | "buy_license"
  | "remix"
  | "artist_room"
  | "shows_campaign"
  | "collect_drop";

export type PlayerActionStatus = "available" | "disabled" | "planned";

export type PlayerTrackAction = {
  key: PlayerActionKey;
  label: string;
  status: PlayerActionStatus;
  href?: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean | string[] | null>;
};

export type PlayerTrackActionsResponse = {
  track: {
    id: string;
    title: string;
    releaseId: string;
    releaseTitle: string;
    artistId: string;
    artistName: string | null;
    genre: string | null;
    moods: string[];
  };
  recommendation?: {
    summary: string;
    reasons: string[];
  };
  actions: PlayerTrackAction[];
};

const PLAYER_ACTION_LABELS: Record<PlayerActionKey, string> = {
  save: "Save",
  add_to_playlist: "Add to playlist",
  inspect_stems: "Inspect stems",
  buy_license: "Buy or license",
  remix: "Remix",
  artist_room: "Artist room",
  shows_campaign: "Support a show",
  collect_drop: "Collect",
};

@Injectable()
export class CatalogService implements OnModuleInit {
  private searchCache = new Map<
    string,
    { items: unknown[]; cachedAt: number }
  >();
  private readonly cacheTtlMs = 30_000;

  private async deleteLegacyStemQualityRatings(
    tx: Prisma.TransactionClient,
    stemIds: string[],
  ) {
    if (stemIds.length === 0) {
      return;
    }

    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('"public"."StemQualityRating"') IS NOT NULL AS "exists"
    `;

    if (!rows[0]?.exists) {
      return;
    }

    await tx.$executeRaw`
      DELETE FROM "StemQualityRating"
      WHERE "stemId" IN (${Prisma.join(stemIds)})
    `;
  }

  private resolveInternalUri(uri: string): string {
    const trimmedUri = uri.trim();
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

    if (trimmedUri.startsWith("/")) {
      return `${baseUrl}${trimmedUri}`;
    }

    if (trimmedUri.startsWith("catalog/")) {
      return `${baseUrl}/${trimmedUri}`;
    }

    return trimmedUri;
  }

  private async fetchStemSourceBuffer(uri: string): Promise<Buffer> {
    const trimmedUri = uri.trim();
    if (!trimmedUri) {
      throw new BadRequestException("Stem has no source URI");
    }

    try {
      const downloaded = await this.storageProvider.download(trimmedUri);
      if (downloaded) {
        return downloaded;
      }
    } catch (error) {
      console.warn(`[Catalog] Storage provider download failed for ${trimmedUri}:`, error);
    }

    const resolvedUri = this.resolveInternalUri(trimmedUri);
    if (!/^https?:\/\//i.test(resolvedUri)) {
      throw new BadRequestException(`Unsupported stem source URI: ${trimmedUri}`);
    }

    const response = await fetch(resolvedUri);
    if (!response.ok) {
      throw new Error(`Failed to fetch stem content: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private getLocalStemFilename(stem: { id: string; uri: string }) {
    const trimmedUri = stem.uri.trim();
    if (!trimmedUri) {
      return stem.id;
    }

    // Bare local filenames are stored directly for original uploads.
    if (!trimmedUri.includes("/")) {
      return trimmedUri;
    }

    const parts = trimmedUri.split("/").filter(Boolean);
    const blobIndex = parts.lastIndexOf("blob");
    if (blobIndex > 0) {
      return parts[blobIndex - 1];
    }

    return parts[parts.length - 1] || stem.id;
  }

  constructor(
    private readonly eventBus: EventBus,
    private readonly encryptionService: EncryptionService,
    private readonly storageProvider: StorageProvider,
    private readonly uploadRightsRoutingService: UploadRightsRoutingService,
  ) { }

  private hasSeparatedStems(
    release: { tracks?: Array<{ stems?: Array<{ type?: string | null }> }> },
  ) {
    return release.tracks?.some((track) =>
      track.stems?.some((stem) => !SOURCE_STEM_TYPES.has(String(stem.type || "").toLowerCase())),
    ) ?? false;
  }

  private releaseHasOnlySourceAudio(
    release: { tracks?: Array<{ stems?: Array<{ type?: string | null }> }> },
  ) {
    const stems = release.tracks?.flatMap((track) => track.stems ?? []) ?? [];
    return stems.length > 0 && stems.every((stem) =>
      SOURCE_STEM_TYPES.has(String(stem.type || "").toLowerCase()),
    );
  }

  private async consolidateAiDemucsDuplicate(releaseId: string) {
    const canonical = await prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        tracks: {
          orderBy: { position: "asc" },
          include: { stems: true },
        },
      },
    });

    if (
      !canonical ||
      canonical.type !== "ai_generated" ||
      !this.releaseHasOnlySourceAudio(canonical)
    ) {
      return false;
    }

    const duplicate = await prisma.release.findFirst({
      where: {
        id: { not: canonical.id },
        artistId: canonical.artistId,
        title: { equals: canonical.title, mode: "insensitive" },
        status: { in: ["ready", "published"] },
        rightsSourceType: "ai_generated",
        tracks: {
          some: {
            stems: {
              some: {
                type: { notIn: ["original", "ORIGINAL", "master", "MASTER"] },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        tracks: {
          orderBy: { position: "asc" },
          include: { stems: true },
        },
      },
    });

    if (!duplicate) {
      return false;
    }

    const canonicalTrack = canonical.tracks[0];
    if (!canonicalTrack) {
      return false;
    }

    const separatedStemIds = duplicate.tracks
      .flatMap((track) => track.stems)
      .filter((stem) => !SOURCE_STEM_TYPES.has(stem.type.toLowerCase()))
      .map((stem) => stem.id);

    if (separatedStemIds.length === 0) {
      return false;
    }

    const canonicalRightsUpdate = {
      status: "ready",
      processingError: null,
      rightsRoute: duplicate.rightsRoute ?? canonical.rightsRoute,
      rightsFlags: (duplicate.rightsFlags ?? canonical.rightsFlags ?? undefined) as Prisma.InputJsonValue | undefined,
      rightsReason: duplicate.rightsReason ?? canonical.rightsReason,
      rightsPolicyVersion: duplicate.rightsPolicyVersion ?? canonical.rightsPolicyVersion,
      rightsSourceType: duplicate.rightsSourceType ?? canonical.rightsSourceType ?? "ai_generated",
      rightsEvaluatedAt: duplicate.rightsEvaluatedAt ?? canonical.rightsEvaluatedAt,
    };

    try {
      await prisma.$transaction(async (tx) => {
        await tx.release.update({
          where: { id: canonical.id },
          data: canonicalRightsUpdate,
        });
        await tx.track.update({
          where: { id: canonicalTrack.id },
          data: {
            processingStatus: "complete",
            processingError: null,
            rightsRoute: canonicalRightsUpdate.rightsRoute,
            rightsFlags: canonicalRightsUpdate.rightsFlags,
            rightsReason: canonicalRightsUpdate.rightsReason,
            rightsPolicyVersion: canonicalRightsUpdate.rightsPolicyVersion,
            rightsEvaluatedAt: canonicalRightsUpdate.rightsEvaluatedAt,
          },
        });
        await tx.stem.updateMany({
          where: { id: { in: separatedStemIds } },
          data: { trackId: canonicalTrack.id },
        });
        await tx.stem.deleteMany({
          where: { track: { releaseId: duplicate.id } },
        });
        await tx.track.deleteMany({
          where: { releaseId: duplicate.id },
        });
        await tx.release.delete({
          where: { id: duplicate.id },
        });
      });
    } catch (error) {
      console.warn(
        `[Catalog] Could not delete duplicate release ${duplicate.id}; hiding it after consolidation:`,
        error,
      );
      await prisma.stem.updateMany({
        where: { id: { in: separatedStemIds } },
        data: { trackId: canonicalTrack.id },
      });
      await prisma.track.update({
        where: { id: canonicalTrack.id },
        data: { processingStatus: "complete", processingError: null },
      });
      await prisma.release.update({
        where: { id: canonical.id },
        data: canonicalRightsUpdate,
      });
      await prisma.release.update({
        where: { id: duplicate.id },
        data: {
          status: "duplicate_consolidated",
          processingError: `Consolidated into ${canonical.id}`,
        },
      });
    }

    this.clearCache();
    console.log(`[Catalog] Consolidated duplicate Demucs release ${duplicate.id} into AI release ${canonical.id}`);
    return true;
  }

  onModuleInit() {
    this.eventBus.subscribe("stems.uploaded", async (event: StemsUploadedEvent) => {
      console.log(`[Catalog] Received stems.uploaded for release ${event.releaseId} (artist: ${event.artistId})`);
      this.clearCache();
      try {
        await prisma.$transaction(async (tx) => {
          await tx.release.upsert({
            where: { id: event.releaseId },
            update: {
              artistId: event.artistId,
              status: "processing",
              processingError: null,
              rightsSourceType: event.sourceType || "direct_upload",
              artworkData: event.artworkData,
              artworkMimeType: event.artworkMimeType,
              title: event.metadata?.title ?? undefined,
              type: event.metadata?.type ?? undefined,
              primaryArtist: event.metadata?.primaryArtist ?? undefined,
              featuredArtists: event.metadata?.featuredArtists?.join(", ") ?? undefined,
              genre: event.metadata?.genre ?? undefined,
              moods: normalizeMoodTags(event.metadata?.moods),
              label: event.metadata?.label ?? undefined,
              releaseDate: event.metadata?.releaseDate ? new Date(event.metadata.releaseDate) : undefined,
              explicit: event.metadata?.explicit ?? undefined,
              tracks: event.checksum === "retry" ? {
                updateMany: {
                  where: { releaseId: event.releaseId },
                  data: {
                    processingStatus: "pending",
                    processingError: null,
                    processingStartedAt: null,
                    lastProgressAt: null,
                  }
                }
              } : undefined
            },
            create: {
              id: event.releaseId,
              artistId: event.artistId,
              title: event.metadata?.title || "Untitled Release",
              status: "processing",
              processingError: null,
              rightsSourceType: event.sourceType || "direct_upload",
              type: event.metadata?.type || "single",
              primaryArtist: event.metadata?.primaryArtist,
              featuredArtists: event.metadata?.featuredArtists?.join(", "),
              genre: event.metadata?.genre,
              moods: normalizeMoodTags(event.metadata?.moods),
              label: event.metadata?.label,
              releaseDate: event.metadata?.releaseDate
                ? new Date(event.metadata.releaseDate)
                : undefined,
              explicit: event.metadata?.explicit ?? false,
              artworkData: event.artworkData,
              artworkMimeType: event.artworkMimeType,
              tracks: {
                create: event.metadata?.tracks?.map((t: any) => ({
                  id: t.id,
                  title: t.title,
                  artist: t.artist,
                  position: t.position,
                  explicit: t.explicit ?? false,
                  isrc: t.isrc,
                  stems: {
                    create: t.stems?.map((s: any) => ({
                      id: s.id,
                      type: s.type,
                      uri: s.uri,
                      storageProvider: s.storageProvider || "local"
                    }))
                  }
                })),
              },
            },
          });
          await this.syncReleaseArtistCredits(tx, {
            releaseId: event.releaseId,
            managerArtistId: event.artistId,
            primaryArtist: event.metadata?.primaryArtist,
            featuredArtists: event.metadata?.featuredArtists,
          });
        });
        await this.uploadRightsRoutingService.evaluateAndPersistInitialDecision({
          releaseId: event.releaseId,
          artistId: event.artistId,
          title: event.metadata?.title,
          primaryArtist: event.metadata?.primaryArtist,
          sourceType: event.sourceType,
        });
        console.log(`[Catalog] Created/Updated release ${event.releaseId} with ${event.metadata?.tracks?.length} tracks`);
      } catch (err) {
        console.error(`[Catalog] Failed to create/update release ${event.releaseId}:`, err);
      }
    });

    this.eventBus.subscribe("stems.processed", async (event: StemsProcessedEvent) => {
      console.log(`[Catalog] Received stems.processed for release ${event.releaseId}`);
      this.clearCache();

      let release = await prisma.release.findUnique({ where: { id: event.releaseId } });
      let attempts = 0;
      const maxAttempts = 5;

      while (!release && attempts < maxAttempts) {
        attempts++;
        console.warn(`[Catalog] Release ${event.releaseId} not found yet (attempt ${attempts}/${maxAttempts}). Retrying in 1s...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        release = await prisma.release.findUnique({ where: { id: event.releaseId } });
      }

      if (!release) {
        console.error(`[Catalog] Release ${event.releaseId} still not found after ${maxAttempts} attempts. Dropping stems.`);
        return;
      }

      try {
        if (event.tracks?.length) {
          for (const trackData of event.tracks) {
            // Ensure track exists (it should from stems.uploaded)
            await prisma.track.upsert({
              where: { id: trackData.id },
              create: {
                id: trackData.id,
                releaseId: event.releaseId,
                title: trackData.title,
                artist: trackData.artist,
                position: trackData.position,
                processingStatus: "complete", // Mark as complete when processed
                processingError: null,
                rightsRoute: release.rightsRoute,
                rightsFlags: (release.rightsFlags ?? undefined) as Prisma.InputJsonValue | undefined,
                rightsReason: release.rightsReason,
                rightsPolicyVersion: release.rightsPolicyVersion,
                rightsEvaluatedAt: release.rightsEvaluatedAt,
              },
              update: {
                title: trackData.title,
                artist: trackData.artist,
                position: trackData.position,
                processingStatus: "complete", // Mark as complete when processed
                processingError: null,
                rightsRoute: release.rightsRoute,
                rightsFlags: (release.rightsFlags ?? undefined) as Prisma.InputJsonValue | undefined,
                rightsReason: release.rightsReason,
                rightsPolicyVersion: release.rightsPolicyVersion,
                rightsEvaluatedAt: release.rightsEvaluatedAt,
              },
            });

            // Emit track status change event
            this.eventBus.publish({
              eventName: "catalog.track_status",
              eventVersion: 1,
              occurredAt: new Date().toISOString(),
              releaseId: event.releaseId,
              trackId: trackData.id,
              status: "complete",
            } as CatalogTrackStatusEvent);

            // Clean up stale separated stems from previous (possibly crashed) runs
            const newStemIds = trackData.stems.map((s: any) => s.id);
            const deletedStale = await prisma.stem.deleteMany({
              where: {
                trackId: trackData.id,
                type: { not: "original" },
                id: { notIn: newStemIds },
              },
            });
            if (deletedStale.count > 0) {
              console.log(`[Catalog] Cleaned up ${deletedStale.count} stale stems for track ${trackData.id}`);
            }

            for (const stem of trackData.stems) {
              console.log(`[Catalog] Upserting stem ${stem.id} for track ${trackData.id}`);
              await prisma.stem.upsert({
                where: { id: stem.id },
                create: {
                  id: stem.id,
                  trackId: trackData.id,
                  type: stem.type,
                  uri: stem.uri,
                  data: stem.data, // Present in sync/test mode, undefined in production (fetched from storage URI)
                  mimeType: stem.mimeType,
                  durationSeconds: stem.durationSeconds,
                  // Sanitized worker measurements (#1184); undefined (old
                  // payloads) leaves the column untouched.
                  audioFeatures:
                    (stem.audioFeatures as Prisma.InputJsonValue | null | undefined) ?? undefined,
                  isEncrypted: stem.isEncrypted ?? false,
                  encryptionMetadata: stem.encryptionMetadata,
                  storageProvider: stem.storageProvider ?? "local",
                },
                update: {
                  type: stem.type,
                  uri: stem.uri,
                  data: stem.data, // Present in sync/test mode, undefined in production
                  mimeType: stem.mimeType,
                  durationSeconds: stem.durationSeconds,
                  audioFeatures:
                    (stem.audioFeatures as Prisma.InputJsonValue | null | undefined) ?? undefined,
                  isEncrypted: stem.isEncrypted ?? false,
                  encryptionMetadata: stem.encryptionMetadata,
                  storageProvider: stem.storageProvider ?? "local",
                },
              });
            }
          }
        }

        const latestRelease = await prisma.release.findUnique({
          where: { id: event.releaseId },
          select: { status: true },
        });

        if (latestRelease?.status === "failed") {
          console.warn(
            `[Catalog] Release ${event.releaseId} is already failed; skipping ready transition for late stems.processed`,
          );
          return;
        }

        await prisma.release.update({
          where: { id: event.releaseId },
          data: { status: "ready", processingError: null },
        });
        console.log(`[Catalog] Release ${event.releaseId} updated to ready`);

        this.eventBus.publish({
          eventName: "catalog.release_ready",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          releaseId: event.releaseId,
          artistId: event.artistId,
          metadata: event.metadata,
        });
      } catch (err) {
        // Extract error message only - Prisma errors can have circular refs that cause stack overflow
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Catalog] Failed to finalise release ${event.releaseId}: ${errMsg}`);
      }
    });

    // Note: stems.progress status updates are now handled by IngestionService.emitTrackStage()
    // which persists granular statuses (separating, encrypting, storing) directly

    this.eventBus.subscribe("ipnft.minted", async (event: IpNftMintedEvent) => {
      this.clearCache();
      await prisma.stem
        .update({
          where: { id: event.stemId },
          data: { ipnftId: event.tokenId },
        })
        .catch(() => null);
    });

    this.eventBus.subscribe("stems.failed", async (event: any) => {
      console.log(`[Catalog] Received stems.failed for release ${event.releaseId}: ${event.error}`);
      this.clearCache();
      try {
        const releaseUpdate = await prisma.release.updateMany({
          where: { id: event.releaseId },
          data: { status: "failed", processingError: event.error || "Unknown processing error" },
        });

        if (releaseUpdate.count === 0) {
          console.warn(
            `[Catalog] Ignoring late stems.failed for missing release ${event.releaseId}`,
          );
          return;
        }

        // Also update all non-complete tracks to failed
        const tracksToFail = await prisma.track.findMany({
          where: {
            releaseId: event.releaseId,
            processingStatus: { in: ["pending", "separating", "encrypting", "storing"] }
          },
          select: { id: true }
        });

        await prisma.track.updateMany({
          where: {
            releaseId: event.releaseId,
            processingStatus: { in: ["pending", "separating", "encrypting", "storing"] }
          },
          data: {
            processingStatus: "failed",
            processingError: event.error || "Unknown processing error",
          }
        });

        // Emit status event for each failed track
        for (const track of tracksToFail) {
          this.eventBus.publish({
            eventName: "catalog.track_status",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId: event.releaseId,
            trackId: track.id,
            status: "failed",
            error: event.error || "Unknown processing error",
          } as CatalogTrackStatusEvent);
        }
      } catch (err) {
        console.error(`[Catalog] Failed to update release status to failed for ${event.releaseId}:`, err);
      }
    });
  }

  async listPublished(limit = 20, primaryArtist?: string): Promise<any[]> {
    const releases = await prisma.release.findMany({
      where: {
        status: { in: ['ready', 'published'] },
        AND: [
          {
            OR: [
              { rightsRoute: null },
              { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
            ],
          },
          ...(primaryArtist
            ? [{
                OR: [
                  { primaryArtist: { equals: primaryArtist, mode: 'insensitive' as const } },
                  {
                    artistCredits: {
                      some: {
                        displayName: { equals: primaryArtist, mode: 'insensitive' as const },
                        role: { in: ["main", "primary"] },
                      },
                    },
                  },
                ],
              }]
            : []),
        ],
      },
      select: {
        id: true,
        artistId: true,
        title: true,
        status: true,
        processingError: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        moods: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        rightsRoute: true,
        rightsFlags: true,
        rightsReason: true,
        rightsPolicyVersion: true,
        rightsSourceType: true,
        rightsEvaluatedAt: true,
        artworkMimeType: true, // Useful for frontend to know, but DATA must be excluded
        artist: {
          select: { id: true, displayName: true, userId: true, payoutAddress: true }
        },
        artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            artist: true,
            position: true,
            explicit: true,
            isrc: true,
            createdAt: true,
            processingStatus: true,
            processingError: true,
            contentStatus: true,
            rightsRoute: true,
            rightsFlags: true,
            rightsReason: true,
            rightsPolicyVersion: true,
            rightsEvaluatedAt: true,
            stems: {
              select: {
                id: true,
                type: true,
                uri: true,
                ipnftId: true,
                checksum: true,
                durationSeconds: true,
                isEncrypted: true,
                encryptionMetadata: true,
                // Exclude data and mimeType (huge blobs)
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const consolidated = await Promise.all(
      releases
        .filter((release) => release.type === "ai_generated" && this.releaseHasOnlySourceAudio(release))
        .map((release) => this.consolidateAiDemucsDuplicate(release.id)),
    );

    if (consolidated.some(Boolean)) {
      return this.listPublished(limit, primaryArtist);
    }

    return releases;
  }

  async createRelease(input: {
    userId: string;
    title: string;
    type?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    artistCredits?: ReleaseArtistCreditInput[];
    genre?: string;
    moods?: string[];
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
    tracks?: Array<{ title: string; position: number; explicit?: boolean }>;
  }) {
    const artist = await prisma.artist.findUnique({
      where: { userId: input.userId },
    });

    if (!artist) {
      throw new BadRequestException("User is not a registered artist");
    }

    const primaryArtist = input.primaryArtist?.trim() || artist.displayName;

    this.clearCache();
    return prisma.$transaction(async (tx) => {
      const release = await tx.release.create({
        data: {
          artistId: artist.id,
          title: input.title,
          status: "draft",
          type: input.type ?? "single",
          primaryArtist,
          featuredArtists: input.featuredArtists?.join(", "),
          genre: input.genre,
          moods: normalizeMoodTags(input.moods),
          label: input.label,
          releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
          explicit: input.explicit ?? false,
          tracks: {
            create: input.tracks?.map(t => ({
              title: t.title,
              position: t.position,
              explicit: t.explicit ?? false,
              artist: primaryArtist,
            }))
          }
        },
        select: {
          id: true,
          title: true,
          status: true,
          tracks: {
            select: { id: true, title: true, position: true }
          }
        }
      });
      await this.syncReleaseArtistCredits(tx, {
        releaseId: release.id,
        managerArtistId: artist.id,
        primaryArtist,
        featuredArtists: input.featuredArtists,
        artistCredits: input.artistCredits,
      });
      return release;
    });
  }

  private async syncReleaseArtistCredits(
    tx: Prisma.TransactionClient,
    input: {
      releaseId: string;
      managerArtistId: string;
      primaryArtist?: string | null;
      featuredArtists?: string[] | string | null;
      artistCredits?: ReleaseArtistCreditInput[] | null;
    },
  ) {
    const managerArtist = await tx.artist.findUnique({
      where: { id: input.managerArtistId },
      select: { id: true, displayName: true },
    });
    if (!managerArtist) {
      throw new BadRequestException("Release manager artist profile was not found");
    }

    const explicitCredits = (input.artistCredits || [])
      .map((credit, index) => ({
        role: normalizeCreditName(credit.role || "featured").toLowerCase() || "featured",
        displayName: normalizeCreditName(credit.displayName),
        artistId: credit.artistId?.trim() || null,
        sortOrder: credit.sortOrder ?? index,
      }))
      .filter((credit) => credit.displayName || credit.artistId);

    const primaryDisplayName = normalizeCreditName(input.primaryArtist) || managerArtist.displayName;
    const fallbackCredits: ReleaseArtistCreditInput[] = [
      {
        role: "main",
        displayName: primaryDisplayName,
        sortOrder: 0,
      },
      ...splitFeaturedArtists(input.featuredArtists).map((displayName, index) => ({
        role: "featured",
        displayName,
        sortOrder: index + 1,
      })),
    ];
    const credits = explicitCredits.length > 0 ? explicitCredits : fallbackCredits;

    await tx.releaseArtistCredit.deleteMany({ where: { releaseId: input.releaseId } });
    for (const credit of credits) {
      const artist = credit.artistId
        ? await tx.artist.findUnique({ where: { id: credit.artistId } })
        : await this.findOrCreatePublicArtistProfile(tx, credit.displayName || managerArtist.displayName, managerArtist);
      if (!artist) {
        throw new BadRequestException("Release artist credit must reference an existing artist profile");
      }
      const displayName = normalizeCreditName(credit.displayName) || artist.displayName;
      await tx.releaseArtistCredit.create({
        data: {
          releaseId: input.releaseId,
          artistId: artist.id,
          role: credit.role,
          displayName,
          sortOrder: credit.sortOrder ?? 0,
        },
      });
    }
  }

  private async findOrCreatePublicArtistProfile(
    tx: Prisma.TransactionClient,
    displayName: string,
    managerArtist: { id: string; displayName: string },
  ) {
    const normalizedDisplayName = normalizeCreditName(displayName);
    if (!normalizedDisplayName) {
      throw new BadRequestException("Release artist credit name is required");
    }

    if (normalizedDisplayName.toLowerCase() === managerArtist.displayName.toLowerCase()) {
      return tx.artist.findUnique({ where: { id: managerArtist.id } });
    }

    const matches = await tx.artist.findMany({
      where: { displayName: { equals: normalizedDisplayName, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    const publicProfile = matches.find((artist) => artist.profileType === "public_artist") ?? matches[0];
    if (publicProfile) return publicProfile;

    return tx.artist.create({
      data: {
        displayName: normalizedDisplayName,
        profileType: "public_artist",
        claimStatus: "unclaimed",
      },
    });
  }

  async getTrack(trackId: string) {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        releaseId: true,
        title: true,
        position: true,
        explicit: true,
        isrc: true,
        createdAt: true,
        processingStatus: true,
        processingError: true,
        contentStatus: true,
        rightsRoute: true,
        rightsFlags: true,
        rightsReason: true,
        rightsPolicyVersion: true,
        rightsEvaluatedAt: true,
        stems: {
          select: {
            id: true,
            type: true,
            uri: true,
            ipnftId: true,
            durationSeconds: true,
            isEncrypted: true,
            encryptionMetadata: true,
            // Exclude data
          }
        },
        release: {
          select: {
            id: true,
            title: true,
            primaryArtist: true,
            processingError: true,
            rightsRoute: true,
            rightsFlags: true,
            rightsReason: true,
            rightsPolicyVersion: true,
            rightsSourceType: true,
            rightsEvaluatedAt: true,
            artworkMimeType: true,
            artist: { select: { id: true, displayName: true, userId: true } }
          }
        }
      }
    });

    if (!track) {
      return null;
    }

    const effectiveRoute = this.getMostRestrictiveRoute(
      track.rightsRoute,
      track.release.rightsRoute,
    );
    if (!this.isPubliclyVisible(effectiveRoute)) {
      return null;
    }

    return track;
  }

  async getPlayerTrackActions(
    trackId: string,
    options?: { recommendationReasons?: string[] },
  ): Promise<PlayerTrackActionsResponse | null> {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        explicit: true,
        processingStatus: true,
        contentStatus: true,
        rightsRoute: true,
        stems: {
          select: {
            id: true,
            type: true,
            nftMint: {
              select: {
                tokenId: true,
                chainId: true,
                remixable: true,
              },
            },
          },
        },
        release: {
          select: {
            id: true,
            title: true,
            artistId: true,
            primaryArtist: true,
            genre: true,
            moods: true,
            status: true,
            rightsRoute: true,
            artist: { select: { displayName: true } },
            artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
          },
        },
      },
    });

    if (!track) {
      return null;
    }

    const effectiveRoute = this.getMostRestrictiveRoute(
      track.rightsRoute,
      track.release.rightsRoute,
    );
    if (!this.isPubliclyVisible(effectiveRoute)) {
      return null;
    }

    const now = new Date();
    const activeListings = await prisma.stemListing.findMany({
      where: {
        stem: { trackId: track.id },
        status: "active",
        amount: { gt: 0 },
        expiresAt: { gt: now },
        licenseType: { in: [LicenseType.personal, LicenseType.remix, LicenseType.commercial] },
      },
      select: {
        listingId: true,
        chainId: true,
        tokenId: true,
        stemId: true,
        licenseType: true,
      },
      orderBy: { listedAt: "desc" },
    });

    const publicStemCount = track.stems.length;
    const mintedStems = track.stems.filter((stem) => stem.nftMint);
    const firstInspectableStem = mintedStems[0];
    const licenseTypes = Array.from(new Set(activeListings.map((listing) => listing.licenseType)));
    const hasRemixListing = activeListings.some((listing) => listing.licenseType === LicenseType.remix);
    const hasRemixableMint = track.stems.some((stem) => stem.nftMint?.remixable);
    const safeRecommendationReasons = sanitizeRecommendationReasons(options?.recommendationReasons);
    const activeCampaign = track.release.artistId
      ? await prisma.showCampaign.findFirst({
          where: { artistId: track.release.artistId, status: "active" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            slug: true,
            title: true,
            city: true,
            goalAmountUnits: true,
            raisedAmountUnits: true,
            confirmedPledgeCount: true,
          },
        })
      : null;
    const campaignGoal = Number(activeCampaign?.goalAmountUnits ?? 0);
    const campaignRaised = Number(activeCampaign?.raisedAmountUnits ?? 0);
    const campaignProgressPct =
      Number.isFinite(campaignGoal) && campaignGoal > 0 && Number.isFinite(campaignRaised)
        ? Math.min(100, Math.round((campaignRaised / campaignGoal) * 100))
        : 0;

    return {
      track: {
        id: track.id,
        title: track.title,
        releaseId: track.release.id,
        releaseTitle: track.release.title,
        artistId: track.release.artistId,
        artistName: publicArtistCreditName(track.release),
        genre: track.release.genre,
        moods: track.release.moods,
      },
      ...(safeRecommendationReasons.length
        ? {
            recommendation: {
              summary: safeRecommendationReasons.join(" · "),
              reasons: safeRecommendationReasons,
            },
          }
        : {}),
      actions: [
        {
          key: "save",
          label: PLAYER_ACTION_LABELS.save,
          status: "available",
          metadata: { trackId: track.id, releaseId: track.release.id },
        },
        {
          key: "add_to_playlist",
          label: PLAYER_ACTION_LABELS.add_to_playlist,
          status: "available",
          metadata: { trackId: track.id, releaseId: track.release.id },
        },
        publicStemCount > 0
          ? {
              key: "inspect_stems",
              label: PLAYER_ACTION_LABELS.inspect_stems,
              status: "available",
              href: firstInspectableStem?.nftMint
                ? `/stem/${firstInspectableStem.nftMint.tokenId.toString()}`
                : `/release/${track.release.id}`,
              metadata: {
                stemCount: publicStemCount,
                mintedStemCount: mintedStems.length,
                stemTypes: Array.from(new Set(track.stems.map((stem) => stem.type))).slice(0, 12),
              },
            }
          : {
              key: "inspect_stems",
              label: PLAYER_ACTION_LABELS.inspect_stems,
              status: "disabled",
              reason: "No public stems are available for this track.",
            },
        activeListings.length > 0
          ? {
              key: "buy_license",
              label: PLAYER_ACTION_LABELS.buy_license,
              status: "available",
              href: "/marketplace",
              metadata: {
                listingCount: activeListings.length,
                licenseTypes,
                firstListingId: activeListings[0].listingId.toString(),
                chainId: activeListings[0].chainId,
              },
            }
          : {
              key: "buy_license",
              label: PLAYER_ACTION_LABELS.buy_license,
              status: "disabled",
              reason: "No active stem license is available.",
            },
        hasRemixListing || hasRemixableMint
          ? {
              key: "remix",
              label: PLAYER_ACTION_LABELS.remix,
              status: "available",
              href: hasRemixListing ? "/marketplace" : `/release/${track.release.id}`,
              metadata: {
                source: hasRemixListing ? "marketplace_listing" : "stem_nft_metadata",
                hasRemixListing,
              },
            }
          : {
              key: "remix",
              label: PLAYER_ACTION_LABELS.remix,
              status: "disabled",
              reason: "Remix rights are not available for this track.",
            },
        {
          key: "artist_room",
          label: PLAYER_ACTION_LABELS.artist_room,
          status: "planned",
          reason: "Artist rooms are not open for this track yet.",
        },
        {
          key: "shows_campaign",
          label: PLAYER_ACTION_LABELS.shows_campaign,
          ...(activeCampaign
            ? {
                status: "available" as const,
                href: `/shows/${activeCampaign.slug}`,
                metadata: {
                  campaignId: activeCampaign.id,
                  slug: activeCampaign.slug,
                  title: activeCampaign.title,
                  city: activeCampaign.city,
                  progressPct: campaignProgressPct,
                  backerCount: activeCampaign.confirmedPledgeCount,
                },
              }
            : {
                status: "disabled" as const,
                reason: "No live campaign for this artist right now.",
              }),
        },
        {
          key: "collect_drop",
          label: PLAYER_ACTION_LABELS.collect_drop,
          status: "planned",
          reason: "No active drop is available for this track.",
        },
      ],
    };
  }

  async getRelease(releaseId: string, options?: { includeRestricted?: boolean }) {
    let release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        artistId: true,
        title: true,
        status: true,
        processingError: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        moods: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        rightsRoute: true,
        rightsFlags: true,
        rightsReason: true,
        rightsPolicyVersion: true,
        rightsSourceType: true,
        rightsEvaluatedAt: true,
        artworkMimeType: true,
        artist: {
          select: { id: true, displayName: true, userId: true }
        },
        artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            artist: true,
            position: true,
            explicit: true,
            isrc: true,
            createdAt: true,
            processingStatus: true,
            processingError: true,
            contentStatus: true,
            // Remix lineage (#1196): source attribution + AI-provenance
            // label for published remix releases.
            generationMetadata: true,
            rightsRoute: true,
            rightsFlags: true,
            rightsReason: true,
            rightsPolicyVersion: true,
            rightsEvaluatedAt: true,
            stems: {
              select: {
                id: true,
                type: true,
                uri: true,
                ipnftId: true,
                durationSeconds: true,
                isEncrypted: true,
                encryptionMetadata: true,
                storageProvider: true,
                // Exclude data
              }
            }
          }
        }
      }
    });

    if (!release) {
      return null;
    }

    if (release.type === "ai_generated" && this.releaseHasOnlySourceAudio(release)) {
      const consolidated = await this.consolidateAiDemucsDuplicate(release.id);
      if (consolidated) {
        release = await prisma.release.findUnique({
          where: { id: releaseId },
          select: {
            id: true,
            artistId: true,
            title: true,
            status: true,
            processingError: true,
            type: true,
            primaryArtist: true,
            featuredArtists: true,
            genre: true,
            moods: true,
            label: true,
            releaseDate: true,
            explicit: true,
            createdAt: true,
            rightsRoute: true,
            rightsFlags: true,
            rightsReason: true,
            rightsPolicyVersion: true,
            rightsSourceType: true,
            rightsEvaluatedAt: true,
            artworkMimeType: true,
            artist: {
              select: { id: true, displayName: true, userId: true }
            },
            artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
            tracks: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                title: true,
                artist: true,
                position: true,
                explicit: true,
                isrc: true,
                createdAt: true,
                processingStatus: true,
                processingError: true,
                contentStatus: true,
                // Remix lineage (#1196): keep parity with the primary select.
                generationMetadata: true,
                rightsRoute: true,
                rightsFlags: true,
                rightsReason: true,
                rightsPolicyVersion: true,
                rightsEvaluatedAt: true,
                stems: {
                  select: {
                    id: true,
                    type: true,
                    uri: true,
                    ipnftId: true,
                    durationSeconds: true,
                    isEncrypted: true,
                    encryptionMetadata: true,
                    storageProvider: true,
                  }
                }
              }
            }
          }
        });
        if (!release) {
          return null;
        }
      }
    }

    if (!options?.includeRestricted && !this.isPubliclyVisible(release.rightsRoute)) {
      return null;
    }

    // Remix releases (#1196) carry source attribution + AI provenance from the
    // published track's lineage metadata, surfaced as a focused summary. The
    // raw generationMetadata blob is read only to derive that summary and is
    // then stripped — it holds internal fields (generation cost, prompts,
    // seed) that must never reach this unauthenticated public read.
    const remix = this.deriveRemixProvenance(release);
    const { tracks, ...rest } = release;
    return {
      ...rest,
      tracks: tracks?.map(({ generationMetadata: _omit, ...track }) => track),
      remix,
    };
  }

  private deriveRemixProvenance(release: {
    type: string;
    tracks?: Array<{ generationMetadata?: unknown }>;
  }): RemixReleaseProvenance | null {
    if (release.type !== "remix") return null;
    const lineage = release.tracks
      ?.map((track) => track.generationMetadata)
      .find(
        (metadata): metadata is Record<string, unknown> =>
          !!metadata &&
          typeof metadata === "object" &&
          (metadata as { kind?: unknown }).kind === "remix_publish",
      );
    if (!lineage) return null;
    const str = (key: string): string | null => {
      const value = lineage[key];
      return typeof value === "string" && value ? value : null;
    };
    return {
      attribution:
        str("attribution") ??
        `Remix of "${str("sourceTrackTitle") ?? "a track"}"${
          str("sourceArtistName") ? ` by ${str("sourceArtistName")}` : ""
        }`,
      sourceTrackId: str("sourceTrackId"),
      sourceReleaseId: str("sourceReleaseId"),
      sourceTrackTitle: str("sourceTrackTitle"),
      sourceArtistName: str("sourceArtistName"),
      grounding: str("grounding"),
      aiGenerated: lineage.aiGenerated === true,
      remixProjectId: str("remixProjectId"),
    };
  }

  async getReleaseForUser(releaseId: string, userId: string) {
    const release = await this.getRelease(releaseId, { includeRestricted: true });
    if (!release) {
      return null;
    }

    return sameUserId(release.artist?.userId, userId) ? release : null;
  }

  async listByArtist(
    artistId: string,
    options?: { includeRestricted?: boolean; includeManagedCredits?: boolean },
  ) {
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { displayName: true },
    });

    if (!artist) {
      return [];
    }

    const andFilters: Prisma.ReleaseWhereInput[] = [];
    if (!options?.includeRestricted) {
      andFilters.push({ status: { in: ["ready", "published"] } });
      andFilters.push({
        OR: [
          { rightsRoute: null },
          { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
        ],
      });
    }
    const ownershipFilter: Prisma.ReleaseWhereInput = options?.includeManagedCredits
      ? { artistId }
      : {
          OR: [
            {
              artistCredits: {
                some: {
                  artistId,
                  role: { in: ["main", "primary"] },
                },
              },
            },
            {
              AND: [
                { artistId },
                {
                  OR: [
                    { primaryArtist: null },
                    { primaryArtist: "" },
                    { primaryArtist: { equals: artist.displayName, mode: "insensitive" as const } },
                  ],
                },
              ],
            },
          ],
        };

    return prisma.release.findMany({
      where: {
        ...ownershipFilter,
        ...(andFilters.length > 0 ? { AND: andFilters } : {}),
      },
      select: {
        id: true,
        artistId: true,
        artist: {
          select: { id: true, displayName: true, userId: true }
        },
        artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
        title: true,
        status: true,
        processingError: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        moods: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        rightsRoute: true,
        rightsFlags: true,
        rightsReason: true,
        rightsPolicyVersion: true,
        rightsSourceType: true,
        rightsEvaluatedAt: true,
        artworkMimeType: true,
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            position: true,
            explicit: true,
            processingStatus: true,
            processingError: true,
            contentStatus: true,
            rightsRoute: true,
            rightsFlags: true,
            rightsReason: true,
            rightsPolicyVersion: true,
            rightsEvaluatedAt: true,
            stems: {
              select: {
                id: true,
                type: true,
                uri: true,
                durationSeconds: true,
                isEncrypted: true,
                encryptionMetadata: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async listByUserId(userId: string) {
    const artist = await prisma.artist.findFirst({
      where: { userId: { equals: userId, mode: "insensitive" } },
    });
    if (!artist) return [];
    return this.listByArtist(artist.id, {
      includeRestricted: true,
      includeManagedCredits: true,
    });
  }

  async updateRelease(
    releaseId: string,
    input: Partial<{
      title: string;
      status: string;
    }>,
  ) {
    this.clearCache();
    return prisma.release.update({
      where: { id: releaseId },
      data: input,
      include: { tracks: true },
    });
  }

  async deleteRelease(releaseId: string, userId: string) {
    // 1. Verify release exists and ownership
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        artist: true,
        tracks: {
          include: { stems: { select: { id: true } } }
        }
      }
    });

    if (!release) {
      throw new NotFoundException("Release not found");
    }

    if (!sameUserId(release.artist?.userId, userId)) {
      throw new BadRequestException("Not authorized to delete this release");
    }

    // 2. Cascade delete: stems → tracks → release (no cascade in schema)
    const stemIds = release.tracks.flatMap(t => t.stems.map(s => s.id));
    const trackIds = release.tracks.map(t => t.id);
    const rightsUpgradeRequests = await prisma.releaseRightsUpgradeRequest.findMany({
      where: { releaseId },
      select: { id: true },
    });
    const rightsUpgradeRequestIds = rightsUpgradeRequests.map((request) => request.id);

    await prisma.$transaction(async (tx) => {
      if (rightsUpgradeRequestIds.length > 0) {
        const evidenceBundles = await tx.rightsEvidenceBundle.findMany({
          where: { rightsUpgradeRequestId: { in: rightsUpgradeRequestIds } },
          select: { id: true },
        });
        const evidenceBundleIds = evidenceBundles.map((bundle) => bundle.id);

        if (evidenceBundleIds.length > 0) {
          await tx.rightsEvidence.deleteMany({ where: { bundleId: { in: evidenceBundleIds } } });
          await tx.rightsEvidenceBundle.deleteMany({ where: { id: { in: evidenceBundleIds } } });
        }

        await tx.releaseRightsUpgradeRequest.deleteMany({
          where: { id: { in: rightsUpgradeRequestIds } },
        });
      }

      if (stemIds.length > 0) {
        // Delete marketplace dependents before the stems themselves.
        await this.deleteLegacyStemQualityRatings(tx, stemIds);

        const listings = await tx.stemListing.findMany({
          where: { stemId: { in: stemIds } },
          select: { id: true },
        });
        const listingIds = listings.map((listing) => listing.id);

        if (listingIds.length > 0) {
          await tx.stemPurchase.deleteMany({ where: { listingId: { in: listingIds } } });
        }

        await tx.stemListing.deleteMany({ where: { stemId: { in: stemIds } } });
        await tx.stemNftMint.deleteMany({ where: { stemId: { in: stemIds } } });
        await tx.stemPricing.deleteMany({ where: { stemId: { in: stemIds } } });
        await tx.stem.deleteMany({ where: { id: { in: stemIds } } });
      }

      if (trackIds.length > 0) {
        const libraryTracks = await tx.libraryTrack.findMany({
          where: {
            source: "remote",
            OR: [
              { id: { in: trackIds } },
              { catalogTrackId: { in: trackIds } },
            ],
          },
          select: { id: true },
        });
        const libraryTrackIds = libraryTracks.map((track) => track.id);
        const deletedTrackReferences = [...new Set([...trackIds, ...libraryTrackIds])];

        if (libraryTrackIds.length > 0) {
          await tx.libraryTrack.deleteMany({
            where: { id: { in: libraryTrackIds } },
          });
        }

        const playlists = await tx.playlist.findMany({
          where: { trackIds: { hasSome: deletedTrackReferences } },
          select: { id: true, trackIds: true },
        });
        for (const playlist of playlists) {
          await tx.playlist.update({
            where: { id: playlist.id },
            data: {
              trackIds: playlist.trackIds.filter((id) => !deletedTrackReferences.includes(id)),
            },
          });
        }

        // Delete any dependent content-protection or licensing records first
        await tx.dmcaReport.deleteMany({ where: { trackId: { in: trackIds } } });
        await tx.audioFingerprint.deleteMany({ where: { trackId: { in: trackIds } } });
        await tx.license.deleteMany({ where: { trackId: { in: trackIds } } });
        await tx.track.deleteMany({ where: { id: { in: trackIds } } });
      }

      await tx.release.delete({ where: { id: releaseId } });
    });

    this.clearCache();
    console.log(`[Catalog] Deleted release ${releaseId} with ${trackIds.length} tracks and ${stemIds.length} stems`);
    return { success: true };
  }

  async updateReleaseArtwork(releaseId: string, userId: string, artwork: { buffer: Buffer, mimetype: string }) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: { artist: true }
    });

    if (!release) throw new BadRequestException("Release not found");
    if (!sameUserId(release.artist?.userId, userId)) {
      throw new BadRequestException("Not authorized to update this release");
    }

    const updated = await prisma.release.update({
      where: { id: releaseId },
      data: {
        artworkData: artwork.buffer,
        artworkMimeType: artwork.mimetype
      },
      select: { id: true, artworkMimeType: true }
    });

    this.clearCache();
    return {
      success: true,
      id: updated.id,
      artworkUrl: `/catalog/releases/${releaseId}/artwork?t=${Date.now()}`
    };
  }

  async search(
    query: string,
    filters?: { stemType?: string; hasIpnft?: boolean; limit?: number }
  ) {
    const cacheKey = JSON.stringify({
      query,
      stemType: filters?.stemType ?? null,
      hasIpnft: filters?.hasIpnft ?? null,
      limit: filters?.limit ?? null,
    });
    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return { items: cached.items };
    }
    const cappedLimit = Math.min(Math.max(filters?.limit ?? 50, 1), 100);

    // Search releases by title OR tracks by title
    const items = await prisma.release.findMany({
      where: {
        AND: [
          {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { primaryArtist: { contains: query, mode: "insensitive" } },
              { featuredArtists: { contains: query, mode: "insensitive" } },
              { artistCredits: { some: { displayName: { contains: query, mode: "insensitive" } } } },
              { tracks: { some: { title: { contains: query, mode: "insensitive" } } } },
              { tracks: { some: { artist: { contains: query, mode: "insensitive" } } } }
            ],
          },
          {
            OR: [
              { rightsRoute: null },
              { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
            ],
          },
        ],
        status: "ready",
      },
      select: {
        id: true,
        artistId: true,
        title: true,
        status: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        moods: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        artworkMimeType: true,
        artist: {
          select: { id: true, displayName: true }
        },
        artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            position: true,
            explicit: true,
            stems: {
              select: {
                id: true,
                type: true,
                uri: true,
                durationSeconds: true,
                isEncrypted: true,
                encryptionMetadata: true,
              }
            }
          }
        }
      },
      take: cappedLimit,
    });

    this.searchCache.set(cacheKey, { items, cachedAt: Date.now() });
    return { items };
  }

  async searchMcpCatalog(
    query: string,
    limit = 10,
  ): Promise<{ items: McpCatalogSearchItem[] }> {
    const trimmedQuery = query.trim();
    const cappedLimit = Math.min(Math.max(limit, 1), 25);
    const now = new Date();

    const releases = await prisma.release.findMany({
      where: {
        status: { in: ["ready", "published"] },
        OR: [
          { rightsRoute: null },
          { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
        ],
        ...(trimmedQuery
          ? {
              AND: [
                {
                  OR: [
                    { title: { contains: trimmedQuery, mode: "insensitive" } },
                    {
                      primaryArtist: {
                        contains: trimmedQuery,
                        mode: "insensitive",
                      },
                    },
                    {
                      featuredArtists: {
                        contains: trimmedQuery,
                        mode: "insensitive",
                      },
                    },
                    {
                      artistCredits: {
                        some: {
                          displayName: {
                            contains: trimmedQuery,
                            mode: "insensitive",
                          },
                        },
                      },
                    },
                    {
                      genre: {
                        contains: trimmedQuery,
                        mode: "insensitive",
                      },
                    },
                    { moods: { has: trimmedQuery } },
                    {
                      tracks: {
                        some: {
                          title: {
                            contains: trimmedQuery,
                            mode: "insensitive",
                          },
                        },
                      },
                    },
                    {
                      tracks: {
                        some: {
                          artist: {
                            contains: trimmedQuery,
                            mode: "insensitive",
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        primaryArtist: true,
        genre: true,
        moods: true,
        releaseDate: true,
        artworkUrl: true,
        artworkMimeType: true,
        artist: {
          select: { displayName: true },
        },
        artistCredits: RELEASE_ARTIST_CREDITS_SELECT,
        tracks: {
          select: {
            id: true,
            stems: {
              select: {
                listings: {
                  where: {
                    status: "active",
                    amount: { gt: 0n },
                    expiresAt: { gt: now },
                  },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: cappedLimit,
    });

    return {
      items: releases.map((release) => ({
        id: release.id,
        title: release.title,
        artist: publicArtistCreditName(release),
        genre: release.genre,
        moods: release.moods,
        releaseDate: release.releaseDate?.toISOString() ?? null,
        artworkUrl: this.buildMcpArtworkUrl(release),
        trackCount: release.tracks.length,
        licensable: release.tracks.some((track) =>
          track.stems.some((stem) => stem.listings.length > 0),
        ),
        deeplink: this.buildMcpReleaseDeeplink(release.id),
      })),
    };
  }

  private buildMcpArtworkUrl(release: {
    id: string;
    artworkUrl: string | null;
    artworkMimeType: string | null;
  }): string | null {
    if (release.artworkUrl) {
      return this.toAbsoluteUrl(
        release.artworkUrl,
        process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`,
      );
    }

    if (!release.artworkMimeType) {
      return null;
    }

    return this.toAbsoluteUrl(
      `/catalog/releases/${encodeURIComponent(release.id)}/artwork`,
      process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`,
    );
  }

  private buildMcpReleaseDeeplink(releaseId: string): string {
    return this.toAbsoluteUrl(
      `/release/${encodeURIComponent(releaseId)}`,
      process.env.FRONTEND_URL || "http://localhost:3001",
    );
  }

  private toAbsoluteUrl(pathOrUrl: string, baseUrl: string): string {
    try {
      return new URL(pathOrUrl, baseUrl).toString();
    } catch {
      return pathOrUrl;
    }
  }

  async getReleaseArtwork(releaseId: string) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { artworkData: true, artworkMimeType: true, rightsRoute: true },
    });
    if (!release || !release.artworkData || !this.isPubliclyVisible(release.rightsRoute)) {
      return null;
    }
    return { data: release.artworkData, mimeType: release.artworkMimeType || "image/jpeg" };
  }

  async getReleaseArtworkForUser(releaseId: string, userId: string) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        artworkData: true,
        artworkMimeType: true,
        artist: {
          select: { userId: true },
        },
      },
    });

    if (!release || !release.artworkData || !sameUserId(release.artist?.userId, userId)) {
      return null;
    }

    return {
      data: release.artworkData,
      mimeType: release.artworkMimeType || "image/jpeg",
    };
  }

  async getTrackStreamForUser(
    releaseId: string,
    trackId: string,
    userId: string,
    options?: { range?: string },
  ) {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        releaseId: true,
        release: {
          select: {
            artist: {
              select: { userId: true },
            },
          },
        },
      },
    });

    if (
      !track ||
      track.releaseId !== releaseId ||
      !sameUserId(track.release.artist?.userId, userId)
    ) {
      return null;
    }

    return this.getTrackStream(trackId, { includeRestricted: true, range: options?.range });
  }

  async getTrackStream(trackId: string, options?: AudioRequestOptions) {
    // Find the track's stems, preferring unencrypted playable audio
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        rightsRoute: true,
        release: {
          select: {
            rightsRoute: true,
          },
        },
        stems: {
          select: { id: true, type: true, isEncrypted: true },
          orderBy: { type: 'asc' },
        },
      },
    });

    if (!track || track.stems.length === 0) return null;

    const effectiveRoute = this.getMostRestrictiveRoute(
      track.rightsRoute,
      track.release.rightsRoute,
    );
    if (!options?.includeRestricted && !this.isStreamingAllowed(effectiveRoute)) {
      return null;
    }

    // Priority: original → master → first unencrypted → first stem
    // Without this, alphabetical sort picks 'bass' (encrypted) before 'original'
    const preferredStem =
      track.stems.find(s => s.type === 'original') ||
      track.stems.find(s => s.type === 'master') ||
      track.stems.find(s => !s.isEncrypted) ||
      track.stems[0];

    return this.getStemBlob(preferredStem.id, options);
  }

  async getStemBlob(stemId: string, options?: AudioRequestOptions): Promise<AudioPayload | null> {
    // Try finding by exact ID first
    let stem = await prisma.stem.findUnique({
      where: { id: stemId },
      select: {
        id: true,
        data: true,
        mimeType: true,
        uri: true,
        storageProvider: true,
        track: {
          select: {
            rightsRoute: true,
            release: {
              select: {
                rightsRoute: true,
              },
            },
          },
        },
      },
    });

    // Fallback: if stemId looks like a filename (e.g. from a mockup URI), try searching by URI
    if (!stem) {
      stem = await prisma.stem.findFirst({
        where: { uri: { contains: stemId } },
        select: {
          id: true,
          data: true,
          mimeType: true,
          uri: true,
          storageProvider: true,
          track: {
            select: {
              rightsRoute: true,
              release: {
                select: {
                  rightsRoute: true,
                },
              },
            },
          },
        },
      });
    }

    if (!stem) return null;

    const effectiveRoute = this.getMostRestrictiveRoute(
      stem.track.rightsRoute,
      stem.track.release.rightsRoute,
    );
    if (!options?.includeRestricted && !this.isStreamingAllowed(effectiveRoute)) {
      return null;
    }

    // 1. Data is stored in DB
    if (stem.data) {
      return { data: stem.data, mimeType: stem.mimeType || "audio/mpeg" };
    }

    // 2. Local storage provider - try to read from disk
    if (stem.storageProvider === "local") {
      try {
        const { join } = await import("path");
        const { existsSync, readFileSync } = await import("fs");

        const filename = this.getLocalStemFilename(stem);
        const uploadDir = join(process.cwd(), "uploads", "stems");
        // DB-derived filename — containment (sweep from #1189 review).
        const { resolveContainedPath } = await import("../storage/path_containment");
        const absolutePath = resolveContainedPath(uploadDir, filename);

        if (absolutePath && existsSync(absolutePath)) {
          console.log(`[Catalog] Serving stem ${stem.id} from disk: ${absolutePath}`);
          return {
            data: readFileSync(absolutePath),
            mimeType: stem.mimeType || "audio/mpeg"
          };
        }
      } catch (err) {
        console.error(`[Catalog] Failed to read stem ${stem.id} from disk:`, err);
      }
    }

    // 3. Remote storage providers (GCS/IPFS/etc.) - prefer provider-aware download first.
    if (stem.uri && stem.storageProvider && stem.storageProvider !== "local") {
      if (options?.range) {
        try {
          const rangedData = await this.storageProvider.downloadRange(stem.uri, options.range);
          if (rangedData) {
            return {
              data: rangedData.data,
              mimeType: stem.mimeType || rangedData.mimeType || "audio/mpeg",
              range: {
                start: rangedData.start,
                end: rangedData.end,
                total: rangedData.total,
              },
            };
          }
        } catch (err) {
          console.error(`[Catalog] Failed to fetch range for stem ${stem.id} via storage provider:`, err);
        }
      }

      try {
        console.log(`[Catalog] Fetching stem ${stem.id} via storage provider: ${stem.uri}`);
        const fetchedData = await this.storageProvider.download(stem.uri);
        if (fetchedData) {
          return { data: fetchedData, mimeType: stem.mimeType || "audio/mpeg" };
        }
      } catch (err) {
        console.error(`[Catalog] Failed to fetch stem ${stem.id} via storage provider:`, err);
      }
    }

    // 4. Generic HTTP URI fallback
    if (stem.uri && stem.uri.startsWith("http")) {
      try {
        console.log(`[Catalog] Fetching stem ${stem.id} from HTTP URI: ${stem.uri}`);
        const response = await fetch(stem.uri, {
          signal: AbortSignal.timeout(120000), // 2 minutes for large files
        });
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          return { data: buffer, mimeType: stem.mimeType || "audio/mpeg" };
        }
      } catch (err) {
        console.error(`[Catalog] Failed to fetch stem ${stem.id} from HTTP:`, err);
      }
    }

    return null;
  }

  async getStemPreview(stemId: string, _options?: { range?: string }) {
    const stem = await prisma.stem.findUnique({
      where: { id: stemId },
      select: {
        uri: true,
        encryptionMetadata: true,
        data: true,
        mimeType: true,
        track: {
          select: {
            rightsRoute: true,
            release: {
              select: {
                rightsRoute: true,
              },
            },
          },
        },
      },
    });

    if (!stem) throw new NotFoundException("Stem not found");
    if (
      !this.isStreamingAllowed(
        this.getMostRestrictiveRoute(
          stem.track.rightsRoute,
          stem.track.release.rightsRoute,
        ),
      )
    ) {
      throw new NotFoundException("Stem not found");
    }

    if (!stem.uri && !stem.data) throw new BadRequestException("Stem has no source URI or data");

    // Handle encrypted content from IPFS/Lighthouse
    // We prioritize this over stem.data because stem.data might contain the encrypted blob
    if (stem.encryptionMetadata) {
      // Use internal service credential (SBPR-004) for backend-initiated decryption.
      // The AES provider's verifyAccess() recognizes the sentinel zero-address + internalKey
      // combo and grants access without requiring a user wallet signature.
      const internalAuthSig = {
        address: "0x0000000000000000000000000000000000000000",
        sig: "preview-authorized",
        signedMessage: "Marketplace preview authorization",
        internalKey: process.env.INTERNAL_SERVICE_KEY,
      };

      const decryptedBuffer = await this.encryptionService.decrypt(
        stem.uri!,
        stem.encryptionMetadata,
        [], // No specific access conditions for public preview if we want to bypass Lit checks on backend
        internalAuthSig,
      );

      return { data: decryptedBuffer, mimeType: stem.mimeType || "audio/mpeg" };
    }

    if (stem.data) {
      return { data: stem.data, mimeType: stem.mimeType || "audio/mpeg" };
    }

    // Unencrypted external content
    const buffer = await this.fetchStemSourceBuffer(stem.uri!);

    return { data: buffer, mimeType: stem.mimeType || "audio/mpeg" };
  }

  private clearCache() {
    this.searchCache.clear();
  }

  private parseRightsRoute(value?: string | null): UploadRightsRoute | null {
    if (!value) {
      return null;
    }

    return value as UploadRightsRoute;
  }

  private getMostRestrictiveRoute(...routes: Array<string | null | undefined>): UploadRightsRoute | null {
    let strictestRoute: UploadRightsRoute | null = null;

    for (const rawRoute of routes) {
      const route = this.parseRightsRoute(rawRoute);
      if (!route) {
        continue;
      }
      if (!strictestRoute || compareRouteSeverity(route, strictestRoute) > 0) {
        strictestRoute = route;
      }
    }

    return strictestRoute;
  }

  private isPubliclyVisible(route?: string | null): boolean {
    const parsedRoute = this.parseRightsRoute(route);
    if (!parsedRoute) {
      return true;
    }

    return getUploadRightsActions(parsedRoute).publicVisible;
  }

  private isStreamingAllowed(route?: string | null): boolean {
    const parsedRoute = this.parseRightsRoute(route);
    if (!parsedRoute) {
      return true;
    }

    return getUploadRightsActions(parsedRoute).streamingAllowed;
  }
}
