/**
 * #2056: a listening session must not dead-end after one Next Pick on a small
 * catalog. With `fallback`, the selector retries a pass that found nothing:
 * first without the per-session artist window (two per artist per pick stays),
 * then, mid session once the matching tracks are used up, catalog-wide. It
 * never repeats a session track, never relaxes hidden taste or the AI-content
 * rule, and never widens a request the catalog cannot match (ADR-TE-4).
 * Pure unit tests: the catalog tool and the policy lookups are stubbed.
 */
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { DeterministicRecommendationAdapter } from "../modules/agents/deterministic_recommendation.adapter";

type Item = {
  id: string;
  title: string;
  artist?: string | null;
  hasListing: boolean;
  aiDisclosure?: { level: string };
  release: { genre: string; title: string; moods: string[]; artistId?: string };
};

function item(id: string, genre: string, artistId: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    title: id,
    hasListing: false,
    release: { genre, title: `${id} release`, moods: [], artistId },
    ...extra,
  };
}

/** A catalog tool that answers a genre query with that genre, "" with everything. */
function catalogTool(catalog: Item[]) {
  const run = jest.fn(async (input: { query?: string }) => {
    const query = (input.query ?? "").toLowerCase();
    return {
      items: query ? catalog.filter((track) => track.release.genre.toLowerCase().includes(query)) : catalog,
    };
  });
  return { get: jest.fn().mockReturnValue({ run }), run };
}

function hiddenGenres(genres: string[]): TasteMemoryPolicy {
  return {
    settings: {
      socialMatchingEnabled: false,
      citySceneDiscoveryEnabled: false,
      agentPlaybackTrainingEnabled: true,
      recommendationExplanationPreference: "balanced",
      resetAt: null,
    },
    hidden: new Map([["genre", new Set(genres.map((genre) => genre.toLowerCase()))]]),
    downranked: new Map(),
    boosted: new Map(),
  } as unknown as TasteMemoryPolicy;
}

function selectorWith(
  catalog: Item[],
  options: { sessionArtistKeys?: Record<string, string>; policy?: TasteMemoryPolicy } = {},
) {
  const registry = catalogTool(catalog);
  const tasteMemory = options.policy
    ? {
        getPolicy: jest.fn().mockResolvedValue(options.policy),
        canUseTasteForSocialMatching: jest.fn().mockResolvedValue(false),
      }
    : undefined;
  const policyContext = {
    loadContext: jest.fn().mockResolvedValue({
      verifiedHumanArtistIds: new Set<string>(),
      playedArtistIds: new Set<string>(),
    }),
    artistKeysForTracks: jest.fn().mockResolvedValue(new Map(Object.entries(options.sessionArtistKeys ?? {}))),
    countDiscoveryPicks: jest.fn().mockResolvedValue(0),
  };
  const selector = new AgentSelectorService(
    registry as any,
    new DiscoveryRankingService(),
    undefined,
    undefined,
    tasteMemory as any,
    undefined,
    policyContext as any,
  );
  return { selector, registry };
}

const ids = (tracks: Array<{ id: string }>) => tracks.map((track) => track.id);

describe("AI DJ selector fallback when a session runs dry (#2056)", () => {
  it("widens to the whole catalog when every taste match is already in the session", async () => {
    const { selector, registry } = selectorWith([
      item("house-1", "House", "A"),
      item("house-2", "House", "B"),
      item("soul-1", "Soul", "C"),
    ]);
    const input = {
      userId: "u1",
      queries: ["House"],
      recentTrackIds: ["house-1", "house-2"],
      limit: 3,
    };

    const strict = await selector.select(input);
    expect(strict.selected).toEqual([]);

    const result = await selector.select({ ...input, fallback: true });
    expect(ids(result.selected)).toEqual(["soul-1"]);
    expect((result as { fallback?: string }).fallback).toBe("widened");
    // The widened pass asked the catalog for its newest tracks, not only House.
    expect(registry.run).toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
  });

  it("still prefers taste matches when both fresh taste and catalog tracks exist", async () => {
    const { selector } = selectorWith([item("house-new", "House", "A"), item("soul-1", "Soul", "C")]);
    const result = await selector.select({
      userId: "u1",
      queries: ["House"],
      recentTrackIds: [],
      limit: 1,
      fallback: true,
    });
    // The strict pass found a match, so no fallback ran.
    expect(ids(result.selected)).toEqual(["house-new"]);
    expect((result as { fallback?: string }).fallback).toBeUndefined();
  });

  it("drops only the session artist window when one artist fills the catalog", async () => {
    // Every unplayed track is by artist A, and the session already holds two A tracks.
    const { selector } = selectorWith(
      [
        item("a-1", "House", "A"),
        item("a-2", "House", "A"),
        item("a-3", "House", "A"),
        item("a-old-1", "House", "A"),
        item("a-old-2", "House", "A"),
      ],
      { sessionArtistKeys: { "a-old-1": "id:A", "a-old-2": "id:A" } },
    );
    const input = { userId: "u1", queries: ["House"], recentTrackIds: ["a-old-1", "a-old-2"], limit: 5 };

    expect((await selector.select(input)).selected).toEqual([]);

    const result = await selector.select({ ...input, fallback: true });
    // Two per artist per pick still holds, and no session track comes back.
    expect(result.selected).toHaveLength(2);
    expect(ids(result.selected).every((id) => ["a-1", "a-2", "a-3"].includes(id))).toBe(true);
    expect((result as { fallback?: string }).fallback).toBe("relaxed_artist_window");
  });

  it("does not cap distinct credited artists that share one uploading profile (#2092)", async () => {
    const credits = ["T.I.", "Booba", "B.o.B", "Fabolous", "Drake"];
    const { selector } = selectorWith(
      credits.map((artist, index) =>
        item(`h-${index}`, "House", "uploader", { artist }),
      ),
    );
    const result = await selector.select({
      userId: "u1",
      queries: ["House"],
      recentTrackIds: [],
      limit: 5,
    });
    expect(result.selected.length).toBeGreaterThan(2);
    expect(ids(result.selected).sort()).toEqual(
      credits.map((_, index) => `h-${index}`).sort(),
    );
  });

  it("never relaxes hidden taste, AI content or session repeats: an exhausted catalog returns nothing", async () => {
    const { selector } = selectorWith(
      [
        item("played", "House", "A"),
        item("hidden-genre", "Polka", "B"),
        item("fully-ai", "House", "C", { aiDisclosure: { level: "all" } }),
      ],
      { policy: hiddenGenres(["polka"]) },
    );
    const result = await selector.select({
      userId: "u1",
      queries: ["House"],
      recentTrackIds: ["played"],
      fallback: true,
    });
    expect(result.selected).toEqual([]);
    expect((result as { fallback?: string }).fallback).toBeUndefined();
  });

  it("never widens a request nothing in the catalog matches, so the gap stays honest (ADR-TE-4)", async () => {
    const { selector, registry } = selectorWith([item("house-1", "House", "A")]);
    const result = await selector.select({
      userId: "u1",
      queries: ["Polka"],
      recentTrackIds: ["earlier-pick"],
      fallback: true,
    });
    expect(result.selected).toEqual([]);
    expect(result.reason).toBe("no_matching_taste_candidates");
    expect(registry.run).not.toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
  });

  it("never widens at session start: only a session that already played its matches", async () => {
    const { selector } = selectorWith([item("house-1", "House", "A"), item("soul-1", "Soul", "C")]);
    const result = await selector.select({
      userId: "u1",
      queries: ["House"],
      recentTrackIds: [],
      fallback: true,
      limit: 2,
    });
    // House matched at start, so nothing needed widening.
    expect(ids(result.selected)).toEqual(["house-1"]);
  });

  it("is on for listening sessions through the deterministic adapter", async () => {
    const { selector } = selectorWith([item("house-1", "House", "A")]);
    const spy = jest.spyOn(selector, "select");
    const adapter = new DeterministicRecommendationAdapter(selector);
    await adapter.recommend({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      limit: 3,
      preferences: { genres: ["House"] },
    } as any);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fallback: true }));
  });
});
