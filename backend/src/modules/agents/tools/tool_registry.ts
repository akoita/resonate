import { Injectable, Optional } from "@nestjs/common";
import { prisma } from "../../../db/prisma";
import { calculatePrice, PricingInput } from "../../../pricing/pricing";
import { EmbeddingService } from "../../embeddings/embedding.service";
import { EmbeddingStore } from "../../embeddings/embedding.store";
import {
  AI_PROMOTIONAL_ELIGIBILITY_WHERE,
  toAiDisclosureRecord,
} from "../../catalog/ai-disclosure.policy";
import { AgentObservabilityService } from "../agent_observability.service";

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
    private readonly embeddingStore: EmbeddingStore,
    @Optional()
    private readonly observability?: AgentObservabilityService
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
            // catalog.search is the AI DJ candidate source. Fully generated
            // tracks remain available through direct catalog APIs, but are
            // excluded from this promotional/agent-ranking seam (ADR-BM-5).
            ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
            ...(query
              ? {
                OR: [
                  { release: { genre: { contains: query, mode: "insensitive" } } },
                  { title: { contains: query, mode: "insensitive" } },
                ],
              }
              : {}),
          },
          include: {
            release: { select: { title: true, genre: true, artworkUrl: true } },
            stems: {
              where: { isCurrent: true },
              select: {
                listings: {
                  where: {
                    status: "active",
                    amount: { gt: 0n },
                    expiresAt: { gt: new Date() },
                  },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take,
        });

        // Annotate and sort: listed tracks first
        const annotated = items.map((t) => {
          const hasListing = (t.stems ?? []).some((s) => s.listings.length > 0);
          const {
            stems,
            generationMetadata: _generationMetadata,
            aiDisclosureLevel: _aiDisclosureLevel,
            aiContributionFacets: _aiContributionFacets,
            aiDisclosureSource: _aiDisclosureSource,
            aiDisclosureVersion: _aiDisclosureVersion,
            aiDeclaredAt: _aiDeclaredAt,
            ...rest
          } = t;
          return {
            ...rest,
            aiDisclosure: toAiDisclosureRecord(t),
            hasListing,
          };
        });
        annotated.sort((a, b) => (a.hasListing === b.hasListing ? 0 : a.hasListing ? -1 : 1));

        return { items: annotated };
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
          if (await this.embeddingStore.get(trackId)) {
            continue;
          }
          const track = await prisma.track.findUnique({
            where: { id: trackId },
            include: { release: true }
          });
          const text = `${track?.title ?? ""} ${track?.release?.genre ?? ""}`.trim();
          if (text) {
            await this.embeddingStore.upsert(trackId, this.embeddingService.embed(text));
          }
        }
        return {
          ranked: await this.embeddingStore.similarity(queryVector, candidateIds),
        };
      },
    });
  }

  register(tool: Tool) {
    this.tools.set(tool.name, {
      name: tool.name,
      run: async (input) => {
        const startedAt = new Date();
        try {
          const output = await tool.run(input);
          await this.observability?.traceToolCall({
            toolName: tool.name,
            input,
            output,
            startedAt,
            endedAt: new Date(),
          });
          return output;
        } catch (error) {
          await this.observability?.traceToolCall({
            toolName: tool.name,
            input,
            error,
            startedAt,
            endedAt: new Date(),
          });
          throw error;
        }
      },
    });
  }

  get(name: string) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }
}
