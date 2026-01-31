import { Injectable, OnModuleInit } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { StemsUploadedEvent, StemsProcessedEvent, ResonateEvent } from "../../events/event_types";

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(private eventBus: EventBus) { }

  onModuleInit() {
    this.eventBus.subscribe("stems.uploaded", async (event: StemsUploadedEvent) => {
      console.log(`[Catalog] Received stems.uploaded for release ${event.releaseId}`);
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
        console.error(`[Catalog] Failed to process stems for release ${event.releaseId}:`, err);
      }
    });

    this.eventBus.subscribe("catalog.release_ready", async (event: any) => {
      console.log(`[Catalog] Release ${event.releaseId} is ready for consumption`);
    });
  }

  async getReleases(options?: { artistId?: string; search?: string }) {
    return prisma.release.findMany({
      where: {
        artistId: options?.artistId,
        status: "ready",
        OR: options?.search ? [
          { title: { contains: options.search, mode: "insensitive" } },
          { primaryArtist: { contains: options.search, mode: "insensitive" } },
        ] : undefined,
      },
      include: {
        artist: true,
        tracks: {
          include: {
            stems: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getRelease(id: string) {
    return prisma.release.findUnique({
      where: { id },
      include: {
        artist: true,
        tracks: {
          include: {
            stems: true,
          },
        },
      },
    });
  }

  async createRelease(input: { userId: string; title: string }) {
    const artist = await prisma.artist.findUnique({
      where: { userId: input.userId },
    });

    if (!artist) {
      throw new Error("Artist profile not found for user");
    }

    return prisma.release.create({
      data: {
        title: input.title,
        artistId: artist.id,
        status: "draft",
      },
      include: {
        tracks: true,
      }
    });
  }

  async search(query: string) {
    const items = await prisma.release.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { primaryArtist: { contains: query, mode: "insensitive" } },
          { genre: { contains: query, mode: "insensitive" } },
        ],
        status: "ready",
      },
      include: {
        artist: true,
      },
      take: 20,
    });

    return {
      items,
      total: items.length,
    };
  }

  private clearCache() {
    // In a real app, this would clear Redis or similar
    console.log("[Catalog] Cache cleared");
  }
}
