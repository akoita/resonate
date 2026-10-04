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
import {
  applyDiscoveryPolicy,
  applyFirstListenerReservationOutcome,
} from "./discovery-policy";
import { discoveryVariantForUser, type DiscoveryVariantAssignment } from "./discovery_experiment";
import { DiscoveryPolicyContextService } from "./discovery-policy-context.service";
import { resolveAgentTasteProfile } from "../agents/agent_learning.service";
import { TasteMemoryPolicy, TasteMemoryService } from "./taste_memory.service";
import { TasteNoteEmbeddingService } from "../embeddings/taste_note_embedding.service";
import { TrackEmbeddingService } from "../embeddings/track_embedding.service";
import {
  collectEmbeddingNeighbours,
  EmbeddingCandidateSource,
} from "./embedding_candidates";
import { loadEmbeddingSeedSignals, selectEmbeddingSeeds } from "./embedding_seeds";
import { FirstListenerDiscoveryService } from "./first_listener_discovery.service";
import { FIRST_LISTENER_CANDIDATE_LIMIT } from "./first_listener.contracts";
import {
  AI_PROMOTIONAL_ELIGIBILITY_WHERE,
  toAiDisclosureRecord,
} from "../catalog/ai-disclosure.policy";

const PUBLIC_RELEASE_ROUTES = [
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
];

/** How many served track ids we remember per user (parity with the old Map). */
const SERVED_HISTORY_CAP = 50;
const PROFILE_CACHE_TTL_SECONDS = 300;
// Home's ordinary source ceilings are 50 + 60 + 30 + 50 embedding neighbours.
const FIRST_LISTENER_VALIDATION_LIMIT = 200;
const FIRST_LISTENER_VALIDATION_BATCH = FIRST_LISTENER_CANDIDATE_LIMIT;

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
 *     (fresh + preference-catalog + cohort-hints + embedding-neighbours)
 *     instead of "50 newest", so older tracks are reachable through every
 *     non-recency source. WS-3 popularity marts / WS-6 CF slot in as further
 *     sources.
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
    // Policy-stage lookups (ADR-TE-2). Absent in lightweight unit wiring: the
    // policy then runs with empty verified/played sets (no exploration slot).
    @Optional() private readonly policyContext?: DiscoveryPolicyContextService,
    // Embedding candidate source (#2003). Absent in lightweight wiring, and
    // inert while the embedding provider is disabled: Home is then unchanged.
    @Optional() private readonly trackEmbeddings?: TrackEmbeddingService,
    @Optional() private readonly tasteNoteEmbeddings?: TasteNoteEmbeddingService,
    // Fresh verified-artist releases are an additive candidate source. Missing
    // or failing source storage leaves the ordinary recommendation pool intact.
    @Optional() private readonly firstListenerDiscovery?: FirstListenerDiscoveryService,
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
    // Most recent first, one entry per track: a re-served id moves to the
    // front instead of repeating, so the capped window keeps covering distinct
    // tracks. Deduping `previous` too collapses rows written before this fix.
    const updated = [...new Set([...trackIds, ...previous])].slice(0, SERVED_HISTORY_CAP);
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
      // ADR-BM-5: fully AI-generated recordings stay directly discoverable
      // and marketplace-eligible, but never enter human-artist promotion.
      ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
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
   *   - `cohort-hints`: catalog-wide matches for joined-cohort query hints;
   *   - `embedding-neighbours` (#2003, WS-5): stored-vector nearest neighbours
   *     of up to 3 tracks the listener saved or finished, plus of up to 2 of
   *     their written taste notes (#2006), 10 each. Reaches tracks nobody has
   *     played. Stored vectors only: Home never calls the embedding model and
   *     never uses the metadata fallback, so with the provider disabled, no
   *     vectors, or no seeds this source is empty and the pool is unchanged.
   * WS-3 (popularity marts) and WS-6 (CF) add sources here.
   *
   * `embeddingSources` maps a track id to the kinds of seed that reached it so
   * ranking can attribute the candidate (categorical, never the seed itself).
   */
  private async gatherCandidates(input: {
    userId: string;
    allowExplicit: boolean;
    preferenceTerms: string[];
    cohortHints: string[];
    embeddingSeedTrackIds: string[];
  }): Promise<{
    tracks: CandidateTrack[];
    embeddingSources: Map<string, EmbeddingCandidateSource[]>;
    firstListenerTrackIds: Set<string>;
    firstListenerVerificationComplete: boolean;
  }> {
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
    // Runs alongside the other sources. Never throws: embeddings only add
    // candidates, so any failure leaves the pool exactly as it was without them.
    const embeddingSource = collectEmbeddingNeighbours(
      { tracks: this.trackEmbeddings, notes: this.tasteNoteEmbeddings },
      {
        userId: input.userId,
        seedTrackIds: input.embeddingSeedTrackIds,
        allowExplicit: input.allowExplicit,
      },
    )
      .then(async (sources) => ({
        sources,
        // Same public-catalog predicate and include as every other source; the
        // neighbour lists are already eligibility-filtered, this is the join.
        tracks: sources.size
          ? ((await prisma.track.findMany({
              where: { AND: [where, { id: { in: [...sources.keys()] } }] },
              include,
            })) as CandidateTrack[])
          : none,
      }))
      .catch(() => ({
        sources: new Map<string, EmbeddingCandidateSource[]>(),
        tracks: none,
      }));

    const firstListenerSource = this.firstListenerDiscovery
      ? this.firstListenerDiscovery
          .getFreshCandidates({
            userId: input.userId,
            allowExplicit: input.allowExplicit,
          })
          .then((tracks) => tracks as unknown as CandidateTrack[])
          .catch(() => none)
      : Promise.resolve(none);

    const [fresh, preferenceMatches, cohortMatches, embedding, firstListenerTracks] = await Promise.all([
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
      embeddingSource,
      firstListenerSource,
    ]);

    const ordinaryTracks = [
      ...fresh,
      ...preferenceMatches,
      ...cohortMatches,
      ...embedding.tracks,
    ];
    const byId = new Map<string, CandidateTrack>();
    for (const track of [...ordinaryTracks, ...firstListenerTracks]) {
      if (!byId.has(track.id)) byId.set(track.id, track);
    }
    const firstListenerTrackIds = new Set(firstListenerTracks.map((track) => track.id));
    let firstListenerVerificationComplete = true;
    if (this.firstListenerDiscovery) {
      const sourceTrackIds = new Set(firstListenerTracks.map((track) => track.id));
      const ordinaryTrackIds = [...new Set(ordinaryTracks.map((track) => track.id))]
        .filter((trackId) => !sourceTrackIds.has(trackId));
      if (ordinaryTrackIds.length > FIRST_LISTENER_VALIDATION_LIMIT) {
        firstListenerVerificationComplete = false;
      } else {
        for (let offset = 0; offset < ordinaryTrackIds.length; offset += FIRST_LISTENER_VALIDATION_BATCH) {
          const trackIds = ordinaryTrackIds.slice(offset, offset + FIRST_LISTENER_VALIDATION_BATCH);
          try {
            const validated = await this.firstListenerDiscovery.getFreshCandidates({
              userId: input.userId,
              allowExplicit: input.allowExplicit,
              trackIds,
            });
            for (const track of validated) firstListenerTrackIds.add(track.id);
          } catch {
            firstListenerVerificationComplete = false;
            break;
          }
        }
      }
    }
    // Attribution only for tracks that survived the public-catalog join.
    const joined = new Set(embedding.tracks.map((track) => track.id));
    const embeddingSources = new Map(
      [...embedding.sources].filter(([trackId]) => joined.has(trackId)),
    );
    return {
      tracks: [...byId.values()],
      embeddingSources,
      firstListenerTrackIds,
      firstListenerVerificationComplete,
    };
  }

  /**
   * Up to 3 tracks the listener saved or finished, for embedding search (#2003).
   * Needs the taste-memory policy: without it consent cannot be checked, so
   * there are no seeds. Costs nothing while embeddings are disabled.
   */
  private async loadEmbeddingSeedTrackIds(
    userId: string,
    policy: TasteMemoryPolicy | undefined,
  ): Promise<string[]> {
    if (!this.trackEmbeddings?.isEnabled() || !policy || !this.tasteMemoryService) {
      return [];
    }
    try {
      const [signals, agentPlaybackAllowed] = await Promise.all([
        loadEmbeddingSeedSignals(userId, policy.resetAt),
        this.tasteMemoryService.shouldTrainAgentPlayback(userId, {
          source: "agent_session",
        }),
      ]);
      return selectEmbeddingSeeds(signals, { policy, agentPlaybackAllowed });
    } catch {
      // Embeddings only add candidates; a failure here must not break Home.
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Ranking (delegated to the shared DiscoveryRankingService)
  // ---------------------------------------------------------------------------

  /** Verified-human and played artist sets for the policy stage; fails open. */
  private async loadPolicyContext(
    userId: string,
    artistIds: Array<string | null | undefined>,
  ) {
    const empty = {
      verifiedHumanArtistIds: new Set<string>() as ReadonlySet<string>,
      playedArtistIds: new Set<string>() as ReadonlySet<string>,
    };
    if (!this.policyContext) return empty;
    try {
      return await this.policyContext.loadContext(
        userId,
        artistIds.filter((id): id is string => !!id),
      );
    } catch {
      // Only disables exploration; hidden, AI and diversity rules stand.
      return empty;
    }
  }

  /**
   * Records `recommendation.generated` with the variant label (#1455 WS-8).
   * Also used by the Home feed for cold listeners, who skip the ranker.
   */
  publishGenerated(input: {
    userId: string;
    trackIds: string[];
    strategy: string;
    variant: DiscoveryVariantAssignment;
    surface?: string;
    cohortInfluence?: ReturnType<typeof cohortInfluenceSummary>;
  }) {
    this.eventBus.publish({
      eventName: "recommendation.generated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: input.userId,
      trackIds: input.trackIds,
      strategy: input.strategy,
      ...(input.cohortInfluence ? { cohortInfluence: input.cohortInfluence } : {}),
      surface: input.surface ?? "home",
      rankerVariant: input.variant.rankerVariant,
      ...(input.variant.experimentKey ? { experimentKey: input.variant.experimentKey } : {}),
    });
  }

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

    const {
      tracks: candidates,
      embeddingSources,
      firstListenerTrackIds,
      firstListenerVerificationComplete,
    } = await this.gatherCandidates({
      userId,
      embeddingSeedTrackIds: await this.loadEmbeddingSeedTrackIds(userId, policy),
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
        // Artist identity + AI disclosure feed the policy stage.
        artistId: track.release.artistId,
        releaseId: track.releaseId,
        firstListenerEligible:
          firstListenerVerificationComplete &&
          firstListenerTrackIds.has(track.id) &&
          track.aiDisclosureLevel !== "ALL",
        aiDisclosureLevel: track.aiDisclosureLevel,
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
        ...(embeddingSources.has(track.id)
          ? { embeddingSources: embeddingSources.get(track.id) }
          : {}),
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

    // The same persisted taste profile the AI DJ ranks with (#1456 WS-9), so
    // one listener has one set of learned genre weights on both surfaces.
    // Fails open: no profile contributes no learned weights.
    const learnedGenreWeights = await resolveAgentTasteProfile(userId, { policy })
      .then((profile) => profile.genreWeights)
      .catch(() => ({}) as Record<string, number>);

    const ranked = await this.rankingService.rank(
      enriched.map((entry) => entry.candidate),
      {
        originalQueries,
        expandedQueries: originalQueries,
        learnedGenreWeights,
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

    // An embedding neighbour of the listener's own saves or notes is a taste
    // match too (#2003); without this it would be dropped whenever any genre or
    // mood term matched. It still ranks below stronger matches by score.
    const preferenceMatches = withLegacy.filter(
      (item) =>
        !recent.includes(item.entry.id) &&
        (item.reasons.some(
          (reason) => reason.startsWith("genre:") || reason.startsWith("mood:"),
        ) ||
          (item.entry.embeddingSources?.length ?? 0) > 0),
    );
    const freshFallback = withLegacy.filter(
      (item) => !recent.includes(item.entry.id),
    );
    const preferenceOrdered = preferenceMatches.length
      ? preferenceMatches
      : freshFallback.length
        ? freshFallback
        : withLegacy;

    // The policy stage (ADR-TE-2, docs/rfc/taste-engine.md §3.4) runs on the
    // preference-ordered list before the page is cut: hidden taste, AI,
    // exploration share, diversity cap, categorical reason. The same stage
    // the AI DJ applies to its shortlist.
    const policyContext = await this.loadPolicyContext(
      userId,
      preferenceOrdered.map((item) => item.entry.artistId),
    );
    const policyOptions = {
      limit,
      tastePolicy: policy,
      verifiedHumanArtistIds: firstListenerVerificationComplete
        ? policyContext.verifiedHumanArtistIds
        : new Set<string>(),
      playedArtistIds: policyContext.playedArtistIds,
    };
    let policyInput = preferenceOrdered;
    let policyResult = applyDiscoveryPolicy(
      policyInput.map((item) => item.entry),
      policyOptions,
    );
    const firstListenerPicks = policyResult.items.filter(
      (entry) => entry.firstListenerEligible && entry.reasonCode === "discovery_pick",
    );
    if (firstListenerPicks.length > 0 && this.firstListenerDiscovery) {
      try {
        const reserved = await this.firstListenerDiscovery.reservePlacements(
          userId,
          firstListenerPicks.flatMap((entry) =>
            entry.releaseId
              ? [{ trackId: entry.id, releaseId: entry.releaseId }]
              : [],
          ),
          { allowExplicit },
        );
        policyResult = applyFirstListenerReservationOutcome(
          policyInput.map((item) => item.entry),
          policyResult,
          reserved,
          policyOptions,
        );
      } catch {
        // Reservation failure removes the fresh-source candidates from this
        // response. The usual recommendation sources still rank and serve.
        policyInput = preferenceOrdered.filter(
          (item) => !item.entry.firstListenerEligible,
        );
        policyResult = applyDiscoveryPolicy(
          policyInput.map((item) => item.entry),
          policyOptions,
        );
      }
    }
    const legacyById = new Map(policyInput.map((item) => [item.entry.id, item]));
    const selected = policyResult.items.map((entry) => ({
      ...legacyById.get(entry.id)!,
      entry,
    }));

    await this.recordServed(
      userId,
      selected.map((item) => item.entry.id),
      recent,
    );

    // #1455 WS-8: every generation records the listener's variant label. All
    // variants run this same ranker for now; only the label differs.
    const variant = discoveryVariantForUser(userId);
    this.publishGenerated({
      userId,
      trackIds: selected.map((item) => item.entry.id),
      strategy: normalizedGenres.length || normalizedMood
        ? "preference_mapping"
        : cohortContext.length
          ? "cohort_context"
          : "recent_first",
      variant,
      cohortInfluence: cohortInfluenceSummary(
        cohortContext,
        selected.flatMap((item) => item.cohortMatches),
      ),
    });

    return {
      userId,
      /** #1449: correlates recommendation.served / .clicked impressions. */
      requestId: randomUUID(),
      /** #1455 WS-8: variant label the web forwards on served/clicked events. */
      rankerVariant: variant.rankerVariant,
      experimentKey: variant.experimentKey,
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
        aiDisclosure: toAiDisclosureRecord(source.candidate.track),
        score: entry.score,
        reasons,
        /** New in WS-1: the unified core's human explanations (additive). */
        explanations: entry.explanation,
        /** #1456: primary reason from the shared vocabulary, same as the DJ. */
        reasonCode: entry.reasonCode,
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
