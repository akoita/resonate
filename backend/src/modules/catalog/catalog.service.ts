import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import {
  IpNftMintedEvent,
  StemsProcessedEvent,
  StemsUploadedEvent,
} from "../../events/event_types";

@Injectable()
export class CatalogService implements OnModuleInit {
  private searchCache = new Map<
    string,
    { items: unknown[]; cachedAt: number }
  >();
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly eventBus: EventBus) { }

  onModuleInit() {
    this.eventBus.subscribe("stems.uploaded", async (event: StemsUploadedEvent) => {
      console.log(`[Catalog] Received stems.uploaded for release ${event.releaseId} (artist: ${event.artistId})`);
      this.clearCache();
      try {
        await prisma.release.upsert({
          where: { id: event.releaseId },
          update: {
            artistId: event.artistId,
            status: "processing",
            artworkData: event.artworkData,
            artworkMimeType: event.artworkMimeType,
            title: event.metadata?.title ?? undefined,
            type: event.metadata?.type ?? undefined,
            primaryArtist: event.metadata?.primaryArtist ?? undefined,
            featuredArtists: event.metadata?.featuredArtists?.join(", ") ?? undefined,
            genre: event.metadata?.genre ?? undefined,
            label: event.metadata?.label ?? undefined,
            releaseDate: event.metadata?.releaseDate ? new Date(event.metadata.releaseDate) : undefined,
            explicit: event.metadata?.explicit ?? undefined,
          },
          create: {
            id: event.releaseId,
            artistId: event.artistId,
            title: event.metadata?.title || "Untitled Release",
            status: "processing",
            type: event.metadata?.type || "single",
            primaryArtist: event.metadata?.primaryArtist,
            featuredArtists: event.metadata?.featuredArtists?.join(", "),
            genre: event.metadata?.genre,
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
              })),
            },
          },
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
              },
              update: {
                title: trackData.title,
                artist: trackData.artist,
                position: trackData.position,
              },
            });

            for (const stem of trackData.stems) {
              console.log(`[Catalog] Upserting stem ${stem.id} for track ${trackData.id}. Data length: ${stem.data?.length ?? "NULL"} bytes`);
              await prisma.stem.upsert({
                where: { id: stem.id },
                create: {
                  id: stem.id,
                  trackId: trackData.id,
                  type: stem.type,
                  uri: stem.uri,
                  data: stem.data,
                  mimeType: stem.mimeType,
                  durationSeconds: stem.durationSeconds,
                },
                update: {
                  type: stem.type,
                  uri: stem.uri,
                  data: stem.data,
                  mimeType: stem.mimeType,
                  durationSeconds: stem.durationSeconds,
                },
              });
            }
          }
        }

        await prisma.release.update({
          where: { id: event.releaseId },
          data: { status: "ready" },
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
        console.error(`[Catalog] Failed to finalise release ${event.releaseId}:`, err);
      }
    });

    this.eventBus.subscribe("ipnft.minted", async (event: IpNftMintedEvent) => {
      this.clearCache();
      await prisma.stem
        .update({
          where: { id: event.stemId },
          data: { ipnftId: event.tokenId },
        })
        .catch(() => null);
    });
  }

  async listPublished(limit = 20) {
    return prisma.release.findMany({
      where: { status: "ready" },
      select: {
        id: true,
        artistId: true,
        title: true,
        status: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        artworkMimeType: true, // Useful for frontend to know, but DATA must be excluded
        artist: {
          select: { id: true, displayName: true, userId: true, payoutAddress: true }
        },
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
            stems: {
              select: {
                id: true,
                type: true,
                uri: true,
                ipnftId: true,
                checksum: true,
                durationSeconds: true,
                // Exclude data and mimeType (huge blobs)
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async createRelease(input: {
    userId: string;
    title: string;
    type?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
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

    this.clearCache();
    return prisma.release.create({
      data: {
        artistId: artist.id,
        title: input.title,
        status: "draft",
        type: input.type ?? "single",
        primaryArtist: input.primaryArtist,
        featuredArtists: input.featuredArtists?.join(", "),
        genre: input.genre,
        label: input.label,
        releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
        explicit: input.explicit ?? false,
        tracks: {
          create: input.tracks?.map(t => ({
            title: t.title,
            position: t.position,
            explicit: t.explicit ?? false,
          }))
        }
      },
      // Return lightweight object
      select: {
        id: true,
        title: true,
        status: true,
        tracks: {
          select: { id: true, title: true, position: true }
        }
      }
    });
  }

  async getTrack(trackId: string) {
    return prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        releaseId: true,
        title: true,
        position: true,
        explicit: true,
        isrc: true,
        createdAt: true,
        stems: {
          select: {
            id: true,
            type: true,
            uri: true,
            ipnftId: true,
            durationSeconds: true,
            // Exclude data
          }
        },
        release: {
          select: {
            id: true,
            title: true,
            primaryArtist: true,
            artworkMimeType: true,
            artist: { select: { id: true, displayName: true, userId: true } }
          }
        }
      }
    });
  }

  async getRelease(releaseId: string) {
    return prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        artistId: true,
        title: true,
        status: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        artworkMimeType: true,
        artist: {
          select: { id: true, displayName: true, userId: true }
        },
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
            stems: {
              select: {
                id: true,
                type: true,
                uri: true,
                ipnftId: true,
                durationSeconds: true,
                // Exclude data
              }
            }
          }
        }
      }
    });
  }

  async listByArtist(artistId: string) {
    return prisma.release.findMany({
      where: { artistId },
      select: {
        id: true,
        artistId: true,
        artist: {
          select: { id: true, displayName: true, userId: true }
        },
        title: true,
        status: true,
        type: true,
        primaryArtist: true,
        featuredArtists: true,
        genre: true,
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        artworkMimeType: true,
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            position: true,
            explicit: true,
            stems: {
              select: { id: true, type: true, uri: true, durationSeconds: true }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async listByUserId(userId: string) {
    const artist = await prisma.artist.findUnique({
      where: { userId },
    });
    if (!artist) return [];
    return this.listByArtist(artist.id);
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

  async updateReleaseArtwork(releaseId: string, userId: string, artwork: { buffer: Buffer, mimetype: string }) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: { artist: true }
    });

    if (!release) throw new BadRequestException("Release not found");
    if (release.artist?.userId !== userId) {
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
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { primaryArtist: { contains: query, mode: "insensitive" } },
          { featuredArtists: { contains: query, mode: "insensitive" } },
          { tracks: { some: { title: { contains: query, mode: "insensitive" } } } },
          { tracks: { some: { artist: { contains: query, mode: "insensitive" } } } }
        ],
        status: "ready"
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
        label: true,
        releaseDate: true,
        explicit: true,
        createdAt: true,
        artworkMimeType: true,
        artist: {
          select: { id: true, displayName: true }
        },
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            position: true,
            explicit: true,
            stems: {
              select: { id: true, type: true, uri: true, durationSeconds: true }
            }
          }
        }
      },
      take: cappedLimit,
    });

    this.searchCache.set(cacheKey, { items, cachedAt: Date.now() });
    return { items };
  }

  async getReleaseArtwork(releaseId: string) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { artworkData: true, artworkMimeType: true },
    });
    if (!release || !release.artworkData) return null;
    return { data: release.artworkData, mimeType: release.artworkMimeType || "image/jpeg" };
  }

  async getStemBlob(stemId: string) {
    const stem = await prisma.stem.findUnique({
      where: { id: stemId },
      select: { data: true, mimeType: true },
    });
    if (!stem || !stem.data) return null;
    return { data: stem.data, mimeType: stem.mimeType || "audio/mpeg" };
  }

  private clearCache() {
    this.searchCache.clear();
  }
}
