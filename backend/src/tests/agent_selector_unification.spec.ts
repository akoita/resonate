/**
 * #1456 WS-9: the AI DJ selector runs on the shared ranking core and the shared
 * policy stage (ADR-TE-2, docs/rfc/taste-engine.md §3.4). Pure unit tests: the
 * catalog tool and the lookups the policy needs are stubbed; no database.
 */
import {
  DISCOVERY_EXPLANATIONS,
  primaryReasonFor,
} from "../modules/recommendations/discovery-explanations";
import {
  DiscoveryRankingService,
  SESSION_INTENT_FIT_WEIGHT,
} from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { DeterministicRecommendationAdapter } from "../modules/agents/deterministic_recommendation.adapter";

type Item = {
  id: string;
  title?: string;
  artist?: string | null;
  hasListing?: boolean;
  aiDisclosure?: { level: string };
  release: {
    genre?: string;
    title?: string;
    moods?: string[];
    artistId?: string;
  };
};

function item(id: string, extra: Partial<Item> = {}, release: Item["release"] = {}): Item {
  return {
    id,
    title: id,
    hasListing: false,
    release: { genre: "House", title: `${id} release`, moods: [], ...release },
    ...extra,
  };
}

function tools(items: Item[]) {
  const run = jest.fn().mockResolvedValue({ items });
  return { get: jest.fn().mockReturnValue({ run }), run };
}

function tastePolicy(hidden: Partial<Record<string, string[]>> = {}): TasteMemoryPolicy {
  return {
    settings: {
      socialMatchingEnabled: false,
      citySceneDiscoveryEnabled: false,
      agentPlaybackTrainingEnabled: true,
      recommendationExplanationPreference: "balanced",
      resetAt: null,
    },
    hidden: new Map(
      Object.entries(hidden).map(([type, values]) => [
        type,
        new Set((values ?? []).map((value) => value.toLowerCase())),
      ]),
    ),
    downranked: new Map(),
    boosted: new Map(),
  } as unknown as TasteMemoryPolicy;
}

function selectorWith(
  catalog: Item[],
  options: {
    policy?: TasteMemoryPolicy;
    verified?: string[];
    played?: string[];
    sessionArtists?: Record<string, string>;
    /** Prior discovery picks; `"error"` makes the count lookup throw. */
    priorDiscoveryPicks?: number | "error";
    profileWeights?: Record<string, number>;
    served?: string[];
  } = {},
) {
  const registry = tools(catalog);
  const tasteMemory = options.policy
    ? {
        getPolicy: jest.fn().mockResolvedValue(options.policy),
        canUseTasteForSocialMatching: jest.fn().mockResolvedValue(false),
      }
    : undefined;
  const policyContext = options.verified || options.sessionArtists || options.played
    ? {
        loadContext: jest.fn().mockResolvedValue({
          verifiedHumanArtistIds: new Set(options.verified ?? []),
          playedArtistIds: new Set(options.played ?? []),
        }),
        artistIdsForTracks: jest
          .fn()
          .mockResolvedValue(new Map(Object.entries(options.sessionArtists ?? {}))),
        countDiscoveryPicks:
          options.priorDiscoveryPicks === "error"
            ? jest.fn().mockRejectedValue(new Error("db down"))
            : jest.fn().mockResolvedValue(options.priorDiscoveryPicks ?? 0),
      }
    : undefined;
  const learning = options.profileWeights
    ? {
        resolveTasteProfile: jest.fn().mockResolvedValue({
          genreWeights: options.profileWeights,
          favoredGenres: Object.keys(options.profileWeights),
        }),
      }
    : undefined;
  const recommendations = options.served
    ? { getServedHistory: jest.fn().mockResolvedValue(options.served) }
    : undefined;
  const selector = new AgentSelectorService(
    registry as any,
    new DiscoveryRankingService(),
    undefined,
    undefined,
    tasteMemory as any,
    undefined,
    policyContext as any,
    learning as any,
    recommendations as any,
  );
  return { selector, registry, policyContext, learning, recommendations };
}

const ids = (tracks: Array<{ id: string }>) => tracks.map((track) => track.id);

describe("AI DJ selector on the shared core (#1456 WS-9)", () => {
  describe("policy stage", () => {
    it("drops a hidden artist and never returns fully AI-generated tracks", async () => {
      const { selector } = selectorWith(
        [
          item("hidden-artist", { artist: "Muted Act" }),
          item("fully-ai", { aiDisclosure: { level: "all" } }),
          item("kept"),
        ],
        { policy: tastePolicy({ artist: ["Muted Act"] }) },
      );
      const result = await selector.select({
        userId: "u1",
        queries: ["House"],
        recentTrackIds: [],
      });
      expect(ids(result.selected)).toEqual(["kept"]);
      expect(result.policy?.dropped.hidden).toBe(1);
    });

    it("drops a candidate whose genre or mood the listener hid, even with no artist data", async () => {
      const { selector } = selectorWith(
        [
          item("polka", {}, { genre: "Polka" }),
          item("angry", {}, { moods: ["Angry"] }),
          item("kept"),
        ],
        { policy: tastePolicy({ genre: ["polka"], mood: ["angry"] }) },
      );
      const result = await selector.select({ userId: "u1", recentTrackIds: [] });
      expect(ids(result.selected)).toEqual(["kept"]);
    });

    it("caps an artist at two tracks per page", async () => {
      const { selector } = selectorWith([
        item("a1", {}, { artistId: "A" }),
        item("a2", {}, { artistId: "A" }),
        item("a3", {}, { artistId: "A" }),
        item("b1", {}, { artistId: "B" }),
      ]);
      const result = await selector.select({
        queries: ["House"],
        recentTrackIds: [],
        limit: 4,
      });
      expect(ids(result.selected)).toEqual(["a1", "a2", "b1"]);
      expect(result.policy?.dropped.diversity).toBe(1);
    });

    it("counts the artists of the session so far toward the cap", async () => {
      const { selector, policyContext } = selectorWith(
        [
          item("a-new", {}, { artistId: "A" }),
          item("b-new", {}, { artistId: "B" }),
        ],
        // Two earlier session tracks were already artist A (newest first).
        { verified: [], sessionArtists: { "s-1": "A", "s-2": "A" } },
      );
      const result = await selector.select({
        userId: "u1",
        queries: ["House"],
        recentTrackIds: ["s-1", "s-2"],
        limit: 2,
      });
      expect(policyContext?.artistIdsForTracks).toHaveBeenCalledWith(["s-1", "s-2"]);
      expect(ids(result.selected)).toEqual(["b-new"]);
    });

    it("reserves an exploration slot for a verified, unplayed artist and labels it", async () => {
      const catalog = [
        item("loved-1", {}, { artistId: "loved", genre: "House" }),
        item("loved-2", {}, { artistId: "loved", genre: "House" }),
        item("fresh", {}, { artistId: "fresh-artist", genre: "House" }),
      ];
      const { selector } = selectorWith(catalog, {
        verified: ["fresh-artist", "loved"],
        played: ["loved"],
      });
      const result = await selector.select({
        userId: "u1",
        queries: ["House"],
        recentTrackIds: [],
        limit: 2,
      });
      expect(ids(result.selected)).toEqual(["loved-1", "fresh"]);
      const pick: any = result.selected[1];
      expect(pick.agentRecommendation.reasonCode).toBe("discovery_pick");
      expect(pick.agentRecommendation.explanation[0]).toBe(
        DISCOVERY_EXPLANATIONS.discovery_pick,
      );
      expect(result.policy?.exploration).toEqual({ reserved: 1, served: 1 });
    });

    describe("exploration share late in a session", () => {
      const recent = Array.from({ length: 12 }, (_, i) => `s-${i + 1}`); // newest first
      const catalog = () => [
        item("loved-1", {}, { artistId: "loved1", genre: "House" }),
        item("loved-2", {}, { artistId: "loved2", genre: "House" }),
        item("loved-3", {}, { artistId: "loved3", genre: "House" }),
        item("fresh-1", {}, { artistId: "fresh1", genre: "House" }),
        item("fresh-2", {}, { artistId: "fresh2", genre: "House" }),
        item("fresh-3", {}, { artistId: "fresh3", genre: "House" }),
        item("fresh-4", {}, { artistId: "fresh4", genre: "House" }),
      ];
      const run = (options: Parameters<typeof selectorWith>[1]) => {
        const built = selectorWith(catalog(), {
          verified: ["fresh1", "fresh2", "fresh3", "fresh4"],
          ...options,
        });
        return {
          ...built,
          result: built.selector.select({
            userId: "u1",
            queries: ["House"],
            recentTrackIds: recent,
            limit: 5,
          }),
        };
      };

      it("counts discovery picks over the same last-9 window the diversity cap uses", async () => {
        const { policyContext, result } = run({ priorDiscoveryPicks: 2 });
        const out = await result;
        expect(policyContext?.countDiscoveryPicks).toHaveBeenCalledWith(
          "u1",
          recent.slice(0, 9),
        );
        // 9 prior + 5 = 14 -> 3 target, 2 already served -> 1 reserved (not 3).
        expect(out.policy?.exploration.reserved).toBe(1);
        expect(
          out.selected.filter(
            (track: any) => track.agentRecommendation.reasonCode === "discovery_pick",
          ),
        ).toHaveLength(1);
      });

      it("reserves nothing when the session already met its share", async () => {
        const { result } = run({ priorDiscoveryPicks: 3 });
        expect((await result).policy?.exploration.reserved).toBe(0);
      });

      it("does not over-reserve when the count is unavailable (fail-safe to unknown, not 0)", async () => {
        const { result } = run({ priorDiscoveryPicks: "error" });
        const out = await result;
        expect(out.policy?.exploration.reserved).toBe(1);
        expect(out.selected).toHaveLength(5);
      });

      it("skips the count for an anonymous caller and keeps the per-page reserve", async () => {
        const built = selectorWith(catalog(), {
          verified: ["fresh1", "fresh2", "fresh3", "fresh4"],
        });
        const out = await built.selector.select({
          queries: ["House"],
          recentTrackIds: recent,
          limit: 5,
        });
        expect(built.policyContext?.countDiscoveryPicks).not.toHaveBeenCalled();
        expect(out.policy?.exploration.reserved).toBe(1);
      });
    });

    it("without policy lookups nothing is labeled discovery (deterministic fallback)", async () => {
      const { selector } = selectorWith([
        item("loved-1", {}, { artistId: "loved" }),
        item("fresh", {}, { artistId: "fresh-artist" }),
      ]);
      const result = await selector.select({
        queries: ["House"],
        recentTrackIds: [],
        limit: 2,
      });
      expect(ids(result.selected)).toEqual(["loved-1", "fresh"]);
      expect(
        result.selected.every(
          (track: any) => track.agentRecommendation.reasonCode !== "discovery_pick",
        ),
      ).toBe(true);
    });

    it("keeps excluding this session's own recent tracks", async () => {
      const { selector } = selectorWith([item("seen"), item("new")]);
      const result = await selector.select({
        queries: ["House"],
        recentTrackIds: ["seen"],
      });
      expect(ids(result.selected)).toEqual(["new"]);
      expect(result.rejected).toEqual([{ trackId: "seen", reason: "recently_played" }]);
      expect(result.candidates).toEqual(expect.arrayContaining(["seen", "new"]));
      expect(result.reason).toBe("ranked_shortlist");
    });

    it("reports a distinct reason when the policy removes everything", async () => {
      const { selector } = selectorWith([item("only", {}, { genre: "Polka" })], {
        policy: tastePolicy({ genre: ["polka"] }),
      });
      const result = await selector.select({ userId: "u1", recentTrackIds: [] });
      expect(result.selected).toEqual([]);
      expect(result.reason).toBe("no_policy_eligible_candidates");
    });
  });

  describe("explanations", () => {
    it("surfaces the shared reasonCode and vocabulary sentences on every pick", async () => {
      const { selector } = selectorWith([item("match")]);
      const matched = await selector.select({ queries: ["House"], recentTrackIds: [] });
      const first: any = matched.selected[0];
      expect(first.agentRecommendation.reasonCode).toBe("taste_match");
      expect(first.agentRecommendation.explanation).toEqual([
        DISCOVERY_EXPLANATIONS.taste_match,
      ]);
      // No taste signal at all still yields a categorical, non-empty reason.
      const bare = await selector.select({ recentTrackIds: [] });
      const second: any = bare.selected[0];
      expect(second.agentRecommendation.reasonCode).toBe("catalog");
      expect(second.agentRecommendation.explanation).toEqual([
        DISCOVERY_EXPLANATIONS.catalog,
      ]);
    });
  });

  describe("session intent as ranking context", () => {
    const catalog = [
      item("calm", {}, { moods: ["Chill"], genre: "Ambient" }),
      item("loud", {}, { moods: ["Hype"], genre: "Bass" }),
    ];

    it("changes the order of the same candidates", async () => {
      const hype = await selectorWith(catalog).selector.select({
        recentTrackIds: [],
        sessionIntent: "Hype",
      });
      const chill = await selectorWith(catalog).selector.select({
        recentTrackIds: [],
        sessionIntent: "Chill",
      });
      expect(ids(hype.selected)).toEqual(["loud", "calm"]);
      expect(ids(chill.selected)).toEqual(["calm", "loud"]);
      const top: any = hype.selected[0];
      expect(top.agentRecommendation.reasonCode).toBe("session_fit");
      expect(top.agentRecommendation.explanation).toContain(
        DISCOVERY_EXPLANATIONS.session_fit,
      );
      expect(top.agentRecommendation.signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "session_intent_fit",
            weight: SESSION_INTENT_FIT_WEIGHT,
          }),
        ]),
      );
    });

    it("is context only: without an intent nothing is boosted", async () => {
      const result = await selectorWith(catalog).selector.select({ recentTrackIds: [] });
      expect(
        result.selected.flatMap((track: any) =>
          track.agentRecommendation.signals.map((signal: any) => signal.label),
        ),
      ).not.toContain("session_intent_fit");
    });

    it("reaches the selector from the deterministic adapter's preferences", async () => {
      const selector = {
        select: jest.fn().mockResolvedValue({
          candidates: [],
          selected: [],
          rejected: [],
          reason: "x",
        }),
      };
      await new DeterministicRecommendationAdapter(selector as any).recommend({
        sessionId: "s",
        userId: "u",
        recentTrackIds: [],
        budgetRemainingUsd: 1,
        preferences: { mood: "Hype", sessionIntent: "Hype", queueStyle: "Fast cuts" },
        limit: 3,
      });
      expect(selector.select).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionIntent: "Hype",
          mood: "Hype",
          queueStyle: "Fast cuts",
        }),
      );
    });
  });

  describe("session intent in the shared ranking core", () => {
    const ranking = new DiscoveryRankingService();
    const base = (id: string, moods: string[]) => ({
      id,
      title: id,
      release: { genre: "House", title: "R", moods },
      matchedQueries: [] as string[],
    });
    const context = { originalQueries: [], expandedQueries: [] };

    it("matches intent or mood case-insensitively against moods, genre and titles", async () => {
      const [a, b, c, none] = await ranking.rank(
        [
          base("a", ["Hype"]),
          { ...base("b", []), title: "Late HYPE Night" },
          { ...base("c", []), release: { genre: "hype-house", title: "R", moods: [] } },
          base("none", ["Chill"]),
        ],
        { ...context, sessionIntent: { intent: "hype" } },
      );
      for (const entry of [a, b, c]) {
        expect(entry.score).toBe(SESSION_INTENT_FIT_WEIGHT);
        expect(entry.reasonCode).toBe("session_fit");
      }
      expect(none.score).toBe(0);
    });

    it("fires once when intent and mood coincide and never beats a taste match", async () => {
      const [entry] = await ranking.rank(
        [{ ...base("a", ["Hype"]), matchedQueries: ["House"] }],
        {
          originalQueries: ["House"],
          expandedQueries: ["House"],
          sessionIntent: { intent: "Hype", mood: "Hype" },
        },
      );
      expect(
        entry.signals.filter((signal) => signal.label === "session_intent_fit"),
      ).toHaveLength(1);
      expect(entry.reasonCode).toBe("taste_match");
    });

    it("keeps reasonCode precedence: the heavier explainable signal wins", () => {
      expect(
        primaryReasonFor([
          { label: "session_intent_fit", weight: 12, reason: "x" },
          { label: "semantic_similarity", weight: 8, reason: "x" },
        ]),
      ).toBe("session_fit");
      expect(
        primaryReasonFor([
          { label: "session_intent_fit", weight: 12, reason: "x" },
          { label: "learned_preference", weight: 14, reason: "x" },
        ]),
      ).toBe("learned_taste");
    });

    it("carries queueStyle without matching it against track metadata", async () => {
      const [entry] = await ranking.rank([base("a", ["Stable pacing"])], {
        ...context,
        sessionIntent: { queueStyle: "Stable pacing" },
      });
      expect(entry.score).toBe(0);
    });
  });

  describe("one taste profile and one served history", () => {
    it("ranks with the shared profile's weights over caller-provided ones", async () => {
      const { selector, learning } = selectorWith(
        [item("jazz", {}, { genre: "Jazz" }), item("house", {}, { genre: "House" })],
        { profileWeights: { House: 9 } },
      );
      const result = await selector.select({
        userId: "u1",
        recentTrackIds: [],
        learnedGenreWeights: { Jazz: 9 },
      });
      expect(learning?.resolveTasteProfile).toHaveBeenCalledWith("u1", [], undefined);
      expect(ids(result.selected)).toEqual(["house", "jazz"]);
    });

    it("falls back to caller weights when no shared profile resolves", async () => {
      const { selector } = selectorWith([
        item("house", {}, { genre: "House" }),
        item("jazz", {}, { genre: "Jazz" }),
      ]);
      const result = await selector.select({
        userId: "u1",
        recentTrackIds: [],
        learnedGenreWeights: { Jazz: 9 },
      });
      expect(ids(result.selected)).toEqual(["jazz", "house"]);
    });

    it("demotes tracks Home already served without excluding them", async () => {
      const { selector, recommendations } = selectorWith(
        [item("served"), item("other")],
        { served: ["served"] },
      );
      const result = await selector.select({
        userId: "u1",
        queries: ["House"],
        recentTrackIds: [],
      });
      expect(recommendations?.getServedHistory).toHaveBeenCalledWith("u1");
      expect(ids(result.selected)).toEqual(["other", "served"]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe("ADR-TE-2 rule 6 in the DJ candidate path", () => {
    it("a listing never orders or boosts DJ picks", async () => {
      const { selector } = selectorWith([
        item("unlisted", { hasListing: false }),
        item("listed", { hasListing: true }),
      ]);
      const result = await selector.select({ queries: ["House"], recentTrackIds: [] });
      expect(ids(result.selected)).toEqual(["unlisted", "listed"]);
    });
  });
});
