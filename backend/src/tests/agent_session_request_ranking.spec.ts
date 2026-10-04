/**
 * #2059: what a DJ session asks for (a preset's genres and mood, or a
 * described session) ranks above the listener's learned taste (ADR-TE-2 rule
 * 6, declared beats inferred). Learned favourites and saved vibes still fill
 * the remaining slots. A session without its own request, and Home, rank as
 * before. Pure unit tests: the catalog tool is stubbed; no database.
 */
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import {
  DeterministicRecommendationAdapter,
  requestedTermsFor,
} from "../modules/agents/deterministic_recommendation.adapter";
import type { TasteMemoryPolicy, TasteSignalType } from "../modules/recommendations/taste_memory.service";

type Item = {
  id: string;
  title: string;
  hasListing: boolean;
  release: { genre: string; title: string; moods: string[]; artistId: string };
};

const item = (id: string, genre: string, artistId: string, moods: string[] = []): Item => ({
  id,
  title: id,
  hasListing: false,
  release: { genre, title: `${id} release`, moods, artistId },
});

function selectorWith(catalog: Item[]) {
  const run = jest.fn(async (input: { query?: string }) => {
    const query = (input.query ?? "").toLowerCase();
    return {
      items: query ? catalog.filter((track) => track.release.genre.toLowerCase().includes(query)) : catalog,
    };
  });
  const registry = { get: jest.fn().mockReturnValue({ run }) };
  return new AgentSelectorService(registry as any, new DiscoveryRankingService());
}

const ids = (tracks: Array<{ id: string }>) => tracks.map((track) => track.id);

function emptyTastePolicy(): TasteMemoryPolicy {
  return {
    settings: {} as TasteMemoryPolicy["settings"],
    hidden: new Map<TasteSignalType, Set<string>>(),
    downranked: new Map<TasteSignalType, Set<string>>(),
    boosted: new Map<TasteSignalType, Set<string>>(),
  };
}

const ordinaryRequestPolicyCases: Array<{
  signalType: "genre" | "mood";
  metadataValue: string;
  requestedTerm: string;
  control: "raw" | "canonical";
  controlValue: string;
}> = [
  { signalType: "genre", metadataValue: "Afrobeats", requestedTerm: "Afrobeat", control: "raw", controlValue: "afrobeats" },
  { signalType: "genre", metadataValue: "Afrobeats", requestedTerm: "Afrobeat", control: "canonical", controlValue: "afrobeat" },
  { signalType: "mood", metadataValue: "Warmer", requestedTerm: "Warm", control: "raw", controlValue: "warmer" },
  { signalType: "mood", metadataValue: "Warmer", requestedTerm: "Warm", control: "canonical", controlValue: "warm" },
];

// A listener who mostly plays Pop starts a calm session.
const catalog = [
  item("pop-1", "Pop", "A"),
  item("pop-2", "Pop", "B"),
  item("pop-3", "Pop", "C"),
  item("ambient-1", "Ambient", "D"),
  item("ambient-2", "Ambient", "E", ["Zen"]),
];
const merged = { queries: ["Pop", "Ambient"], learnedGenreWeights: { Pop: 9 }, recentTrackIds: [] as string[] };

describe("AI DJ session request outranks learned taste (#2059)", () => {
  it("ranks the session's requested genre above learned favourites", async () => {
    const result = await selectorWith(catalog).select({
      ...merged,
      userId: "u1",
      limit: 3,
      requestedTerms: ["Ambient", "Zen"],
    });
    expect(ids(result.selected).slice(0, 2).sort()).toEqual(["ambient-1", "ambient-2"]);
    // Learned favourites still fill the remaining slot.
    expect(ids(result.selected)[2]).toMatch(/^pop-/);
    const ambient = result.selected.find((track: any) => track.id === "ambient-1") as any;
    expect(ambient.agentRecommendation.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "session_request", weight: 20 })]),
    );
  });

  it("without a session request, learned taste ranks first as before (and Home never sets one)", async () => {
    const result = await selectorWith(catalog).select({ ...merged, userId: "u1", limit: 2 });
    expect(ids(result.selected).every((id) => id.startsWith("pop-"))).toBe(true);
  });

  it("builds the request from the session's own genres and moods only", () => {
    expect(
      requestedTermsFor({
        genres: ["Pop", "World", "Ambient"],
        sessionGenres: ["Ambient", "ambient"],
        mood: "Zen",
        moods: ["Zen", "Warm"],
      }),
    ).toEqual({ requestedTerms: ["Ambient", "Zen", "Warm"] });
    expect(requestedTermsFor({ genres: ["Pop"] })).toEqual({});
  });

  it("reaches the selector from the deterministic adapter", async () => {
    const selector = selectorWith(catalog);
    const spy = jest.spyOn(selector, "select");
    await new DeterministicRecommendationAdapter(selector).recommend({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      limit: 3,
      preferences: { genres: ["Pop", "Ambient"], sessionGenres: ["Ambient"], mood: "Zen" },
    } as any);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ requestedTerms: ["Ambient", "Zen"] }));
  });

  it("uses a lane-local typed request alone, even when an ordinary term also matches", async () => {
    const [laneMatch, ordinaryOnly] = await new DiscoveryRankingService().rank(
      [
        { id: "lane-match", release: { genre: "Jazz", moods: ["Zen"] } },
        { id: "ordinary-only", release: { genre: "Pop", moods: ["Zen"] } },
      ],
      {
        originalQueries: [],
        expandedQueries: [],
        sessionRequest: { genres: ["Jazz"], moods: [] },
        requestedTerms: ["Zen"],
      },
    );

    const laneRequestSignals = laneMatch.signals.filter((signal) => signal.label === "session_request");
    expect(laneRequestSignals).toEqual([
      { label: "session_request", weight: 20, reason: "matches the current mix request" },
    ]);
    expect(ordinaryOnly.signals.some((signal) => signal.label === "session_request")).toBe(false);
  });

  it.each(ordinaryRequestPolicyCases)(
    "suppresses an ordinary $signalType request hidden by its $control value",
    async ({ signalType, metadataValue, requestedTerm, controlValue }) => {
      const policy = emptyTastePolicy();
      policy.hidden.set(signalType, new Set([controlValue]));
      const release = signalType === "genre" ? { genre: metadataValue } : { moods: [metadataValue] };
      const [track] = await new DiscoveryRankingService().rank(
        [{ id: "request", release }],
        {
          originalQueries: [],
          expandedQueries: [],
          requestedTerms: [requestedTerm],
          tastePolicy: policy,
        },
      );

      expect(track.signals.some((signal) => signal.label === "session_request")).toBe(false);
    },
  );

  it.each(ordinaryRequestPolicyCases)(
    "applies the downrank multiplier to an ordinary $signalType request with $control metadata",
    async ({ signalType, metadataValue, requestedTerm, controlValue }) => {
      const policy = emptyTastePolicy();
      policy.downranked.set(signalType, new Set([controlValue]));
      const release = signalType === "genre" ? { genre: metadataValue } : { moods: [metadataValue] };
      const [track] = await new DiscoveryRankingService().rank(
        [{ id: "request", release }],
        {
          originalQueries: [],
          expandedQueries: [],
          requestedTerms: [requestedTerm],
          tastePolicy: policy,
        },
      );

      expect(track.signals.find((signal) => signal.label === "session_request")?.weight).toBe(7);
    },
  );

  it("keeps ordinary request matches out of lane allocation", async () => {
    const result = await selectorWith([
      item("pop-warm", "Pop", "A", ["Warm"]),
      item("soul-warm", "Soul", "B", ["Warm"]),
    ]).select({
      queries: ["Pop", "Soul", "Warm"],
      requestedTerms: ["Pop"],
      recentTrackIds: [],
      limit: 1,
      myMixPlan: {
        lanes: [{
          id: "lane_warm",
          label: "Warm",
          genreWeights: {},
          moodWeights: { Warm: 1 },
          strength: 1,
          contexts: {},
          energyBand: null,
          requested: 1,
          boost: false,
          addition: false,
          allocationWeight: 1,
        }],
      },
    });

    expect(ids(result.selected)).toEqual(["soul-warm"]);
  });
});
