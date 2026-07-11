import { randomUUID } from "crypto";
import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { CommunityCohortDiscoveryContext, CommunityCohortService } from "../community/community_cohort.service";
import { EventBus } from "../shared/event_bus";
import { RedisCacheService } from "../shared/redis_cache.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import {
  DiscoveryCandidate,
  DiscoveryRankingService,
  matchingCohortContexts,
  RankedDiscoveryCandidate,
} from "./discovery-ranking.service";
import { TasteMemoryPolicy, TasteMemoryService } from "./taste_memory.service";

const PUBLIC_RELEASE_ROUTES = [
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
];

/** How many served track ids we remember per user (parity with the old Map). */
const SERVED_HISTORY_CAP = 50;
const PROFILE_CACHE_TTL_SECONDS = 300;

export interface UserPreferences {
  mood?: string;
  energy?: "low" | "medium" | "high";
  genres?: string[];
  allowExplicit?: boolean;
}

type CandidateTrack = Prisma.TrackGetPayload<{
  include: {
    release: { include: { artist: { select: { id: true; displayName: true } } } };
  };
}>;

interface DiscoveryProfile {
  preferences: UserPreferences;
  preferencesUpdatedAt: Date | null;
  servedTrackIds: string[];
}

/**
 * Home discovery (#1448 WS-1).
 *
 * What changed from the pre-WS-1 service (RFC §1.3):
 *   - Preferences and served-history live in Postgres
 *     (`RecommendationProfile`), fronted by the fail-open Redis cache — they
 *     survive restarts and are coherent across Cloud Run instances. The
 *     in-memory Maps are gone.
 *   - The candidate pool is a UNION of sources behind `gatherCandidates`
 *     (fresh + preference-catalog + cohort-hints) instead of "50 newest", so
 *     older tracks are reachable through every non-recency source. WS-3
 *     popularity marts / WS-5 embeddings / WS-6 CF slot in as further sources.
 *   - Scoring is delegated to the shared `DiscoveryRankingService` — the same
 *     core the AI DJ uses — so Home inherits learned-taste/cohort/warehouse
 *     signals as they mature. The legacy response contract is preserved
 *     exactly (reason strings `genre:X`/`mood:Y`/`cohort:Title`, strategies,
 *     hidden-signal semantics).
 *
 * Deterministic fallback (RFC §4): with Redis, BigQuery, and every optional
 * signal source unavailable, this still returns correct results from Postgres
 * alone — the cache fails open and the ranking core treats absent sources as
 * zero-weight signals.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly rankingService: DiscoveryRankingService,
    @Optional() private readonly tasteMemoryService?: TasteMemoryService,
    @Optional() private readonly communityCohortService?: CommunityCohortService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) { }

  // ---------------------------------------------------------------------------
  // Durable preference + served-history state
  // ---------------------------------------------------------------------------

  private profileCacheKey(userId: string) {
    return `discovery:profile:${userId}`;
  }

  private async loadProfile(userId: string): Promise<DiscoveryProfile> {
    const cached = await this.redisCache?.getJson<{
      preferences: UserPreferences;
      preferencesUpdatedAt: string | null;
      servedTrackIds: string[];
    }>(this.profileCacheKey(userId));
    if (cached) {
      return {
        preferences: cached.preferences ?? {},
        preferencesUpdatedAt: cached.preferencesUpdatedAt
          ? new Date(cached.preferencesUpdatedAt)
          : null,
        servedTrackIds: cached.servedTrackIds ?? [],
      };
    }

    const row = await prisma.recommendationProfile.findUnique({
      where: { userId },
    });
    const profile: DiscoveryProfile = {
      preferences: (row?.preferences as UserPreferences | null) ?? {},
      preferencesUpdatedAt: row?.preferencesUpdatedAt ?? null,
      servedTrackIds: row?.servedTrackIds ?? [],
    };
    await this.redisCache?.setJson(
      this.profileCacheKey(userId),
      {
        preferences: profile.preferences,
        preferencesUpdatedAt: profile.preferencesUpdatedAt?.toISOString() ?? null,
        servedTrackIds: profile.servedTrackIds,
      },
      PROFILE_CACHE_TTL_SECONDS,
    );
    return profile;
  }

  async setPreferences(userId: string, prefs: UserPreferences) {
    const existing = await this.loadProfile(userId);
    const merged = { ...existing.preferences, ...prefs };
    const now = new Date();
    await prisma.recommendationProfile.upsert({
      where: { userId },
      create: {
        userId,
        preferences: merged as object,
        preferencesUpdatedAt: now,
      },
      update: {
        preferences: merged as object,
        preferencesUpdatedAt: now,
      },
    });
    await this.redisCache?.del(this.profileCacheKey(userId));
    this.eventBus.publish({
      eventName: "recommendation.preferences_updated",
      eventVersion: 1,
      occurredAt: now.toISOString(),
      userId,
      preferences: merged as Record<string, unknown>,
    });
    return { userId, preferences: merged };
  }

  async getPreferences(userId: string): Promise<UserPreferences> {
    return (await this.loadProfile(userId)).preferences;
  }

  /** Served-history for impression rotation (#1454 WS-7). */
  async getServedHistory(userId: string): Promise<string[]> {
    return (await this.loadProfile(userId)).servedTrackIds;
  }

  /** Record externally-composed impressions (Home feed rails, #1454 WS-7). */
  async noteServed(userId: string, trackIds: string[]) {
    if (!trackIds.length) return;
    const previous = await this.getServedHistory(userId);
    await this.recordServed(userId, trackIds, previous);
  }

  private async recordServed(userId: string, trackIds: string[], previous: string[]) {
    const updated = [...trackIds, ...previous].slice(0, SERVED_HISTORY_CAP);
    await prisma.recommendationProfile.upsert({
      where: { userId },
      create: { userId, servedTrackIds: updated },
      update: { servedTrackIds: updated },
    });
    await this.redisCache?.del(this.profileCacheKey(userId));
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Candidate sources (RFC §3.2) — union instead of "50 newest"
  // ---------------------------------------------------------------------------

  private publicCatalogWhere(allowExplicit: boolean): Prisma.TrackWhereInput {
    return {
      release: {
        status: { in: ["ready", "published"] },
        OR: [
          { rightsRoute: null },
          { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
        ],
      },
      ...(allowExplicit ? {} : { explicit: false }),
    };
  }

  /**
   * Union of candidate sources, deduped by track id:
   *   - `fresh`: newest 50 (the old pool, kept as one source among several);
   *   - `preference-catalog`: catalog-wide matches for the user's genre/mood
   *     terms with NO recency bias — this is what makes older tracks
   *     recommendable (WS-1 acceptance);
   *   - `cohort-hints`: catalog-wide matches for joined-cohort query hints.
   * WS-3 (popularity marts), WS-5 (embeddings), WS-6 (CF) add sources here.
   */
  private async gatherCandidates(input: {
    allowExplicit: boolean;
    preferenceTerms: string[];
    cohortHints: string[];
  }) {
    const where = this.publicCatalogWhere(input.allowExplicit);
    const include = {
      release: {
        include: {
          artist: { select: { id: true, displayName: true } },
        },
      },
    } satisfies Prisma.TrackInclude;

    const termFilter = (terms: string[]): Prisma.TrackWhereInput => ({
      OR: terms.flatMap((term) => [
        { release: { genre: { contains: term, mode: "insensitive" as const } } },
        { release: { title: { contains: term, mode: "insensitive" as const } } },
        { title: { contains: term, mode: "insensitive" as const } },
        { release: { is: { moods: { hasSome: [term] } } } },
      ]),
    });

    const none: CandidateTrack[] = [];
    const [fresh, preferenceMatches, cohortMatches] = await Promise.all([
      prisma.track.findMany({
        where,
        include,
        take: 50,
        orderBy: { createdAt: "desc" },
      }) as Promise<CandidateTrack[]>,
      input.preferenceTerms.length
        ? (prisma.track.findMany({
            where: { AND: [where, termFilter(input.preferenceTerms)] },
            include,
            take: 60,
          }) as Promise<CandidateTrack[]>)
        : Promise.resolve(none),
      input.cohortHints.length
        ? (prisma.track.findMany({
            where: { AND: [where, termFilter(input.cohortHints)] },
            include,
            take: 30,
          }) as Promise<CandidateTrack[]>)
        : Promise.resolve(none),
    ]);

    const byId = new Map<string, CandidateTrack>();
    for (const track of [...fresh, ...preferenceMatches, ...cohortMatches]) {
      if (!byId.has(track.id)) byId.set(track.id, track);
    }
    return [...byId.values()];
  }

  // ---------------------------------------------------------------------------
  // Ranking (delegated to the shared DiscoveryRankingService)
  // ---------------------------------------------------------------------------

  async getRecommendations(userId: string, limit = 10, preferenceOverrides?: UserPreferences) {
    const policy = await this.tasteMemoryService?.getPolicy(userId);
    const profile = await this.loadProfile(userId);
    const storedPreferences = shouldUseStoredPreferences(
      profile.preferences,
      profile.preferencesUpdatedAt ?? undefined,
      policy,
    );
    const mergedPrefs = { ...storedPreferences, ...(preferenceOverrides ?? {}) };
    const prefs = policy && this.tasteMemoryService
      ? this.tasteMemoryService.filterPreferencesWithPolicy(mergedPrefs, policy)
      : mergedPrefs;
    const cohortContext = await this.communityCohortService?.getDiscoveryContextForUser(userId) ?? [];
    const allowExplicit = prefs.allowExplicit ?? false;
    const normalizedGenres = (prefs.genres ?? [])
      .map((genre) => genre.trim())
      .filter(Boolean);
    const normalizedMood = prefs.mood?.trim();

    const candidates = await this.gatherCandidates({
      allowExplicit,
      preferenceTerms: [
        ...normalizedGenres,
        ...(normalizedMood ? [normalizedMood] : []),
      ],
      cohortHints: cohortContext.flatMap((cohort) => cohort.queryHints),
    });

    const recent = profile.servedTrackIds;

    // Legacy-contract matching: which preference terms does each track match
    // (same substring semantics as the pre-WS-1 scorer, so `reasons` strings
    // and hidden-signal behavior are unchanged).
    const enriched = candidates.map((track: CandidateTrack) => {
      const genre = track.release.genre ?? "";
      const moods = track.release.moods ?? [];
      const matchedGenre = normalizedGenres.find((candidate) =>
        genre.toLowerCase().includes(candidate.toLowerCase()),
      );
      const moodNeedle = normalizedMood?.toLowerCase();
      const matchedMood = moodNeedle
        ? (
          track.title.toLowerCase().includes(moodNeedle) ||
          track.release.title.toLowerCase().includes(moodNeedle) ||
          genre.toLowerCase().includes(moodNeedle) ||
          moods.some((mood: string) => mood.toLowerCase().includes(moodNeedle))
        )
        : false;
      const candidate: DiscoveryCandidate & { track: typeof track } = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        release: {
          genre: track.release.genre,
          title: track.release.title,
          moods: track.release.moods,
          artistDisplayName: track.release.artist?.displayName ?? null,
        },
        matchedQueries: [
          ...(matchedGenre ? [matchedGenre] : []),
          ...(matchedMood && normalizedMood ? [normalizedMood] : []),
        ],
        track,
      };
      return { candidate, matchedGenre, matchedMood };
    });

    const originalQueries = [
      ...normalizedGenres,
      ...(normalizedMood ? [normalizedMood] : []),
    ];
    const canUseWarehouseTaste =
      await this.tasteMemoryService?.canUseTasteForSocialMatching(userId) ?? false;
    const bigQueryTasteScores = canUseWarehouseTaste
      ? await this.rankingService.fetchWarehouseTasteScores(
          userId,
          enriched.map((entry) => entry.candidate.id),
        )
      : undefined;

    const ranked = await this.rankingService.rank(
      enriched.map((entry) => entry.candidate),
      {
        originalQueries,
        expandedQueries: originalQueries,
        cohortContext,
        recentTrackIds: recent,
        tastePolicy: policy,
        bigQueryTasteScores,
        energy: prefs.energy,
      },
    );

    const byId = new Map(enriched.map((entry) => [entry.candidate.id, entry]));
    const withLegacy = ranked.map((entry) => {
      const source = byId.get(entry.id)!;
      const reasons: string[] = [];
      if (source.matchedGenre) reasons.push(`genre:${source.matchedGenre}`);
      if (source.matchedMood && normalizedMood) reasons.push(`mood:${normalizedMood}`);
      const cohortMatches = matchingCohortContexts(entry, cohortContext);
      for (const cohort of cohortMatches) reasons.push(`cohort:${cohort.title}`);
      return { entry, source, reasons, cohortMatches };
    });

    // Selection semantics preserved: preference matches first, else fresh,
    // else everything; never re-serve recent tracks when alternatives exist.
    // Secondary sort keeps richer preference matches (genre AND mood) ahead of
    // single-term matches at equal core score, then newest first.
    withLegacy.sort((a, b) => {
      if (a.entry.score !== b.entry.score) return b.entry.score - a.entry.score;
      const aMatches = a.entry.matchedQueries?.length ?? 0;
      const bMatches = b.entry.matchedQueries?.length ?? 0;
      if (aMatches !== bMatches) return bMatches - aMatches;
      return (
        b.source.candidate.track.createdAt.getTime() - a.source.candidate.track.createdAt.getTime()
      );
    });

    const preferenceMatches = withLegacy.filter(
      (item) =>
        !recent.includes(item.entry.id) &&
        item.reasons.some(
          (reason) => reason.startsWith("genre:") || reason.startsWith("mood:"),
        ),
    );
    const freshFallback = withLegacy.filter(
      (item) => !recent.includes(item.entry.id),
    );
    const selected = (
      preferenceMatches.length
        ? preferenceMatches
        : freshFallback.length
          ? freshFallback
          : withLegacy
    ).slice(0, limit);

    await this.recordServed(
      userId,
      selected.map((item) => item.entry.id),
      recent,
    );

    this.eventBus.publish({
      eventName: "recommendation.generated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      trackIds: selected.map((item) => item.entry.id),
      strategy: normalizedGenres.length || normalizedMood
        ? "preference_mapping"
        : cohortContext.length
          ? "cohort_context"
          : "recent_first",
      cohortInfluence: cohortInfluenceSummary(
        cohortContext,
        selected.flatMap((item) => item.cohortMatches),
      ),
    });

    return {
      userId,
      /** #1449: correlates recommendation.served / .clicked impressions. */
      requestId: randomUUID(),
      preferences: prefs,
      cohortContext: cohortContextSummary(cohortContext),
      items: selected.map(({ entry, source, reasons }) => ({
        id: entry.id,
        title: source.candidate.track.title,
        artistId: source.candidate.track.release.artistId,
        // Credited artist (#1492), not the uploader/manager account label.
        artist: resolveCreditedArtistName({
          trackArtist: source.candidate.track.artist,
          primaryArtist: source.candidate.track.release.primaryArtist,
          accountDisplayName: source.candidate.track.release.artist?.displayName,
        }),
        releaseId: source.candidate.track.releaseId,
        releaseTitle: source.candidate.track.release.title,
        genre: source.candidate.track.release.genre,
        moods: source.candidate.track.release.moods,
        score: entry.score,
        reasons,
        /** New in WS-1: the unified core's human explanations (additive). */
        explanations: entry.explanation,
      })),
    };
  }
}

function cohortContextSummary(cohorts: CommunityCohortDiscoveryContext[]) {
  return {
    applied: cohorts.length > 0,
    count: cohorts.length,
    cohorts: cohorts.map((cohort) => ({
      cohortId: cohort.cohortId,
      cohortType: cohort.cohortType,
      reasonCode: cohort.reasonCode,
      title: cohort.title,
    })),
  };
}

function cohortInfluenceSummary(
  available: CommunityCohortDiscoveryContext[],
  matched: CommunityCohortDiscoveryContext[],
) {
  const byId = new Map(matched.map((cohort) => [cohort.cohortId, cohort]));
  return {
    availableCount: available.length,
    appliedCount: byId.size,
    cohortIds: [...byId.values()].map((cohort) => cohort.cohortId),
    cohortTypes: [...new Set([...byId.values()].map((cohort) => cohort.cohortType))],
    reasonCodes: [...new Set([...byId.values()].map((cohort) => cohort.reasonCode))],
  };
}

function shouldUseStoredPreferences(
  preferences: UserPreferences,
  updatedAt: Date | undefined,
  policy?: TasteMemoryPolicy,
) {
  if (!policy?.resetAt) {
    return preferences;
  }
  if (updatedAt && updatedAt > policy.resetAt) {
    return preferences;
  }
  return {};
}
