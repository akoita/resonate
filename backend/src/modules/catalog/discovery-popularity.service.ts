import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { RedisCacheService } from "../shared/redis_cache.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";

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

export type PopularityWindow = "24h" | "7d" | "30d";

const WINDOW_HOURS: Record<PopularityWindow, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

const CACHE_TTL_SECONDS = 120;

function minAudience(): number {
  const parsed = Number.parseInt(
    process.env.DISCOVERY_MIN_AUDIENCE ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function refreshIntervalMs(): number {
  const parsed = Number.parseInt(
    process.env.DISCOVERY_POPULARITY_REFRESH_MINUTES ?? "",
    10,
  );
  const minutes = Number.isFinite(parsed) ? parsed : 15;
  return minutes > 0 ? minutes * 60_000 : 0;
}

interface TrackAccumulator {
  trackId: string;
  weightedPlays: number;
  plays: number;
  saves: number;
  listeners: Set<string>;
}

@Injectable()
export class DiscoveryPopularityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryPopularityService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Optional() private readonly redisCache?: RedisCacheService) {}

  onModuleInit() {
    const interval = refreshIntervalMs();
    if (!interval || process.env.NODE_ENV === "test") {
      return;
    }
    // Interim WS-3 filler: refresh on boot, then on a configurable cadence.
    // The warehouse export job replaces this scheduler (see #1450).
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
    for (const window of Object.keys(WINDOW_HOURS) as PopularityWindow[]) {
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
    const hours = WINDOW_HOURS[window];
    const since = new Date(Date.now() - hours * 3_600_000);
    const now = Date.now();
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventName: {
          in: ["playback.completed", "playback.started", "playlist.track_added"],
        },
        occurredAt: { gte: since },
      },
      select: {
        eventName: true,
        occurredAt: true,
        actorId: true,
        payload: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 50_000, // bounded (RFC §4); WS-3 marts remove this ceiling
    });

    const byTrack = new Map<string, TrackAccumulator>();
    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | null;
      const trackId =
        typeof payload?.trackId === "string" ? payload.trackId : null;
      if (!trackId) continue;
      const acc =
        byTrack.get(trackId) ??
        ({
          trackId,
          weightedPlays: 0,
          plays: 0,
          saves: 0,
          listeners: new Set<string>(),
        } satisfies TrackAccumulator);
      const ageMs = now - event.occurredAt.getTime();
      const decay = Math.max(0.1, 1 - ageMs / (hours * 3_600_000));
      if (event.eventName === "playlist.track_added") {
        acc.saves += 1;
        acc.weightedPlays += 2 * decay;
      } else {
        const ratio =
          event.eventName === "playback.completed"
            ? Number(payload?.completionRatio ?? 1) || 1
            : 0.3; // a start without completion counts a little
        acc.plays += 1;
        acc.weightedPlays += Math.min(1.5, Math.max(0, ratio)) * decay;
      }
      if (event.actorId) acc.listeners.add(event.actorId);
      byTrack.set(trackId, acc);
    }

    const threshold = minAudience();
    const qualifying = [...byTrack.values()].filter(
      (acc) => acc.listeners.size >= threshold,
    );

    // Resolve genre + CREDITED artist for qualifying tracks in one query. The
    // rollup key is the credited artist name (#1492), not the uploader/manager
    // account id, so the Home "Top Artists" rail ranks the real artist.
    const tracks = qualifying.length
      ? await prisma.track.findMany({
          where: { id: { in: qualifying.map((acc) => acc.trackId) } },
          select: {
            id: true,
            artist: true,
            release: {
              select: {
                genre: true,
                artistId: true,
                primaryArtist: true,
                artist: { select: { id: true, displayName: true } },
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
      listeners: Set<string>;
      genres: Map<string, { score: number; plays: number; saves: number; listeners: Set<string> }>;
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
    }[] = [];

    for (const acc of qualifying) {
      const meta = trackMeta.get(acc.trackId);
      if (!meta) continue;
      const genre = meta.release.genre ?? "";
      const row = {
        trackId: acc.trackId,
        window,
        score: acc.weightedPlays,
        plays: acc.plays,
        uniqueListeners: acc.listeners.size,
        saves: acc.saves,
      };
      trackRows.push({ ...row, genre: "" });
      if (genre) trackRows.push({ ...row, genre });

      // Interim identity key (#1492 Phase A): roll up by CREDITED artist name,
      // not the uploader/manager account id. Two different accounts crediting
      // the same artist name collapse into one chart entry — which is correct.
      const artistId =
        resolveCreditedArtistName({
          trackArtist: meta.artist,
          primaryArtist: meta.release.primaryArtist,
          accountDisplayName: meta.release.artist?.displayName,
        }) ?? meta.release.artistId;
      const artist =
        byArtist.get(artistId) ??
        ({
          artistId,
          score: 0,
          plays: 0,
          saves: 0,
          listeners: new Set<string>(),
          genres: new Map(),
        } satisfies ArtistAccumulator);
      artist.score += acc.weightedPlays;
      artist.plays += acc.plays;
      artist.saves += acc.saves;
      for (const listener of acc.listeners) artist.listeners.add(listener);
      if (genre) {
        const g =
          artist.genres.get(genre) ??
          { score: 0, plays: 0, saves: 0, listeners: new Set<string>() };
        g.score += acc.weightedPlays;
        g.plays += acc.plays;
        g.saves += acc.saves;
        for (const listener of acc.listeners) g.listeners.add(listener);
        artist.genres.set(genre, g);
      }
      byArtist.set(artistId, artist);
    }

    // NOTE (#1492 Phase A): `ArtistEngagement.artistId` holds the interim
    // identity key — the CREDITED artist display name, not an account id. Phase B
    // replaces it with a stable credited-artist id; #1450's warehouse marts MUST
    // adopt the same key so the serving contract stays consistent.
    const artistRows: {
      artistId: string;
      window: string;
      genre: string;
      score: number;
      plays: number;
      uniqueListeners: number;
      saves: number;
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
          });
        }
      }
    }

    // Replace the window snapshot atomically.
    await prisma.$transaction([
      prisma.trackPopularity.deleteMany({ where: { window } }),
      ...(trackRows.length
        ? [prisma.trackPopularity.createMany({ data: trackRows })]
        : []),
      prisma.artistEngagement.deleteMany({ where: { window } }),
      ...(artistRows.length
        ? [prisma.artistEngagement.createMany({ data: artistRows })]
        : []),
    ]);
    await this.redisCache?.del(this.cacheKey("trending", window, ""));
    await this.redisCache?.del(this.cacheKey("top-artists", window, ""));
    this.logger.log(
      `Popularity refresh (${window}): ${trackRows.length} track rows, ${artistRows.length} artist rows (threshold ${threshold})`,
    );
  }

  private cacheKey(kind: string, window: string, genre: string) {
    return `discovery:${kind}:${window}:${genre || "all"}`;
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
    const cacheKey = `${this.cacheKey("trending", window, genre)}:${limit}`;
    const cached = await this.redisCache?.getJson<object>(cacheKey);
    if (cached) return cached;

    const rows = await prisma.trackPopularity.findMany({
      where: { window, genre },
      orderBy: { score: "desc" },
      take: limit,
    });
    const tracks = rows.length
      ? await prisma.track.findMany({
          where: { id: { in: rows.map((row) => row.trackId) } },
          include: {
            release: {
              select: {
                id: true,
                title: true,
                genre: true,
                artworkUrl: true,
                artworkMimeType: true,
                artistId: true,
                primaryArtist: true,
                artist: { select: { id: true, displayName: true } },
              },
            },
          },
        })
      : [];
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const result = {
      window,
      genre: genre || null,
      minimumAudience: minAudience(),
      items: rows
        .map((row, index) => {
          const track = trackById.get(row.trackId);
          if (!track) return null;
          return {
            rank: index + 1,
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
            score: row.score,
            plays: row.plays,
            uniqueListeners: row.uniqueListeners,
            saves: row.saves,
          };
        })
        .filter(Boolean),
    };
    await this.redisCache?.setJson(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
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
    const cacheKey = `${this.cacheKey("top-artists", window, genre)}:${limit}`;
    const cached = await this.redisCache?.getJson<object>(cacheKey);
    if (cached) return cached;

    const rows = await prisma.artistEngagement.findMany({
      where: { window, genre },
      orderBy: { score: "desc" },
      take: limit,
    });
    // `row.artistId` is now the credited artist NAME (#1492 Phase A interim key).
    // Hydrate an account only when its displayName equals the credited name
    // (claimed/self-managed artists) — that gives us a profile link + image.
    // Otherwise the credited artist has no matching account, so `artistId` is
    // null and the UI links to the catalog artist route.
    const names = rows.map((row) => row.artistId);
    const accounts = names.length
      ? await prisma.artist.findMany({
          where: { displayName: { in: names } },
          select: { id: true, displayName: true, imageUrl: true },
        })
      : [];
    const accountByName = new Map(
      accounts.map((account) => [account.displayName, account]),
    );
    const result = {
      window,
      genre: genre || null,
      minimumAudience: minAudience(),
      items: rows.map((row, index) => {
        const account = accountByName.get(row.artistId) ?? null;
        return {
          rank: index + 1,
          name: row.artistId,
          artistId: account?.id ?? null,
          imageUrl: account?.imageUrl ?? null,
          score: row.score,
          plays: row.plays,
          uniqueListeners: row.uniqueListeners,
          saves: row.saves,
        };
      }),
    };
    await this.redisCache?.setJson(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
