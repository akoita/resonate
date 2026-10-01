import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Subscription } from "rxjs";
import { prisma } from "../../db/prisma";
import {
  CatalogReleaseReadyEvent,
  CatalogUpdatedEvent,
} from "../../events/event_types";
import { AI_PROMOTIONAL_ELIGIBILITY_WHERE } from "../catalog/ai-disclosure.policy";
import { PUBLIC_RELEASE_ROUTES } from "../catalog/catalog-public.constants";
import { EventBus } from "../shared/event_bus";
import { VERTEX_EMBEDDING_BATCH_SIZE } from "./embedding.config";
import { EmbeddingService } from "./embedding.service";
import { EmbeddingStore } from "./embedding.store";
import {
  trackEmbeddingContentHash,
  trackEmbeddingText,
} from "./track_embedding_text";

/**
 * Tracks that may carry an embedding: the publicly listable set (release
 * ready/published with a public-or-unassigned rights route, track not
 * quarantined or removed). Mirrors the catalog/Home public predicate.
 */
export const TRACK_EMBEDDABLE_WHERE: Prisma.TrackWhereInput = {
  contentStatus: "clean",
  OR: [{ rightsRoute: null }, { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } }],
  release: {
    status: { in: ["ready", "published"] },
    OR: [
      { rightsRoute: null },
      { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
    ],
  },
};

const EMBED_TRACKS_MAX_IDS = 200;
export const BACKFILL_DEFAULT_LIMIT = 50;
export const BACKFILL_MAX_LIMIT = 200;
const SIMILAR_DEFAULT_LIMIT = 10;
const SIMILAR_MAX_LIMIT = 50;
/** Neighbours fetched per requested result, to survive post-filtering. */
const SIMILAR_OVERFETCH = 4;
const FALLBACK_POOL = 100;

const trackEmbeddingSelect = {
  id: true,
  title: true,
  artist: true,
  release: {
    select: {
      title: true,
      genre: true,
      moods: true,
      primaryArtist: true,
      featuredArtists: true,
      artist: { select: { displayName: true } },
      artistCredits: {
        select: { role: true, displayName: true },
        orderBy: { sortOrder: "asc" as const },
      },
    },
  },
} satisfies Prisma.TrackSelect;

export interface EmbedTracksResult {
  /** Model the vectors were stored under; `null` when embeddings are off. */
  model: string | null;
  /** Vectors written by this call (model calls were made for these). */
  embedded: number;
  /** Already current (hash match) or not publicly listable. */
  skipped: number;
  /** Embedding or storage failed; retry later. */
  failed: number;
}

export interface EmbeddingBackfillRequest {
  /** Tracks processed per run; 1-200, default 50. Re-run until remaining=0. */
  limit?: number;
}

export interface EmbeddingBackfillResult extends EmbedTracksResult {
  scanned: number;
  /** Publicly listable tracks still lacking a current-model vector. */
  remaining: number;
  status: "ok" | "provider_disabled";
}

export interface SimilarTrack {
  trackId: string;
  score: number;
}

export interface SimilarTracksResult {
  /**
   * `embedding`: nearest neighbours of the seed's stored vector.
   * `metadata_fallback`: deterministic same-genre / same-artist, newest first
   * (used when the seed has no current-model vector or no neighbour qualified).
   * Scores are only comparable within one source.
   */
  source: "embedding" | "metadata_fallback";
  model: string | null;
  results: SimilarTrack[];
}

export interface SimilarTracksOptions {
  /** 1-50, default 10. */
  limit?: number;
  allowExplicit?: boolean;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Track embedding lifecycle (#1452, WS-5): embed-on-ingest, bounded backfill
 * and similar-tracks. Embedding calls are metered, so they only happen in
 * `embedTracks` (ingest events, the admin backfill, lazy candidate embedding in
 * the DJ tool). `similarTracks` reads stored vectors only and never calls the
 * model, so it keeps working when the provider is down.
 */
@Injectable()
export class TrackEmbeddingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackEmbeddingService.name);
  private subscriptions: Subscription[] = [];

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingStore: EmbeddingStore,
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  // ---------------------------------------------------------------------------
  // Embed on ingest
  // ---------------------------------------------------------------------------

  onModuleInit() {
    if (!this.eventBus) return;
    this.subscriptions.push(
      this.eventBus.subscribe<CatalogReleaseReadyEvent>(
        "catalog.release_ready",
        (event) => {
          void this.embedRelease(event.releaseId).catch((error) =>
            this.logEmbedFailure(`release ${event.releaseId}`, error),
          );
        },
      ),
      this.eventBus.subscribe<CatalogUpdatedEvent>("catalog.updated", (event) => {
        if (!event.trackId) return;
        void this.embedTracks([event.trackId]).catch((error) =>
          this.logEmbedFailure(`track ${event.trackId}`, error),
        );
      }),
    );
  }

  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions = [];
  }

  private logEmbedFailure(subject: string, error: unknown) {
    this.logger.warn(
      `Embed-on-ingest failed for ${subject}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  async embedRelease(releaseId: string): Promise<EmbedTracksResult> {
    const tracks = await prisma.track.findMany({
      where: { releaseId },
      select: { id: true },
    });
    return this.embedTracks(tracks.map((track) => track.id));
  }

  // ---------------------------------------------------------------------------
  // Embedding
  // ---------------------------------------------------------------------------

  /**
   * Embed the given tracks (publicly listable ones only), skipping those whose
   * stored vector already matches the current model and metadata hash.
   * Never throws on provider failure: failed tracks are counted and retried by
   * a later call or backfill. At most 200 ids are processed per call.
   */
  async embedTracks(
    trackIds: string[],
    options: { touchUnchanged?: boolean } = {},
  ): Promise<EmbedTracksResult> {
    const model = this.embeddingService.modelId;
    const ids = [...new Set(trackIds.filter(Boolean))].slice(0, EMBED_TRACKS_MAX_IDS);
    if (!model || ids.length === 0) {
      return { model, embedded: 0, skipped: 0, failed: 0 };
    }

    const tracks = await prisma.track.findMany({
      where: { AND: [{ id: { in: ids } }, TRACK_EMBEDDABLE_WHERE] },
      select: trackEmbeddingSelect,
    });
    let skipped = ids.length - tracks.length;

    const states = await this.embeddingStore.getContentStates(
      tracks.map((track) => track.id),
    );
    const pending: Array<{ trackId: string; text: string; contentHash: string }> = [];
    const unchanged: string[] = [];
    for (const track of tracks) {
      const text = trackEmbeddingText(track);
      const contentHash = trackEmbeddingContentHash(text, model);
      const state = states.get(track.id);
      if (state && state.model === model && state.contentHash === contentHash) {
        unchanged.push(track.id);
      } else {
        pending.push({ trackId: track.id, text, contentHash });
      }
    }
    skipped += unchanged.length;
    if (options.touchUnchanged) {
      await this.embeddingStore.touch(unchanged);
    }

    let embedded = 0;
    let failed = 0;
    for (let i = 0; i < pending.length; i += VERTEX_EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(i, i + VERTEX_EMBEDDING_BATCH_SIZE);
      const vectors = await this.embeddingService.embedDocuments(
        batch.map((item) => item.text),
      );
      if (!vectors || vectors.length !== batch.length) {
        failed += batch.length;
        continue;
      }
      for (let j = 0; j < batch.length; j += 1) {
        try {
          await this.embeddingStore.upsert(
            batch[j].trackId,
            vectors[j],
            model,
            batch[j].contentHash,
          );
          embedded += 1;
        } catch (error) {
          failed += 1;
          this.logEmbedFailure(`track ${batch[j].trackId}`, error);
        }
      }
    }
    return { model, embedded, skipped, failed };
  }

  // ---------------------------------------------------------------------------
  // Backfill
  // ---------------------------------------------------------------------------

  private missingWhere(model: string | null): Prisma.TrackWhereInput {
    return {
      AND: [
        TRACK_EMBEDDABLE_WHERE,
        {
          OR: [
            { embedding: { is: null } },
            ...(model ? [{ embedding: { is: { model: { not: model } } } }] : []),
          ],
        },
      ],
    };
  }

  /**
   * Bounded backfill, oldest first: tracks with no vector for the current model
   * come first; leftover capacity re-verifies the least recently verified
   * vectors against their metadata hash (re-embedding only on change, and
   * touching `updatedAt` so the next run rotates to other rows). Idempotent:
   * re-run until `remaining` is 0. A run embeds at most `limit` tracks.
   */
  async backfill(
    request: EmbeddingBackfillRequest = {},
  ): Promise<EmbeddingBackfillResult> {
    const limit = clampInt(
      request.limit,
      1,
      BACKFILL_MAX_LIMIT,
      BACKFILL_DEFAULT_LIMIT,
    );
    const model = this.embeddingService.modelId;
    if (!model) {
      return {
        status: "provider_disabled",
        model: null,
        scanned: 0,
        embedded: 0,
        skipped: 0,
        failed: 0,
        remaining: await prisma.track.count({ where: this.missingWhere(null) }),
      };
    }

    const missing = await prisma.track.findMany({
      where: this.missingWhere(model),
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    const ids = missing.map((track) => track.id);

    if (ids.length < limit) {
      const stale = await prisma.trackEmbedding.findMany({
        where: { model, track: TRACK_EMBEDDABLE_WHERE },
        select: { trackId: true },
        orderBy: [{ updatedAt: "asc" }, { trackId: "asc" }],
        take: limit - ids.length,
      });
      ids.push(...stale.map((row) => row.trackId));
    }

    const result = await this.embedTracks(ids, { touchUnchanged: true });
    return {
      ...result,
      status: "ok",
      scanned: ids.length,
      remaining: await prisma.track.count({ where: this.missingWhere(model) }),
    };
  }

  // ---------------------------------------------------------------------------
  // Similar tracks
  // ---------------------------------------------------------------------------

  /**
   * Tracks similar to `seedTrackId`, usable as a ranking candidate source. Uses
   * stored vectors only (no model call, works with the provider down) and no
   * play data, so a track nobody has played yet is reachable. Falls back to a
   * deterministic metadata match when the seed has no current-model vector.
   */
  async similarTracks(
    seedTrackId: string,
    options: SimilarTracksOptions = {},
  ): Promise<SimilarTracksResult> {
    const limit = clampInt(options.limit, 1, SIMILAR_MAX_LIMIT, SIMILAR_DEFAULT_LIMIT);
    const model = this.embeddingService.modelId;

    const results = await this.embeddingNeighbours(seedTrackId, options);
    if (model && results.length > 0) {
      return { source: "embedding", model, results };
    }
    return {
      source: "metadata_fallback",
      model,
      results: await this.metadataFallback(seedTrackId, limit, options.allowExplicit ?? false),
    };
  }

  /** True when a provider is configured, so stored vectors can be compared. */
  isEnabled(): boolean {
    return this.embeddingService.isEnabled();
  }

  /**
   * Nearest neighbours of the seed's stored current-model vector, and nothing
   * else: no metadata fallback and no model call. Empty when the provider is
   * disabled, the seed has no vector, or no neighbour is publicly listable.
   * Home uses this so that "embeddings off" leaves its results unchanged.
   */
  async embeddingNeighbours(
    seedTrackId: string,
    options: SimilarTracksOptions = {},
  ): Promise<SimilarTrack[]> {
    const model = this.embeddingService.modelId;
    if (!model) return [];
    const seedVector = await this.embeddingStore.get(seedTrackId, model);
    if (!seedVector) return [];
    return this.neighboursOfVector(seedVector, {
      ...options,
      excludeTrackIds: [seedTrackId],
    });
  }

  /**
   * Publicly listable tracks nearest to an arbitrary query vector (a written
   * taste note, for instance), same model scope, eligibility and ordering as
   * `similarTracks`. The caller supplies a vector made by the current model;
   * nothing here embeds text.
   */
  async neighboursOfVector(
    vector: number[],
    options: SimilarTracksOptions & { excludeTrackIds?: string[] } = {},
  ): Promise<SimilarTrack[]> {
    const limit = clampInt(options.limit, 1, SIMILAR_MAX_LIMIT, SIMILAR_DEFAULT_LIMIT);
    const model = this.embeddingService.modelId;
    if (!model) return [];
    const neighbours = await this.embeddingStore.nearest(vector, {
      model,
      limit: limit * SIMILAR_OVERFETCH,
      excludeTrackIds: options.excludeTrackIds,
    });
    return this.filterEligible(neighbours, limit, options.allowExplicit ?? false);
  }

  private eligibleWhere(allowExplicit: boolean): Prisma.TrackWhereInput {
    return {
      AND: [
        TRACK_EMBEDDABLE_WHERE,
        // ADR-BM-5: fully AI-generated tracks stay out of promotional seams.
        AI_PROMOTIONAL_ELIGIBILITY_WHERE,
        ...(allowExplicit ? [] : [{ explicit: false }]),
      ],
    };
  }

  /** Drop neighbours that are no longer publicly listable; keep cosine order. */
  private async filterEligible(
    neighbours: SimilarTrack[],
    limit: number,
    allowExplicit: boolean,
  ): Promise<SimilarTrack[]> {
    if (neighbours.length === 0) return [];
    const eligible = await prisma.track.findMany({
      where: {
        AND: [
          { id: { in: neighbours.map((n) => n.trackId) } },
          this.eligibleWhere(allowExplicit),
        ],
      },
      select: { id: true },
    });
    const eligibleIds = new Set(eligible.map((track) => track.id));
    return neighbours
      .filter((neighbour) => eligibleIds.has(neighbour.trackId))
      .slice(0, limit);
  }

  /**
   * Same release genre first, then same artist, newest first; seed excluded.
   * Score is 0.5 for a genre match plus 0.25 for the same artist.
   */
  private async metadataFallback(
    seedTrackId: string,
    limit: number,
    allowExplicit: boolean,
  ): Promise<SimilarTrack[]> {
    const seed = await prisma.track.findUnique({
      where: { id: seedTrackId },
      select: { release: { select: { genre: true, artistId: true } } },
    });
    if (!seed) return [];
    const genre = seed.release.genre?.trim() || null;
    const artistId = seed.release.artistId;

    const pool = await prisma.track.findMany({
      where: {
        AND: [
          { id: { not: seedTrackId } },
          this.eligibleWhere(allowExplicit),
          {
            OR: [
              ...(genre
                ? [{ release: { genre: { equals: genre, mode: "insensitive" as const } } }]
                : []),
              { release: { artistId } },
            ],
          },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        release: { select: { genre: true, artistId: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: FALLBACK_POOL,
    });

    return pool
      .map((track) => {
        const sameGenre =
          !!genre && track.release.genre?.trim().toLowerCase() === genre.toLowerCase();
        const sameArtist = track.release.artistId === artistId;
        return {
          trackId: track.id,
          createdAt: track.createdAt.getTime(),
          score: (sameGenre ? 0.5 : 0) + (sameArtist ? 0.25 : 0),
          sameGenre,
        };
      })
      // Genre matches first, then artist-only; newest first within each (the
      // pool is already newest-first and Array#sort is stable).
      .sort((a, b) => Number(b.sameGenre) - Number(a.sameGenre))
      .slice(0, limit)
      .map(({ trackId, score }) => ({ trackId, score }));
  }
}
