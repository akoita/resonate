import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { calculatePrice, PricingInput } from "../../../pricing/pricing";
import { EmbeddingService } from "../../embeddings/embedding.service";
import { EmbeddingStore } from "../../embeddings/embedding.store";
import { TrackEmbeddingService, TRACK_EMBEDDABLE_WHERE } from "../../embeddings/track_embedding.service";
import { unitCentroid } from "../../embeddings/vector_centroid";
import { sanitizeArtistNames, normalizeArtistName } from "../agent_session_artists";
import {
  AI_PROMOTIONAL_ELIGIBILITY_WHERE,
  toAiDisclosureRecord,
} from "../../catalog/ai-disclosure.policy";
import { AgentObservabilityService } from "../agent_observability.service";
import { getAgentSemanticMinSimilarity } from "../agent_runtime.config";
import {
  expandGenreSearchTerms,
  genreFamiliesFor,
} from "../../recommendations/genre_families";

/** Upper bound on candidates lazily embedded / ranked per tool call. */
const EMBEDDINGS_SIMILARITY_MAX_CANDIDATES = 100;

/** Artist seeds (#2241): own tracks read per artist, tracks whose vectors form the centroid, cache. */
const ARTIST_SEED_OWN_TRACKS = 8;
const ARTIST_SEED_CENTROID_TRACKS = 8;
const ARTIST_SEED_CACHE_TTL_MS = 5 * 60_000;
const ARTIST_SEED_CACHE_MAX = 100;

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
    private readonly observability?: AgentObservabilityService,
    @Optional()
    trackEmbeddings?: TrackEmbeddingService,
  ) {
    const trackEmbeddingService =
      trackEmbeddings ??
      new TrackEmbeddingService(this.embeddingService, this.embeddingStore);
    this.register({
      name: "catalog.search",
      run: async (input) => {
        const query = String(input.query ?? "").trim();
        const limit = Number(input.limit ?? 20);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const take = Math.min(Math.max(limit, 1), 50);

        // Genre labels are free text, so a genre query also searches the
        // labels of its genre family ("World" reaches "African", #2088). The
        // title match stays literal. It also matches the stored track
        // descriptor's families (#2240), so "World" reaches a track whose
        // genre says "Bambara" but whose descriptor says world/african. This
        // only READS the stored descriptor: no model call on this path.
        const descriptorFamilyIds = query
          ? genreFamiliesFor(query).map((family) => family.id)
          : [];
        const items = await this.loadCandidateTracks({
          explicitAllowed,
          take,
          extraWhere: query
            ? {
              OR: [
                ...expandGenreSearchTerms(query).map((term) => ({
                  release: { genre: { contains: term, mode: "insensitive" as const } },
                })),
                ...(descriptorFamilyIds.length > 0
                  ? [{ descriptor: { is: { families: { hasSome: descriptorFamilyIds } } } }]
                  : []),
                { title: { contains: query, mode: "insensitive" as const } },
              ],
            }
            : {},
        });

        return { items };
      },
    });

    this.register({
      name: "catalog.semantic_search",
      run: async (input) => {
        const query = String(input.query ?? "").trim();
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
          : undefined;
        // "More like this" (#2243): a seed track stands in for the query text,
        // using its stored vector. No model call; the seed itself is excluded.
        const seedTrackId =
          typeof input.seedTrackId === "string" ? input.seedTrackId.trim() : "";
        // Provider disabled or failing: report it and let the caller keep its
        // keyword candidates. Never throws.
        if ((!query && !seedTrackId) || !this.embeddingService.modelId) {
          return { items: [], status: "unavailable" };
        }
        const vector = seedTrackId
          ? await this.embeddingStore.get(seedTrackId, this.embeddingService.modelId)
          : await this.embeddingService.embedQuery(query);
        if (!vector) {
          return { items: [], status: "unavailable" };
        }
        const neighbours = await trackEmbeddingService.neighboursOfVector(vector, {
          limit,
          allowExplicit: explicitAllowed,
          excludeTrackIds: seedTrackId
            ? [...(excludeTrackIds ?? []), seedTrackId]
            : excludeTrackIds,
        });
        const floor = getAgentSemanticMinSimilarity();
        const kept = neighbours.filter((neighbour) => neighbour.score >= floor);
        if (kept.length === 0) {
          return { items: [], status: "ok" };
        }
        const rows = await this.loadCandidateTracks({
          explicitAllowed,
          take: kept.length,
          extraWhere: { id: { in: kept.map((neighbour) => neighbour.trackId) } },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const items = kept.flatMap((neighbour) => {
          const row = byId.get(neighbour.trackId);
          return row ? [{ ...row, semanticScore: neighbour.score }] : [];
        });
        return { items, status: "ok" };
      },
    });

    // Artist seeds (#2241): the named artists' own tracks, plus the catalog
    // neighbours of the centroid of their stored track vectors. Names are
    // matched exactly (case-insensitive) against CREDITED names, so only a real
    // catalog artist can ever seed anything. Bounded by `limit`; the centroid
    // needs stored vectors only (no embedding call), so it is skipped quietly
    // when embeddings are off.
    const artistCentroids = new Map<string, { vector: number[]; at: number }>();
    this.register({
      name: "catalog.artist_seed",
      run: async (input) => {
        const names = sanitizeArtistNames(input.artists);
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string")
          : [];
        if (names.length === 0) return { items: [], status: "ok" };

        const items: Array<Record<string, unknown>> = [];
        const seen = new Set<string>(excludeTrackIds);
        const centroidModel = this.embeddingService.modelId;
        const neighbourScores = new Map<string, { score: number; artist: string }>();

        for (const name of names) {
          const own = await this.loadCandidateTracks({
            explicitAllowed,
            take: ARTIST_SEED_OWN_TRACKS,
            extraWhere: {
              AND: [
                TRACK_EMBEDDABLE_WHERE,
                { id: { notIn: excludeTrackIds } },
                {
                  OR: [
                    { artist: { equals: name, mode: "insensitive" } },
                    { release: { primaryArtist: { equals: name, mode: "insensitive" } } },
                    {
                      release: {
                        AND: [
                          { OR: [{ primaryArtist: null }, { primaryArtist: "" }] },
                          { artist: { displayName: { equals: name, mode: "insensitive" } } },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          });
          for (const row of own) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            items.push({ ...row, artistSeed: "own", seedArtist: name });
          }

          if (!centroidModel) continue;
          const cacheKey = `${centroidModel}\0${normalizeArtistName(name)}`;
          let centroid = artistCentroids.get(cacheKey);
          if (!centroid || Date.now() - centroid.at > ARTIST_SEED_CACHE_TTL_MS) {
            const vectors = await this.embeddingStore.getMany(
              own.slice(0, ARTIST_SEED_CENTROID_TRACKS).map((row) => row.id),
              centroidModel,
            );
            const vector = unitCentroid(vectors);
            centroid = vector ? { vector, at: Date.now() } : undefined;
            if (centroid) {
              artistCentroids.delete(cacheKey);
              artistCentroids.set(cacheKey, centroid);
              if (artistCentroids.size > ARTIST_SEED_CACHE_MAX) {
                artistCentroids.delete(artistCentroids.keys().next().value as string);
              }
            }
          }
          if (!centroid) continue;
          const neighbours = await trackEmbeddingService.neighboursOfVector(centroid.vector, {
            limit: Math.ceil(limit / names.length),
            allowExplicit: explicitAllowed,
            excludeTrackIds: [...excludeTrackIds, ...own.map((row) => row.id)],
          });
          const floor = getAgentSemanticMinSimilarity();
          for (const neighbour of neighbours) {
            if (neighbour.score < floor || seen.has(neighbour.trackId)) continue;
            const previous = neighbourScores.get(neighbour.trackId);
            if (!previous || neighbour.score > previous.score) {
              neighbourScores.set(neighbour.trackId, { score: neighbour.score, artist: name });
            }
          }
        }

        if (neighbourScores.size > 0) {
          const rows = await this.loadCandidateTracks({
            explicitAllowed,
            take: neighbourScores.size,
            extraWhere: { id: { in: [...neighbourScores.keys()] } },
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          const ordered = [...neighbourScores.entries()].sort((a, b) => b[1].score - a[1].score);
          for (const [trackId, { score, artist }] of ordered) {
            const row = byId.get(trackId);
            if (row) items.push({ ...row, artistSeed: "neighbour", seedArtist: artist, semanticScore: score });
          }
        }
        // Own tracks come first, so the cap never drops an artist's own catalog for neighbours.
        return { items: items.slice(0, limit), status: "ok" };
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
        const candidateIds = ((input.candidates as string[]) ?? []).slice(
          0,
          EMBEDDINGS_SIMILARITY_MAX_CANDIDATES,
        );
        // Provider disabled or failing: an empty ranking tells the selector to
        // keep its deterministic order (#1452). Never throws.
        const model = this.embeddingService.modelId;
        if (!model) {
          return { ranked: [], status: "unavailable" };
        }
        const queryVector = await this.embeddingService.embedQuery(query);
        if (!queryVector) {
          return { ranked: [], status: "unavailable" };
        }
        // Lazily embed candidates that have no current vector (idempotent:
        // unchanged tracks are skipped without a model call).
        await trackEmbeddingService.embedTracks(candidateIds);
        return {
          ranked: await this.embeddingStore.similarity(
            queryVector,
            candidateIds,
            model,
          ),
          status: "ok",
        };
      },
    });
  }

  /**
   * Shared candidate loader for the AI DJ catalog tools: explicit filter, AI
   * promotional eligibility (ADR-BM-5), and the annotated result shape.
   * `hasListing` is data for the caller's own filter; it never orders, boosts
   * or demotes results (ADR-TE-2 rule 6), so the default order stays
   * newest-first exactly as queried.
   */
  private async loadCandidateTracks(options: {
    explicitAllowed: boolean;
    take: number;
    extraWhere: Prisma.TrackWhereInput;
    orderBy?: Prisma.TrackOrderByWithRelationInput;
  }) {
    const whereBase = options.explicitAllowed ? {} : { explicit: false };
    const items = await prisma.track.findMany({
      where: {
        ...whereBase,
        // Fully generated tracks remain available through direct catalog APIs,
        // but are excluded from this promotional/agent-ranking seam (ADR-BM-5).
        ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
        ...options.extraWhere,
      },
      include: {
        // `artistId` and `moods` feed the shared discovery policy stage
        // (exploration + diversity) and intent matching in the selector;
        // `primaryArtist` and the uploader label let it resolve the credited
        // artist the diversity cap keys on.
        release: {
          select: {
            title: true,
            genre: true,
            moods: true,
            artistId: true,
            artworkUrl: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
          },
        },
        // #2240: stored descriptor (families, sub-genres, bands); data for the
        // ranker, read-only here.
        descriptor: {
          select: {
            families: true,
            subGenres: true,
            tempoBand: true,
            energyBand: true,
            vocal: true,
          },
        },
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
      orderBy: options.orderBy ?? { createdAt: "desc" },
      take: options.take,
    });

    return items.map((t) => {
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
