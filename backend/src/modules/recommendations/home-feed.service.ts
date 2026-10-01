import { randomUUID } from "crypto";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { DiscoveryPopularityService } from "../catalog/discovery-popularity.service";
import { RecommendationsService } from "./recommendations.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import {
  AI_PROMOTIONAL_ELIGIBILITY_WHERE,
  toAiDisclosureRecord,
  type AiDisclosureRecord,
} from "../catalog/ai-disclosure.policy";
import {
  DISCOVERY_EXPLANATIONS,
  type DiscoveryReasonCode,
} from "./discovery-explanations";
import { applyDiscoveryPolicy } from "./discovery-policy";
import type { RankedDiscoveryCandidate } from "./discovery-ranking.service";
import { TasteMemoryPolicy, TasteMemoryService } from "./taste_memory.service";
import { discoveryVariantForUser } from "./discovery_experiment";

/**
 * Home feed v2 composition (#1454 WS-7).
 *
 * Composes — never re-ranks — the WS-1 ranking core and the WS-4 popularity
 * serving into a multi-rail personalized feed:
 *   - `because_genre`   "Because you save a lot of <genre>" (WS-1 items whose
 *                        reasons match the dominant preference genre/mood)
 *   - `new_from_artists` newest catalog tracks from artists the listener has
 *                        actually played (derived server-side; the response
 *                        never itemizes listening history)
 *   - `trending_genre`  "Trending in <genre>" (WS-4 serving tables)
 *   - `exploration`     a controlled slice of fresh/low-data tracks outside
 *                        the personalized lanes (DISCOVERY_EXPLORATION_COUNT,
 *                        default 4) to escape feedback loops (RFC §10)
 *
 * Privacy rule (RFC §7): every explanation is CATEGORICAL ("you save a lot of
 * Afrobeat"), never itemized history ("because you played X on Tuesday").
 *
 * Honesty rules: rails below their data floor are omitted, cold users get a
 * single explicitly-labeled `catalog_signal` rail (RFC §8), and there is no
 * "first N catalog releases" fallback pretending to be personal.
 *
 * Diversity + rotation (RFC §3 stage-3, §10): max 2 items per artist per
 * rail, each track appears in at most one rail, previously-served tracks sink
 * to the tail of each rail, and every rendered id is recorded back into the
 * served history so repeat visits rotate.
 *
 * Policy stage (ADR-TE-2, docs/rfc/taste-engine.md §3.4, #1456): every rail,
 * not only the ranked `because_genre` one, passes `applyDiscoveryPolicy` in
 * its own order: hidden taste (rule 1), fully AI-generated tracks (rule 2),
 * two per artist (rule 4) and a categorical `reasonCode` plus vocabulary
 * sentence on every item (rule 5). The rails reserve no exploration slot of
 * their own: rule 3 runs in the ranked rail, and the `exploration` rail is
 * the feed's dedicated fresh-track slice.
 */

export type HomeFeedRailKind =
  | "because_genre"
  | "new_from_artists"
  | "trending_genre"
  | "exploration"
  | "catalog_signal";

export interface HomeFeedItem {
  id: string;
  title: string;
  artist: string | null;
  artistId: string;
  releaseId: string;
  releaseTitle: string;
  genre: string | null;
  moods: string[];
  artworkMimeType: string | null;
  artworkRevision: number;
  aiDisclosure: AiDisclosureRecord;
  reasons: string[];
  /** Primary reason from the shared vocabulary (same codes as the DJ). */
  reasonCode: DiscoveryReasonCode;
  /** Vocabulary sentences; categorical, never itemized history. */
  explanations: string[];
}

export interface HomeFeedRail {
  id: string;
  kind: HomeFeedRailKind;
  title: string;
  /** Categorical, human-readable — never itemized listener history. */
  explanation: string;
  items: HomeFeedItem[];
}

const RAIL_SIZE = 8;
const ARTIST_CAP_PER_RAIL = 2;

function explorationCount(): number {
  const parsed = Number.parseInt(process.env.DISCOVERY_EXPLORATION_COUNT ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 4;
}

export interface RawItem
  extends Omit<
    HomeFeedItem,
    "artworkMimeType" | "artworkRevision" | "reasonCode" | "explanations"
  > {
  artworkMimeType?: string | null;
  artworkRevision?: number;
  /** Set when the item comes from the ranking core (already categorical). */
  reasonCode?: DiscoveryReasonCode;
  explanations?: string[];
}

/**
 * Reason for items of rails composed outside the ranking core. Kept honest:
 * only the artists rail is a listening-pattern fit; trending, fresh and
 * catalog-signal items are catalog candidates, and the rail's own title and
 * explanation say why they are there.
 */
const RAIL_REASON_CODE: Record<HomeFeedRailKind, DiscoveryReasonCode> = {
  because_genre: "taste_match",
  new_from_artists: "listening_pattern",
  trending_genre: "catalog",
  exploration: "catalog",
  catalog_signal: "catalog",
};

type PolicyCandidate = RankedDiscoveryCandidate & { item: RawItem };

type RailCaps = (
  kind: HomeFeedRailKind,
  items: RawItem[],
  used: Set<string>,
  size?: number,
) => HomeFeedItem[];

/**
 * Feed-wide dedupe, then the shared policy stage in the rail's own order:
 * hidden taste, fully AI-generated tracks, max N items per artist per rail,
 * and a categorical reason on every item. Adds the returned ids to `used`.
 */
export function applyRailPolicy(
  kind: HomeFeedRailKind,
  items: RawItem[],
  used: Set<string>,
  tastePolicy: TasteMemoryPolicy | undefined,
  size = RAIL_SIZE,
): HomeFeedItem[] {
  const seen = new Set<string>();
  const candidates: PolicyCandidate[] = [];
  for (const item of items) {
    if (used.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const reasonCode = item.reasonCode ?? RAIL_REASON_CODE[kind];
    const explanation = item.explanations?.length
      ? item.explanations
      : [DISCOVERY_EXPLANATIONS[reasonCode]];
    candidates.push({
      id: item.id,
      title: item.title,
      artist: item.artist,
      artistId: item.artistId,
      aiDisclosureLevel: item.aiDisclosure?.level ?? null,
      release: {
        genre: item.genre,
        title: item.releaseTitle,
        moods: item.moods,
        artistDisplayName: item.artist,
      },
      // Rail order is the ranking here; the policy keeps input order.
      score: 0,
      signals: [],
      explanation,
      reasonCode,
      recentlyPlayed: false,
      item,
    });
  }
  // No verified-human set: nothing here is relabeled a discovery pick.
  const { items: policed } = applyDiscoveryPolicy(candidates, {
    limit: size,
    tastePolicy,
    maxPerArtist: ARTIST_CAP_PER_RAIL,
  });
  return policed.map((entry) => {
    used.add(entry.id);
    return {
      ...entry.item,
      artworkMimeType: entry.item.artworkMimeType ?? null,
      artworkRevision: entry.item.artworkRevision ?? 1,
      reasonCode: entry.reasonCode,
      explanations: entry.explanation,
    };
  });
}

@Injectable()
export class HomeFeedService {
  private readonly logger = new Logger(HomeFeedService.name);

  constructor(
    private readonly recommendationsService: RecommendationsService,
    @Optional() private readonly discoveryPopularity?: DiscoveryPopularityService,
    @Optional() private readonly tasteMemory?: TasteMemoryService,
  ) {}

  async getHomeFeed(userId: string) {
    const requestId = randomUUID();
    const [preferences, served, playedArtistIds, tastePolicy] = await Promise.all([
      this.recommendationsService.getPreferences(userId),
      this.recommendationsService.getServedHistory(userId),
      this.artistsThePlayerPlays(userId),
      this.loadTastePolicy(userId),
    ]);
    // Every rail passes the policy stage with the same taste policy.
    const applyCaps = (
      kind: HomeFeedRailKind,
      items: RawItem[],
      used: Set<string>,
      size = RAIL_SIZE,
    ) => applyRailPolicy(kind, items, used, tastePolicy, size);

    // Declared taste edits (#1961) reach the rails through
    // `getRecommendations`, which adds boosted genres/moods to its matching and
    // ranking. They deliberately do not count here: a listener whose only
    // declared taste is a boost still sees the honest cold-start rail until
    // they save a preference or press play.
    const hasPreferences = Boolean(
      preferences.genres?.length || preferences.mood?.trim(),
    );
    const cold = !hasPreferences && playedArtistIds.length === 0;

    const rails: HomeFeedRail[] = [];
    const usedTrackIds = new Set<string>();

    if (cold) {
      // RFC §8: "Catalog signal" only for genuinely cold users — and labeled
      // as exactly that, not disguised as personalization.
      const catalogRail = await this.catalogSignalRail(usedTrackIds, applyCaps);
      if (catalogRail) rails.push(catalogRail);
    } else {
      const recommendations = await this.recommendationsService.getRecommendations(
        userId,
        RAIL_SIZE * 3,
      );
      const dominantGenre = this.dominantGenre(
        preferences.genres ?? [],
        preferences.mood,
        recommendations.items,
      );

      const becauseRail = this.becauseGenreRail(
        dominantGenre,
        recommendations.items,
        usedTrackIds,
        applyCaps,
      );
      if (becauseRail) rails.push(becauseRail);

      const artistsRail = await this.newFromArtistsRail(
        playedArtistIds,
        usedTrackIds,
        applyCaps,
      );
      if (artistsRail) rails.push(artistsRail);

      const trendingRail = await this.trendingGenreRail(
        dominantGenre,
        usedTrackIds,
        applyCaps,
      );
      if (trendingRail) rails.push(trendingRail);
    }

    const explorationRail = await this.explorationRail(usedTrackIds, applyCaps);
    if (explorationRail) rails.push(explorationRail);

    // Impression rotation: previously-served items sink to the tail of each
    // rail, and everything rendered now is recorded so the next visit varies.
    for (const rail of rails) {
      rail.items = [
        ...rail.items.filter((item) => !served.includes(item.id)),
        ...rail.items.filter((item) => served.includes(item.id)),
      ];
    }
    await this.recommendationsService.noteServed(
      userId,
      rails.flatMap((rail) => rail.items.map((item) => item.id)),
    );

    // #1455 WS-8: the variant label travels with the response so the web can
    // forward it on served/clicked events. Non-cold feeds already recorded it
    // on the ranker's recommendation.generated; cold feeds skip the ranker, so
    // record their exposure here.
    const variant = discoveryVariantForUser(userId);
    if (cold) {
      this.recommendationsService.publishGenerated({
        userId,
        trackIds: rails.flatMap((rail) => rail.items.map((item) => item.id)),
        strategy: "catalog_signal",
        variant,
      });
    }

    return {
      userId,
      requestId,
      cold,
      rankerVariant: variant.rankerVariant,
      experimentKey: variant.experimentKey,
      rails,
    };
  }

  // -------------------------------------------------------------------------
  // Rails
  // -------------------------------------------------------------------------

  private becauseGenreRail(
    dominantGenre: string | null,
    items: Awaited<ReturnType<RecommendationsService["getRecommendations"]>>["items"],
    used: Set<string>,
    applyCaps: RailCaps,
  ): HomeFeedRail | null {
    if (!dominantGenre) return null;
    const needle = dominantGenre.toLowerCase();
    const matching: RawItem[] = items
      .filter((item) =>
        item.reasons.some((reason) => {
          const [kind, value] = [reason.slice(0, reason.indexOf(":")), reason.slice(reason.indexOf(":") + 1)];
          return (kind === "genre" || kind === "mood") && value.toLowerCase() === needle;
        }),
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        artistId: item.artistId,
        releaseId: item.releaseId,
        releaseTitle: item.releaseTitle,
        genre: item.genre,
        moods: item.moods ?? [],
        aiDisclosure: item.aiDisclosure,
        reasons: item.reasons,
        reasonCode: item.reasonCode,
        explanations: item.explanations,
      }));
    const selected = applyCaps(
      "because_genre",matching, used);
    if (!selected.length) return null;
    return {
      id: "because_genre",
      kind: "because_genre",
      title: `Because you save a lot of ${dominantGenre}`,
      explanation: `Ranked for your ${dominantGenre} taste — from your saved preferences, not your play-by-play history.`,
      items: selected,
    };
  }

  private async newFromArtistsRail(
    playedArtistIds: string[],
    used: Set<string>,
    applyCaps: RailCaps,
  ): Promise<HomeFeedRail | null> {
    if (!playedArtistIds.length) return null;
    const tracks = await prisma.track.findMany({
      where: {
        ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
        release: {
          artistId: { in: playedArtistIds },
          status: { in: ["ready", "published"] },
        },
        explicit: false,
      },
      include: {
        release: {
          select: {
            id: true,
            title: true,
            genre: true,
            moods: true,
            artistId: true,
            artworkMimeType: true,
            artworkRevision: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: RAIL_SIZE * 3,
    });
    const selected = applyCaps(
      "new_from_artists",
      tracks.map((track) => ({
        id: track.id,
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
        moods: track.release.moods ?? [],
        artworkMimeType: track.release.artworkMimeType,
        artworkRevision: track.release.artworkRevision,
        aiDisclosure: toAiDisclosureRecord(track),
        reasons: ["artist:followed-by-plays"],
      })),
      used,
    );
    if (!selected.length) return null;
    return {
      id: "new_from_artists",
      kind: "new_from_artists",
      title: "New from artists you play",
      explanation: "The latest uploads from artists you already listen to.",
      items: selected,
    };
  }

  private async trendingGenreRail(
    dominantGenre: string | null,
    used: Set<string>,
    applyCaps: RailCaps,
  ): Promise<HomeFeedRail | null> {
    if (!dominantGenre || !this.discoveryPopularity) return null;
    const trending = (await this.discoveryPopularity.getTrendingTracks({
      window: "7d",
      genre: dominantGenre,
      limit: RAIL_SIZE * 2,
    })) as { items: Array<Record<string, any>> };
    const selected = applyCaps(
      "trending_genre",
      trending.items.map((item) => ({
        id: item.trackId as string,
        title: item.title as string,
        artist: (item.artist as string) ?? null,
        artistId: item.artistId as string,
        releaseId: item.releaseId as string,
        releaseTitle: item.releaseTitle as string,
        genre: (item.genre as string) ?? null,
        moods: [],
        artworkMimeType: (item.artworkMimeType as string) ?? null,
        artworkRevision: Number(item.artworkRevision ?? 1),
        aiDisclosure: item.aiDisclosure as AiDisclosureRecord,
        reasons: [`trending:${dominantGenre}`],
      })),
      used,
    );
    if (!selected.length) return null;
    return {
      id: "trending_genre",
      kind: "trending_genre",
      title: `Trending in ${dominantGenre}`,
      explanation: `What listeners across Resonate are actually playing in ${dominantGenre} right now.`,
      items: selected,
    };
  }

  private async explorationRail(
    used: Set<string>,
    applyCaps: RailCaps,
  ): Promise<HomeFeedRail | null> {
    const count = explorationCount();
    if (!count) return null;
    // Fresh AND low-data: newest public tracks with no popularity row yet —
    // the items a taste-driven feed would otherwise never surface.
    const fresh = await prisma.track.findMany({
      where: {
        ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
        release: { status: { in: ["ready", "published"] } },
        explicit: false,
        id: { notIn: [...used] },
      },
      include: {
        release: {
          select: {
            id: true,
            title: true,
            genre: true,
            moods: true,
            artistId: true,
            artworkMimeType: true,
            artworkRevision: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: count * 5,
    });
    const popular = new Set(
      (
        await prisma.trackPopularity.findMany({
          where: { trackId: { in: fresh.map((track) => track.id) } },
          select: { trackId: true },
        })
      ).map((row) => row.trackId),
    );
    const selected = applyCaps(
      "exploration",
      fresh
        .filter((track) => !popular.has(track.id))
        .map((track) => ({
          id: track.id,
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
          moods: track.release.moods ?? [],
          artworkMimeType: track.release.artworkMimeType,
          artworkRevision: track.release.artworkRevision,
          aiDisclosure: toAiDisclosureRecord(track),
          reasons: ["exploration:fresh"],
        })),
      used,
      count,
    );
    if (!selected.length) return null;
    return {
      id: "exploration",
      kind: "exploration",
      title: "Step outside your lanes",
      explanation: "Fresh, under-the-radar drops with almost no plays yet — be the first ear.",
      items: selected,
    };
  }

  private async catalogSignalRail(
    used: Set<string>,
    applyCaps: RailCaps,
  ): Promise<HomeFeedRail | null> {
    // Cold users: overall trending when the data supports it, labeled as a
    // catalog-wide signal — never presented as personalization.
    const trending = this.discoveryPopularity
      ? ((await this.discoveryPopularity.getTrendingTracks({
          window: "7d",
          limit: RAIL_SIZE * 2,
        })) as { items: Array<Record<string, any>> })
      : { items: [] };
    const selected = applyCaps(
      "catalog_signal",
      trending.items.map((item) => ({
        id: item.trackId as string,
        title: item.title as string,
        artist: (item.artist as string) ?? null,
        artistId: item.artistId as string,
        releaseId: item.releaseId as string,
        releaseTitle: item.releaseTitle as string,
        genre: (item.genre as string) ?? null,
        moods: [],
        artworkMimeType: (item.artworkMimeType as string) ?? null,
        artworkRevision: Number(item.artworkRevision ?? 1),
        aiDisclosure: item.aiDisclosure as AiDisclosureRecord,
        reasons: ["catalog:trending"],
      })),
      used,
    );
    if (!selected.length) return null;
    return {
      id: "catalog_signal",
      kind: "catalog_signal",
      title: "Catalog signal",
      explanation:
        "We don't know your taste yet — this is what listeners across Resonate are playing. Save a genre or press play and this page gets personal.",
      items: selected,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Fails open: without taste memory, rule 1 has nothing to hide. */
  private async loadTastePolicy(
    userId: string,
  ): Promise<TasteMemoryPolicy | undefined> {
    if (!this.tasteMemory) return undefined;
    try {
      return await this.tasteMemory.getPolicy(userId);
    } catch (error) {
      this.logger.warn(`Taste memory unavailable for Home rails: ${String(error)}`);
      return undefined;
    }
  }

  /** Preference genres first, else the most frequent reason genre/mood. */
  private dominantGenre(
    genres: string[],
    mood: string | undefined,
    items: Array<{ reasons: string[] }>,
  ): string | null {
    if (genres.length) return genres[0];
    if (mood?.trim()) return mood.trim();
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const reason of item.reasons) {
        if (reason.startsWith("genre:") || reason.startsWith("mood:")) {
          const value = reason.slice(reason.indexOf(":") + 1);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top?.[0] ?? null;
  }

  /**
   * Distinct artists from the listener's own playback facts. Used only to
   * SELECT catalog rows server-side — item history never leaves the backend.
   */
  private async artistsThePlayerPlays(userId: string): Promise<string[]> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventName: { in: ["playback.completed", "playback.started"] },
        actorId: userId,
      },
      select: { payload: true },
      orderBy: { occurredAt: "desc" },
      take: 300,
    });
    const trackIds = new Set<string>();
    for (const event of events) {
      const trackId = (event.payload as Record<string, unknown> | null)?.trackId;
      if (typeof trackId === "string") trackIds.add(trackId);
    }
    if (!trackIds.size) return [];
    const tracks = await prisma.track.findMany({
      where: { id: { in: [...trackIds] } },
      select: { release: { select: { artistId: true } } },
    });
    return [...new Set(tracks.map((track) => track.release.artistId))];
  }
}
