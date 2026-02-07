import { Injectable } from "@nestjs/common";
import { prisma } from "../../../db/prisma";
import { calculatePrice, PricingInput } from "../../../pricing/pricing";
import { EmbeddingService } from "../../embeddings/embedding.service";
import { EmbeddingStore } from "../../embeddings/embedding.store";

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  run(input: ToolInput): Promise<ToolOutput>;
}

@Injectable()
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingStore: EmbeddingStore
  ) {
    this.register({
      name: "catalog.search",
      run: async (input) => {
        const query = String(input.query ?? "");
        const limit = Number(input.limit ?? 20);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const take = Math.min(Math.max(limit, 1), 50);

        // Search by genre on the release, OR by title
        const whereBase = explicitAllowed ? {} : { explicit: false };
        let items = await prisma.track.findMany({
          where: {
            ...whereBase,
            ...(query
              ? {
                OR: [
                  { release: { genre: { contains: query, mode: "insensitive" } } },
                  { title: { contains: query, mode: "insensitive" } },
                ],
              }
              : {}),
          },
          include: { release: { select: { title: true, genre: true, artworkUrl: true } } },
          orderBy: { createdAt: "desc" },
          take,
        });

        // Fallback: if no genre/title match, return the most recent tracks
        if (items.length === 0 && query) {
          items = await prisma.track.findMany({
            where: whereBase,
            include: { release: { select: { title: true, genre: true, artworkUrl: true } } },
            orderBy: { createdAt: "desc" },
            take,
          });
        }

        return { items };
      },
    });

    this.register({
      name: "pricing.quote",
      run: async (input) => {
        const licenseType = (input.licenseType as any) ?? "personal";
        const base: PricingInput = {
          basePlayPriceUsd: 0.02,
          remixSurchargeMultiplier: 3,
          commercialMultiplier: 5,
          volumeDiscountPercent: 5,
          floorUsd: 0.01,
          ceilingUsd: 1,
        };
        const priceUsd = calculatePrice(licenseType, base, Boolean(input.volume));
        return { priceUsd };
      },
    });

    this.register({
      name: "analytics.signal",
      run: async (input) => {
        return {
          trackId: input.trackId,
          plays: 0,
          score: 0,
        };
      },
    });

    this.register({
      name: "embeddings.similarity",
      run: async (input) => {
        const query = String(input.query ?? "");
        const candidateIds = (input.candidates as string[]) ?? [];
        const queryVector = this.embeddingService.embed(query);
        for (const trackId of candidateIds) {
          if (this.embeddingStore.get(trackId)) {
            continue;
          }
          const track = await prisma.track.findUnique({
            where: { id: trackId },
            include: { release: true }
          });
          const text = `${track?.title ?? ""} ${track?.release?.genre ?? ""}`.trim();
          if (text) {
            this.embeddingStore.upsert(trackId, this.embeddingService.embed(text));
          }
        }
        return {
          ranked: this.embeddingStore.similarity(queryVector, candidateIds),
        };
      },
    });
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }
}
