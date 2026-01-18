import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import {
  IpNftMintedEvent,
  StemsProcessedEvent,
  StemsUploadedEvent,
} from "../../events/event_types";

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    this.eventBus.subscribe("stems.uploaded", (event: StemsUploadedEvent) => {
      prisma.track
        .create({
          data: {
            id: event.trackId,
            artistId: event.artistId,
            title: event.metadata?.releaseTitle ?? "Untitled Track",
            status: "processing",
            releaseType: event.metadata?.releaseType ?? "single",
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
          },
        })
        .catch(() => null);
    });

    this.eventBus.subscribe("stems.processed", async (event: StemsProcessedEvent) => {
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
        .catch(() => null);
    });

    this.eventBus.subscribe("ipnft.minted", async (event: IpNftMintedEvent) => {
      await prisma.stem
        .update({
          where: { id: event.stemId },
          data: { ipnftId: event.tokenId },
        })
        .catch(() => null);
    });
  }
  async createTrack(input: {
    artistId: string;
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
    return prisma.track.create({
      data: {
        artistId: input.artistId,
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
      },
      include: { stems: true },
    });
  }

  async getTrack(trackId: string) {
    return prisma.track.findUnique({
      where: { id: trackId },
      include: { stems: true },
    });
  }

  async updateTrack(
    trackId: string,
    input: Partial<{
      title: string;
      status: string;
    }>,
  ) {
    return prisma.track.update({
      where: { id: trackId },
      data: input,
      include: { stems: true },
    });
  }

  async search(query: string, filters?: { stemType?: string; hasIpnft?: boolean }) {
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
      take: 50,
    });
    return { items };
  }
}
