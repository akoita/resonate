import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    this.eventBus.subscribe("stems.uploaded", (event) => {
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

  async search(query: string) {
    const items = await prisma.track.findMany({
      where: { title: { contains: query, mode: "insensitive" } },
      include: { stems: true },
      take: 50,
    });
    return { items };
  }
}
