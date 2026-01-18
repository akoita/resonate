import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    this.eventBus.subscribe("stems.uploaded", (event) => {
      prisma.track.create({
        data: {
          id: event.trackId,
          artistId: event.artistId,
          title: "Untitled Track",
          status: "processing",
        },
      }).catch(() => null);
    });
  }
  async createTrack(input: { artistId: string; title: string }) {
    return prisma.track.create({
      data: {
        artistId: input.artistId,
        title: input.title,
        status: "draft",
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
