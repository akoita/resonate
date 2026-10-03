import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { RedisCacheService } from "../shared/redis_cache.service";
import {
  resolveCreditedArtistIds,
  resolveCreditedArtistName,
} from "../shared/artist_attribution";
import {
  AI_PROMOTIONAL_ELIGIBILITY_WHERE,
  toAiDisclosureRecord,
} from "./ai-disclosure.policy";
import {
  PopularityWindow,
  POPULARITY_WINDOWS,
  audienceActorId,
  audienceMeetsThreshold,
  discoveryPopularityConfigFromEnv,
  eventHasTrustedPopularityMetadata,
  popularityCacheGeneration,
  rotatePopularityCacheGeneration,
  scorePopularitySignals,
  DISCOVERY_POPULARITY_CACHE_TTL_SECONDS,
} from "./discovery-popularity.math";

export type { PopularityWindow } from "./discovery-popularity.math";

/**
 * True Trending & Top Artists serving (#1451 WS-4), on the #1450 WS-3
 * serving-table contract.
 *
 * The serving tables (`TrackPopularity`, `ArtistEngagement`) are the stable
 * interface: endpoints and the Home rails read ONLY them (Redis-fronted,
 * fail-open). Today they are filled by `refresh()` — a bounded local
 * aggregation over the Postgres `AnalyticsEvent` facts (completion-weighted
 * plays + saves, time-decayed, per-genre) — and WS-3's warehouse mart export
 * later replaces the FILLER without touching the interface.
 *
 * Honesty rules (RFC §7):
 *   - rows below the minimum-audience threshold (`DISCOVERY_MIN_AUDIENCE`
 *     unique listeners, default 3) are never written, so a chart position is
 *     only claimed when the data supports it;
 *   - when nothing meets the threshold the endpoints return an empty list and
 *     the UI shows an explicit low-data state — recency is NEVER a fallback.
 *
 * Aggregates are engagement analytics, not payout inputs (ADR-BM-4).
 */

interface TrackAccumulator {
  trackId: string;
  signals: Array<{
    kind: "play" | "save" | "purchase";
    occurredAt: Date;
    completionRatio?: number | null;
    purchaseId?: string | null;
  }>;
  listeners: Set<string>;
}

@Injectable()
export class DiscoveryPopularityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryPopularityService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Optional() private readonly redisCache?: RedisCacheService) {}

  onModuleInit() {
    const config = discoveryPopularityConfigFromEnv();
    const interval = config.refreshIntervalMs;
    if (config.source === "warehouse") {
      this.logger.log("Warehouse popularity source selected; local filler refresh is disabled");
      return;
    }
    if (!interval || process.env.NODE_ENV === "test") {
      return;
    }
    void this.refreshAll().catch((error) =>
      this.logger.warn(`Initial popularity refresh failed: ${error?.message}`),
    );
    this.timer = setInterval(() => {
      void this.refreshAll().catch((error) =>
        this.logger.warn(`Popularity refresh failed: ${error?.message}`),
      );
    }, interval);
    this.timer.unref?.();
  }

  async refreshAll() {
    if (discoveryPopularityConfigFromEnv().source !== "local") return;
    for (const window of Object.keys(POPULARITY_WINDOWS) as PopularityWindow[]) {
      await this.refresh(window);
    }
  }

  /**
   * Bounded aggregation over local facts for one window:
   *   score(track) = Σ decay·(completionRatio-weighted play) + 2·decay·save
   * with linear time-decay from now to the window edge; unique listeners from
   * distinct actor ids; genre from the track's release. Artist engagement is
   * the per-artist rollup of its tracks (listeners unioned, not summed).
   */
  async refresh(window: PopularityWindow) {
    if (discoveryPopularityConfigFromEnv().source !== "local") {
      throw new Error("The local popularity filler is disabled when DISCOVERY_POPULARITY_SOURCE=warehouse");
    }
    const hours = POPULARITY_WINDOWS[window];
    const now = new Date();
    const since = new Date(now.getTime() - hours * 3_600_000);
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventName: {
          in: [
            "playback.completed",
            "library.saved",
            "playlist.track_added",
            "commerce.settled",
            "payment.settled",
            "x402.purchase",
            "agent.purchase_completed",
          ],
        },
        occurredAt: { gte: since, lte: now },
      },
      select: {
        eventName: true,
        occurredAt: true,
        actorId: true,
        privacyTier: true,
        consentBasis: true,
        payload: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 50_001,
    });
    if (events.length > 50_000) {
      throw new Error("Local popularity event snapshot exceeded its 50000-event limit");
    }

    const byTrack = new Map<string, TrackAccumulator>();
    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | null;
      if (!eventHasTrustedPopularityMetadata({
        eventName: event.eventName,
        privacyTier: event.privacyTier,
        actorId: event.actorId,
        consentBasis: event.consentBasis,
        payload,
      })) continue;
      if (
        event.eventName === "payment.settled" &&
        String(payload?.status ?? "").toLowerCase() !== "settled"
      ) continue;

      const trackId =
        typeof payload?.trackId === "string" ? payload.trackId : null;
      if (!trackId) continue;
      const actorId = audienceActorId(event.actorId);
      if (!actorId) continue;
      const acc =
        byTrack.get(trackId) ??
        ({
          trackId,
          signals: [],
          listeners: new Set<string>(),
        } satisfies TrackAccumulator);
      if (event.eventName === "playback.completed") {
        const completionRatio = Number(payload?.completionRatio);
        if (!Number.isFinite(completionRatio) || completionRatio < 0 || completionRatio > 1.5) continue;
        acc.signals.push({ kind: "play", occurredAt: event.occurredAt, completionRatio });
      } else if (event.eventName === "library.saved" || event.eventName === "playlist.track_added") {
        acc.signals.push({ kind: "save", occurredAt: event.occurredAt });
      } else {
        const purchaseId = firstNonEmptyString(
          payload?.paymentId,
          payload?.txHash,
          payload?.transactionHash,
          payload?.receiptId,
        );
        if (!purchaseId) continue;
        acc.signals.push({ kind: "purchase", occurredAt: event.occurredAt, purchaseId });
      }
      acc.listeners.add(actorId);
      byTrack.set(trackId, acc);
    }

    const threshold = discoveryPopularityConfigFromEnv().minimumAudience;
    const qualifying = [...byTrack.values()].filter(
      (acc) => audienceMeetsThreshold(acc.listeners, threshold),
    );

    // Resolve genre and credited artist IDs for qualifying tracks in one query.
    const tracks = qualifying.length
      ? await prisma.track.findMany({
          where: {
            id: { in: qualifying.map((acc) => acc.trackId) },
            // Popularity is a human-artist promotional surface. Engagement on
            // fully AI-generated tracks must not create trending or top-artist
            // rows, while direct catalog and marketplace access remain open.
            ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
          },
          select: {
            id: true,
            artist: true,
            release: {
              select: {
                genre: true,
                artistId: true,
                primaryArtist: true,
                artist: { select: { id: true, displayName: true } },
                artistCredits: {
                  orderBy: { sortOrder: "asc" },
                  select: {
                    artistId: true,
                    displayName: true,
                    role: true,
                    identityStatus: true,
                  },
                },
              },
            },
          },
        })
      : [];
    const trackMeta = new Map(tracks.map((track) => [track.id, track]));

    interface ArtistAccumulator {
      artistId: string;
      score: number;
      plays: number;
      saves: number;
      purchases: number;
      listeners: Set<string>;
      genres: Map<string, { score: number; plays: number; saves: number; purchases: number; listeners: Set<string> }>;
    }
    const byArtist = new Map<string, ArtistAccumulator>();

    const trackRows: {
      trackId: string;
      window: string;
      genre: string;
      score: number;
      plays: number;
      uniqueListeners: number;
      saves: number;
      purchases: number;
    }[] = [];

    for (const acc of qualifying) {
      const meta = trackMeta.get(acc.trackId);
      if (!meta) continue;
      const contribution = scorePopularitySignals(acc.signals, window, now);
      const genre = meta.release.genre ?? "";
      const row = {
        trackId: acc.trackId,
        window,
        score: contribution.score,
        plays: contribution.plays,
        uniqueListeners: acc.listeners.size,
        saves: contribution.saves,
        purchases: contribution.purchases,
      };
      trackRows.push({ ...row, genre: "" });
      if (genre) trackRows.push({ ...row, genre });

      const creditedArtistIds = resolveCreditedArtistIds({
        trackArtist: meta.artist,
        credits: meta.release.artistCredits,
        primaryArtist: meta.release.primaryArtist,
        accountDisplayName: meta.release.artist?.displayName,
      });
      for (const artistId of creditedArtistIds) {
        const artist =
          byArtist.get(artistId) ??
          ({
            artistId,
            score: 0,
            plays: 0,
            saves: 0,
            purchases: 0,
            listeners: new Set<string>(),
            genres: new Map(),
          } satisfies ArtistAccumulator);
        artist.score += contribution.score;
        artist.plays += contribution.plays;
        artist.saves += contribution.saves;
        artist.purchases += contribution.purchases;
        for (const listener of acc.listeners) artist.listeners.add(listener);
        if (genre) {
          const g =
            artist.genres.get(genre) ??
            { score: 0, plays: 0, saves: 0, purchases: 0, listeners: new Set<string>() };
          g.score += contribution.score;
          g.plays += contribution.plays;
          g.saves += contribution.saves;
          g.purchases += contribution.purchases;
          for (const listener of acc.listeners) g.listeners.add(listener);
          artist.genres.set(genre, g);
        }
        byArtist.set(artistId, artist);
      }
    }

    // ArtistEngagement.artistId is the stable credited Artist.id. The #1450
    // warehouse filler must preserve this serving-table contract.
    const artistRows: {
      artistId: string;
      window: string;
      genre: string;
      score: number;
      plays: number;
      uniqueListeners: number;
      saves: number;
      purchases: number;
    }[] = [];
    for (const artist of byArtist.values()) {
      if (artist.listeners.size >= threshold) {
        artistRows.push({
          artistId: artist.artistId,
          window,
          genre: "",
          score: artist.score,
          plays: artist.plays,
          uniqueListeners: artist.listeners.size,
          saves: artist.saves,
          purchases: artist.purchases,
        });
      }
      for (const [genre, g] of artist.genres) {
        if (g.listeners.size >= threshold) {
          artistRows.push({
            artistId: artist.artistId,
            window,
            genre,
            score: g.score,
            plays: g.plays,
            uniqueListeners: g.listeners.size,
            saves: g.saves,
            purchases: g.purchases,
          });
        }
      }
    }

    // Replace the window snapshot atomically.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(1450, 1) IS NULL AS locked`;
      await tx.trackPopularity.deleteMany({ where: { window } });
      if (trackRows.length) await tx.trackPopularity.createMany({ data: trackRows });
      await tx.artistEngagement.deleteMany({ where: { window } });
      if (artistRows.length) await tx.artistEngagement.createMany({ data: artistRows });
    }, { maxWait: 10_000, timeout: 120_000 });
    await rotatePopularityCacheGeneration(this.redisCache);
    this.logger.log(
      `Popularity refresh (${window}): ${trackRows.length} track rows, ${artistRows.length} artist rows (threshold ${threshold})`,
    );
  }

  private cacheKey(
    kind: string,
    window: string,
    genre: string,
    limit: number,
    minimumAudience: number,
    snapshotMaxAgeMinutes: number,
    generation: string,
  ) {
    return `discovery:${kind}:${window}:${genre || "all"}:${limit}:${minimumAudience}:${snapshotMaxAgeMinutes}:${generation}`;
  }

  /** Engagement-ranked trending tracks; empty = below-threshold everywhere. */
  async getTrendingTracks(options: {
    window?: PopularityWindow;
    genre?: string;
    limit?: number;
  }) {
    const window: PopularityWindow = options.window ?? "7d";
    const genre = options.genre?.trim() ?? "";
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const config = discoveryPopularityConfigFromEnv();
    const minimumAudience = config.minimumAudience;
    const snapshotMaxAgeMinutes = config.snapshotMaxAgeMinutes;
    return this.readGenerationSnapshot(
      "trending",
      window,
      genre,
      limit,
      minimumAudience,
      snapshotMaxAgeMinutes,
      async () => {
        const now = new Date();
        const freshSince = new Date(now.getTime() - snapshotMaxAgeMinutes * 60_000);
        const rows = await prisma.trackPopularity.findMany({
          where: {
            window,
            genre,
            uniqueListeners: { gte: minimumAudience },
            computedAt: { gte: freshSince, lte: now },
          },
          orderBy: { score: "desc" },
          take: limit,
        });
        const tracks = rows.length
          ? await prisma.track.findMany({
              where: {
                id: { in: rows.map((row) => row.trackId) },
                // Also protect reads from stale serving rows during rollout.
                ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
              },
              include: {
                release: {
                  select: {
                    id: true,
                    title: true,
                    genre: true,
                    artworkUrl: true,
                    artworkMimeType: true,
                    artworkRevision: true,
                    artistId: true,
                    primaryArtist: true,
                    artist: { select: { id: true, displayName: true } },
                  },
                },
              },
            })
          : [];
        const trackById = new Map(tracks.map((track) => [track.id, track]));
        return {
          window,
          genre: genre || null,
          minimumAudience,
          computedAt: oldestSnapshotTimestamp(rows.map((row) => row.computedAt)),
          items: rows
            .flatMap((row) => {
              const track = trackById.get(row.trackId);
              if (!track) return [];
              return [{
                trackId: row.trackId,
                title: track.title,
                // Credited artist (#1492), not the uploader/manager account label.
                artist: resolveCreditedArtistName({
                  trackArtist: track.artist,
                  primaryArtist: track.release.primaryArtist,
                  accountDisplayName: track.release.artist?.displayName,
                }),
                artistId: track.release.artistId,
                releaseId: track.release.id,
                releaseTitle: track.release.title,
                genre: track.release.genre,
                artworkUrl: track.release.artworkUrl,
                artworkMimeType: track.release.artworkMimeType,
                artworkRevision: track.release.artworkRevision,
                aiDisclosure: toAiDisclosureRecord(track),
                score: row.score,
                plays: row.plays,
                uniqueListeners: row.uniqueListeners,
                saves: row.saves,
              }];
            })
            .map((item, index) => ({ rank: index + 1, ...item })),
        };
      },
    );
  }

  /** Engagement-ranked artists; per-genre when `genre` is set. */
  async getTopArtists(options: {
    window?: PopularityWindow;
    genre?: string;
    limit?: number;
  }) {
    const window: PopularityWindow = options.window ?? "7d";
    const genre = options.genre?.trim() ?? "";
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
    const config = discoveryPopularityConfigFromEnv();
    const minimumAudience = config.minimumAudience;
    const snapshotMaxAgeMinutes = config.snapshotMaxAgeMinutes;
    return this.readGenerationSnapshot(
      "top-artists-v2",
      window,
      genre,
      limit,
      minimumAudience,
      snapshotMaxAgeMinutes,
      async () => {
        const now = new Date();
        const freshSince = new Date(now.getTime() - snapshotMaxAgeMinutes * 60_000);
        const rows = await prisma.artistEngagement.findMany({
          where: {
            window,
            genre,
            uniqueListeners: { gte: minimumAudience },
            computedAt: { gte: freshSince, lte: now },
          },
          orderBy: { score: "desc" },
          take: limit,
        });
        const profiles = rows.length
          ? await prisma.artist.findMany({
              where: { id: { in: rows.map((row) => row.artistId) } },
              select: { id: true, displayName: true, imageUrl: true },
            })
          : [];
        const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
        return {
          window,
          genre: genre || null,
          minimumAudience,
          computedAt: oldestSnapshotTimestamp(rows.map((row) => row.computedAt)),
          items: rows.flatMap((row) => {
            const profile = profilesById.get(row.artistId);
            if (!profile) return [];
            return [{
              name: profile.displayName,
              artistId: profile.id,
              imageUrl: profile.imageUrl,
              score: row.score,
              plays: row.plays,
              uniqueListeners: row.uniqueListeners,
              saves: row.saves,
            }];
          }).map((item, index) => ({ rank: index + 1, ...item })),
        };
      },
    );
  }

  private async readGenerationSnapshot<T>(
    kind: string,
    window: PopularityWindow,
    genre: string,
    limit: number,
    minimumAudience: number,
    snapshotMaxAgeMinutes: number,
    loadFromDatabase: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = await popularityCacheGeneration(this.redisCache);
      const cacheKey = this.cacheKey(
        kind,
        window,
        genre,
        limit,
        minimumAudience,
        snapshotMaxAgeMinutes,
        generation,
      );
      const cached = await this.redisCache?.getJson<T>(cacheKey);
      if (cached !== null && cached !== undefined) {
        if (
          cachedSnapshotIsFresh(cached, snapshotMaxAgeMinutes) &&
          generation === await popularityCacheGeneration(this.redisCache)
        ) return cached;
        continue;
      }

      const result = await loadFromDatabase();
      if (generation !== await popularityCacheGeneration(this.redisCache)) continue;
      await this.redisCache?.setJson(cacheKey, result, DISCOVERY_POPULARITY_CACHE_TTL_SECONDS);
      if (generation === await popularityCacheGeneration(this.redisCache)) return result;
    }
    throw new Error("Popularity snapshot changed repeatedly while reading; retry the request");
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function oldestSnapshotTimestamp(timestamps: Date[]) {
  if (!timestamps.length) return null;
  const oldest = timestamps.reduce(
    (current, timestamp) => Math.min(current, timestamp.getTime()),
    Number.POSITIVE_INFINITY,
  );
  return new Date(oldest).toISOString();
}

function cachedSnapshotIsFresh(value: unknown, maximumAgeMinutes: number) {
  if (!value || typeof value !== "object") return false;
  const computedAt = (value as { computedAt?: unknown }).computedAt;
  if (computedAt === null || computedAt === undefined) return true;
  const milliseconds = computedAt instanceof Date
    ? computedAt.getTime()
    : typeof computedAt === "string"
      ? Date.parse(computedAt)
      : NaN;
  if (!Number.isFinite(milliseconds)) return false;
  const ageMs = Date.now() - milliseconds;
  return ageMs >= 0 && ageMs <= maximumAgeMinutes * 60_000;
}
