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
      console.log(`[Catalog] Received stems.uploaded for track ${event.trackId} (artist: ${event.artistId})`);
      this.clearCache();
      try {
        await prisma.track.upsert({
          where: { id: event.trackId },
          update: {
            artistId: event.artistId,
            status: "processing",
          },
          create: {
            id: event.trackId,
            artistId: event.artistId,
            title: event.metadata?.releaseTitle || (event.metadata as any)?.title || "Untitled Track",
            status: "processing",
            releaseType: event.metadata?.releaseType || "single",
            releaseTitle: event.metadata?.releaseTitle,
            primaryArtist: event.metadata?.primaryArtist,
            featuredArtists: event.metadata?.featuredArtists?.join(", "),
            genre: event.metadata?.genre,
            isrc: event.metadata?.isrc,
            label: event.metadata?.label,
            releaseDate: event.metadata?.releaseDate
              ? new Date(event.metadata.releaseDate)
              : undefined,
            explicit: event.metadata?.explicit ?? false,
          } as any,
        });
        console.log(`[Catalog] Created/Updated track ${event.trackId}`);
      } catch (err) {
        console.error(`[Catalog] Failed to create/update track ${event.trackId}:`, err);
      }
    });

    this.eventBus.subscribe("stems.processed", async (event: StemsProcessedEvent) => {
      console.log(`[Catalog] Received stems.processed for track ${event.trackId}`);
      this.clearCache();

      // Retry logic for track existence (race condition fix)
      let track = await prisma.track.findUnique({ where: { id: event.trackId } });
      if (!track) {
        console.warn(`[Catalog] Track ${event.trackId} not found yet. Retrying in 1s...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        track = await prisma.track.findUnique({ where: { id: event.trackId } });
      }

      if (!track) {
        console.error(`[Catalog] Track ${event.trackId} still not found. Dropping stems.`);
        return;
      }

      if (event.stems?.length) {
        await prisma.stem.createMany({
          data: event.stems.map((stem) => ({
            id: stem.id,
            trackId: event.trackId,
            type: stem.type,
            uri: stem.uri,
          })),
          skipDuplicates: true,
        });
      }
      await prisma.track
        .update({
          where: { id: event.trackId },
          data: { status: "ready" },
        })
        .then(() => console.log(`[Catalog] Track ${event.trackId} updated to ready`))
        .catch((err) => console.error(`[Catalog] Failed to update track status ${event.trackId}:`, err));
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
    return prisma.track.findMany({
      where: { status: "ready" },
      include: { stems: true, artist: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async createTrack(input: {
    userId: string;
    title: string;
    releaseType?: string;
    releaseTitle?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
    isrc?: string;
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
  }) {
    const artist = await prisma.artist.findUnique({
      where: { userId: input.userId },
    });

    if (!artist) {
      throw new BadRequestException("User is not a registered artist");
    }

    this.clearCache();
    return prisma.track.create({
      data: {
        artistId: artist.id,
        title: input.title,
        status: "draft",
        releaseType: input.releaseType ?? "single",
        releaseTitle: input.releaseTitle,
        primaryArtist: input.primaryArtist,
        featuredArtists: input.featuredArtists?.join(", "),
        genre: input.genre,
        isrc: input.isrc,
        label: input.label,
        releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
        explicit: input.explicit ?? false,
      } as any,
      include: { stems: true },
    });
  }

  async getTrack(trackId: string) {
    return prisma.track.findUnique({
      where: { id: trackId },
      include: { stems: true },
    });
  }

  async listByArtist(artistId: string) {
    return prisma.track.findMany({
      where: { artistId },
      include: { stems: true },
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

  async updateTrack(
    trackId: string,
    input: Partial<{
      title: string;
      status: string;
    }>,
  ) {
    this.clearCache();
    return prisma.track.update({
      where: { id: trackId },
      data: input,
      include: { stems: true },
    });
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
    const stemsWhere =
      filters?.hasIpnft === undefined && !filters?.stemType
        ? undefined
        : {
          ...(filters?.hasIpnft === true
            ? {
              some: {
                ...(filters?.stemType ? { type: filters.stemType } : {}),
                ipnftId: { not: null },
              },
            }
            : {}),
          ...(filters?.hasIpnft === false ? { every: { ipnftId: null } } : {}),
          ...(filters?.hasIpnft !== true && filters?.stemType
            ? { some: { type: filters.stemType } }
            : {}),
        };
    const items = await prisma.track.findMany({
      where: {
        title: { contains: query, mode: "insensitive" },
        stems: stemsWhere,
      },
      include: { stems: true },
      take: cappedLimit,
    });
    this.searchCache.set(cacheKey, { items, cachedAt: Date.now() });
    return { items };
  }

  private clearCache() {
    this.searchCache.clear();
  }
}
