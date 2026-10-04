/**
 * #1456 WS-9: the policy step for LLM runtime picks
 * (`AgentRuntimePolicyService`, reached through `AgentRuntimeService.run`).
 * Pure unit tests: the track-metadata lookup is stubbed (its Prisma query is
 * covered in agent_runtime_policy.integration.spec.ts).
 */
import { DISCOVERY_EXPLANATIONS } from "../modules/recommendations/discovery-explanations";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import type { DiscoveryCandidate } from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";
import { AgentRuntimePolicyService } from "../modules/agents/agent_runtime.policy.service";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { normalizeAgentRuntimeResult } from "../modules/agents/agent_runtime.types";
import type { AgentRuntimeInput } from "../modules/agents/runtime/agent_runtime.adapter";

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

function track(
  id: string,
  options: {
    artistId?: string;
    genre?: string;
    moods?: string[];
    ai?: string;
    artist?: string;
  } = {},
): DiscoveryCandidate {
  return {
    id,
    title: id,
    artist: options.artist ?? null,
    artistId: options.artistId ?? `artist-${id}`,
    aiDisclosureLevel: options.ai ?? "NONE",
    release: {
      genre: options.genre ?? "House",
      title: `${id} release`,
      moods: options.moods ?? [],
      artistDisplayName: options.artist ?? null,
    },
  };
}

const pick = (trackId: string) => ({
  trackId,
  licenseType: "personal" as const,
  priceUsd: 0.05,
});

const freshCandidate = (id: string, releaseId: string, artistId: string) => ({
  id,
  releaseId,
  aiDisclosureLevel: "NONE",
  release: { artistId },
});

const baseInput = (overrides: Partial<AgentRuntimeInput> = {}): AgentRuntimeInput => ({
  sessionId: "s1",
  userId: "u1",
  recentTrackIds: [],
  budgetRemainingUsd: 5,
  preferences: { genres: ["House"] },
  ...overrides,
});

function serviceFor(
  catalog: DiscoveryCandidate[],
  options: {
    policy?: TasteMemoryPolicy;
    sessionArtists?: Record<string, string>;
    profileWeights?: Record<string, number>;
    verifiedArtists?: string[];
    playedArtists?: string[];
    /** Prior discovery picks in the session; an Error makes the count unknown. */
    priorDiscoveryPicks?: number | Error;
    /** What the deterministic selector returns as its shortlist. */
    selectorPicks?: Array<{
      id: string;
      artistId: string;
      reasonCode: string;
      releaseId?: string;
      firstListenerEligible?: boolean;
      genre?: string;
      audioFeatures?: Record<string, unknown>;
    }>;
    /** Per-track audio features the feature service returns (#2037). */
    audioFeatures?: Record<string, Record<string, unknown>>;
    /** Authoritative fresh-source matches for known model or fallback picks. */
    freshCandidates?: Array<{
      id: string;
      releaseId: string;
      aiDisclosureLevel?: string;
      release: { artistId: string };
    }>;
    reservedReleaseIds?: string[];
    firstListenerLookupError?: Error;
    firstListenerReservationError?: Error;
    selectorFreshCandidates?: Array<{
      id: string;
      releaseId: string;
      aiDisclosureLevel?: string;
      release: { artistId: string };
    }>;
  } = {},
) {
  const policyContext = {
    loadTrackCandidates: jest
      .fn()
      .mockResolvedValue(new Map(catalog.map((candidate) => [candidate.id, candidate]))),
    artistIdsForTracks: jest
      .fn()
      .mockResolvedValue(new Map(Object.entries(options.sessionArtists ?? {}))),
    loadContext: jest.fn().mockResolvedValue({
      verifiedHumanArtistIds: new Set(options.verifiedArtists ?? []),
      playedArtistIds: new Set(options.playedArtists ?? []),
    }),
    countDiscoveryPicks:
      options.priorDiscoveryPicks instanceof Error
        ? jest.fn().mockRejectedValue(options.priorDiscoveryPicks)
        : jest.fn().mockResolvedValue(options.priorDiscoveryPicks ?? 0),
  };
  const selector = {
    select: jest.fn().mockResolvedValue({
      selected: (options.selectorPicks ?? []).map((entry) => ({
        id: entry.id,
        releaseId: entry.releaseId,
        firstListenerEligible: entry.firstListenerEligible ?? false,
        release: { artistId: entry.artistId, genre: entry.genre, moods: [] },
        agentRecommendation: {
          audioFeatures: entry.audioFeatures,
          score: 30,
          matchedQueries: [],
          signals: [],
          explanation: [DISCOVERY_EXPLANATIONS.discovery_pick],
          reasonCode: entry.reasonCode,
        },
      })),
    }),
  };
  const tasteMemory = {
    getPolicy: jest.fn().mockResolvedValue(options.policy),
    canUseTasteForSocialMatching: jest.fn().mockResolvedValue(false),
  };
  const learning = options.profileWeights
    ? {
        resolveTasteProfile: jest.fn().mockResolvedValue({
          genreWeights: options.profileWeights,
          favoredGenres: Object.keys(options.profileWeights),
        }),
      }
    : undefined;
  const firstListenerDiscovery = options.firstListenerLookupError || options.freshCandidates || options.selectorFreshCandidates
    ? {
        getFreshCandidates: jest.fn(async ({ trackIds }: { trackIds?: string[] }) => {
          if (options.firstListenerLookupError) throw options.firstListenerLookupError;
          const source = trackIds
            ? [...(options.freshCandidates ?? []), ...(options.selectorFreshCandidates ?? [])]
                .filter((candidate) => trackIds.includes(candidate.id))
            : options.freshCandidates ?? [];
          return source;
        }),
        reservePlacements: options.firstListenerReservationError
          ? jest.fn().mockRejectedValue(options.firstListenerReservationError)
          : jest.fn().mockResolvedValue(new Set(options.reservedReleaseIds ?? [])),
      }
    : undefined;
  const audioFeatures = options.audioFeatures
    ? {
        getOrCreate: jest.fn(async (trackId: string) =>
          options.audioFeatures![trackId]
            ? { status: "ok", features: options.audioFeatures![trackId] }
            : { status: "failed" },
        ),
      }
    : undefined;
  const ranking = new DiscoveryRankingService();
  const service = new AgentRuntimePolicyService(
    ranking,
    policyContext as any,
    tasteMemory as any,
    learning as any,
    undefined,
    undefined,
    selector as any,
    firstListenerDiscovery as any,
    audioFeatures as any,
  );
  return { service, policyContext, ranking, selector, firstListenerDiscovery, audioFeatures };
}

const ids = (result: { picks?: Array<{ trackId: string }> }) =>
  (result.picks ?? []).map((entry) => entry.trackId);

describe("AgentRuntimePolicyService (LLM picks, rules 1, 2, 4, 5)", () => {
  it("drops a pick of a hidden artist or hidden genre (rule 1)", async () => {
    const { service } = serviceFor(
      [
        track("muted", { artist: "Muted Act" }),
        track("polka", { genre: "Polka" }),
        track("kept"),
      ],
      { policy: tastePolicy({ artist: ["Muted Act"], genre: ["polka"] }) },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("muted"), pick("polka"), pick("kept")],
    });
    expect(ids(result)).toEqual(["kept"]);
    expect(result.policy?.dropped.hidden).toBe(2);
  });

  it("drops a fully AI-generated pick (rule 2)", async () => {
    const { service } = serviceFor([track("ai", { ai: "ALL" }), track("human")]);
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("ai"), pick("human")],
    });
    expect(ids(result)).toEqual(["human"]);
    expect(result.policy?.dropped.aiGenerated).toBe(1);
  });

  it("caps an artist at two picks, keeping the model's earliest (rule 4)", async () => {
    const { service } = serviceFor([
      track("a1", { artistId: "A" }),
      track("a2", { artistId: "A" }),
      track("a3", { artistId: "A" }),
      track("b1", { artistId: "B" }),
    ]);
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("a1"), pick("a2"), pick("a3"), pick("b1")],
    });
    expect(ids(result)).toEqual(["a1", "a2", "b1"]);
    expect(result.policy?.dropped.diversity).toBe(1);
  });

  it("counts the session's earlier artists toward the cap", async () => {
    const { service, policyContext } = serviceFor(
      [track("a-new", { artistId: "A" }), track("b-new", { artistId: "B" })],
      { sessionArtists: { "s-1": "A", "s-2": "A" } },
    );
    const result = await service.apply(
      baseInput({ recentTrackIds: ["s-1", "s-2"] }),
      { status: "approved", picks: [pick("a-new"), pick("b-new")] },
    );
    expect(policyContext.artistIdsForTracks).toHaveBeenCalledWith(["s-1", "s-2"]);
    expect(ids(result)).toEqual(["b-new"]);
  });

  it("keeps the LLM's pick order even when the ranking core scores differently", async () => {
    const { service } = serviceFor(
      [
        track("low", { genre: "Jazz" }), // no taste match: score 0
        track("high", { genre: "House" }), // taste_match: score 40
      ],
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("low"), pick("high")],
    });
    expect(ids(result)).toEqual(["low", "high"]);
    expect(result.picks?.[0].score).toBe(0);
    expect(result.picks?.[1].score).toBe(40);
    // The legacy single-track fields follow the first surviving pick.
    expect(result.trackId).toBe("low");
  });

  it("gives each pick the same signals, explanation and reasonCode the ranking core gives that track", async () => {
    const catalog = [
      track("match", { genre: "House", moods: ["Hype"] }),
      track("nothing", { genre: "Polka" }),
    ];
    const { service, ranking } = serviceFor(catalog, {
      profileWeights: { House: 4 },
    });
    const input = baseInput({
      preferences: { genres: ["House"], mood: "Hype", sessionIntent: "Hype" },
    });
    const result = await service.apply(input, {
      status: "approved",
      picks: [pick("match"), pick("nothing")],
    });

    // What Home/DJ would compute for the same track in the same context.
    const [expected] = await ranking.rank(
      [{ ...catalog[0], matchedQueries: ["House", "Hype"] }],
      {
        originalQueries: ["House", "Hype"],
        expandedQueries: ["House", "Hype"],
        learnedGenreWeights: { House: 4 },
        // The session's mood is a requested term, as the selector passes it (#2059).
        requestedTerms: ["Hype"],
        sessionIntent: { intent: "Hype", mood: "Hype" },
      },
    );
    const first = result.picks![0];
    expect(first.reasonCode).toBe(expected.reasonCode);
    expect(first.explanation).toEqual(expected.explanation);
    expect(first.signals).toEqual(expected.signals);
    expect(first.score).toBe(expected.score);
    expect(first.reasonCode).toBe("taste_match");
    // Every survivor has a non-empty categorical reason (rule 5).
    const second = result.picks![1];
    expect(second.reasonCode).toBe("catalog");
    expect(second.explanation).toEqual([DISCOVERY_EXPLANATIONS.catalog]);
  });

  it("never labels a pick a discovery pick when its artist is not a verified human", async () => {
    const { service } = serviceFor([track("fresh", { artistId: "new-artist" })]);
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("fresh")],
    });
    expect(result.picks?.[0].reasonCode).not.toBe("discovery_pick");
  });

  it("returns the no-pick shape with a clear reason when every pick is dropped", async () => {
    const { service } = serviceFor([track("ai", { ai: "ALL" })]);
    const result = await service.apply(baseInput(), {
      status: "approved",
      trackId: "ai",
      licenseType: "remix",
      priceUsd: 1,
      picks: [pick("ai")],
      reasoning: "because",
      latencyMs: 9,
    });
    expect(result).toEqual({
      status: "rejected",
      reason: "no_policy_eligible_picks",
      reasoning: "because",
      latencyMs: 9,
      policy: {
        dropped: { hidden: 0, aiGenerated: 1, diversity: 0, unknown: 0 },
        exploration: { reserved: 1, served: 0, injected: false },
      },
    });
  });

  it("drops a pick for a track that does not exist", async () => {
    const { service } = serviceFor([track("real")]);
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("invented"), pick("real")],
    });
    expect(ids(result)).toEqual(["real"]);
    expect(result.policy?.dropped.unknown).toBe(1);
  });

  it("handles a legacy single-track result and passes rejections through", async () => {
    const { service } = serviceFor([track("only")]);
    const single = await service.apply(baseInput(), {
      status: "approved",
      trackId: "only",
      licenseType: "commercial",
      priceUsd: 2,
    });
    expect(single.picks).toEqual([
      expect.objectContaining({ trackId: "only", licenseType: "commercial", priceUsd: 2 }),
    ]);
    const rejection = { status: "rejected" as const, reason: "llm_no_track_selected" };
    expect(await service.apply(baseInput(), rejection)).toBe(rejection);
  });

  it("fails open: a metadata lookup error passes the model's picks through", async () => {
    const { service, policyContext } = serviceFor([track("x")]);
    policyContext.loadTrackCandidates.mockRejectedValue(new Error("db down"));
    const original = { status: "approved" as const, picks: [pick("x")] };
    expect(await service.apply(baseInput(), original)).toBe(original);
  });

  it("strips forged discovery annotations when the policy fails open", async () => {
    const { service, policyContext } = serviceFor([track("x")]);
    policyContext.loadTrackCandidates.mockRejectedValue(new Error("db down"));
    const original = {
      status: "approved" as const,
      picks: [
        {
          ...pick("x"),
          score: 100,
          reasonCode: "discovery_pick",
          explanation: [DISCOVERY_EXPLANATIONS.discovery_pick],
          signals: [{ label: "taste_match", weight: 1, reason: "model claim" }],
        },
      ],
    };

    const result = await service.apply(baseInput(), original);

    expect(result).not.toBe(original);
    expect(result.picks).toEqual([
      expect.objectContaining({ trackId: "x", licenseType: "personal", priceUsd: 0.05 }),
    ]);
    expect(result.picks?.[0]).not.toHaveProperty("score");
    expect(result.picks?.[0]).not.toHaveProperty("reasonCode");
    expect(result.picks?.[0]).not.toHaveProperty("explanation");
    expect(result.picks?.[0]).not.toHaveProperty("signals");
    const commerce = normalizeAgentRuntimeResult(result);
    expect(commerce.primaryTrack).not.toHaveProperty("reasonCode");
    expect(commerce.primaryTrack).not.toHaveProperty("explanation");
    expect(commerce.primaryTrack).not.toHaveProperty("signals");
  });

  it("passes through untouched when the ranking core is not wired", async () => {
    const service = new AgentRuntimePolicyService();
    const original = { status: "approved" as const, picks: [pick("x")] };
    expect(await service.apply(baseInput(), original)).toBe(original);
  });
});

describe("AgentRuntimePolicyService exploration share for LLM picks (rule 3)", () => {
  it("labels a qualifying model pick a discovery pick in place, without a swap", async () => {
    const { service, selector } = serviceFor(
      [track("known"), track("fresh", { artistId: "verified-new" })],
      { verifiedArtists: ["verified-new"] },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("known"), pick("fresh")],
    });
    expect(ids(result)).toEqual(["known", "fresh"]);
    expect(result.picks?.[1].reasonCode).toBe("discovery_pick");
    expect(result.picks?.[1].explanation?.[0]).toBe(DISCOVERY_EXPLANATIONS.discovery_pick);
    expect(result.policy?.exploration).toEqual({ reserved: 1, served: 1, injected: false });
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("checks model-picked fresh tracks and reserves only a taste-qualified discovery pick", async () => {
    const { service, firstListenerDiscovery } = serviceFor(
      [track("ordinary"), track("fresh", { artistId: "verified-fresh" })],
      {
        verifiedArtists: ["verified-fresh"],
        freshCandidates: [freshCandidate("fresh", "release-fresh", "verified-fresh")],
        reservedReleaseIds: ["release-fresh"],
      },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("ordinary"), pick("fresh")],
    });

    expect(ids(result)).toEqual(["ordinary", "fresh"]);
    expect(result.picks?.[1].reasonCode).toBe("discovery_pick");
    expect(firstListenerDiscovery?.getFreshCandidates).toHaveBeenCalledWith({
      userId: "u1",
      allowExplicit: false,
      trackIds: ["ordinary", "fresh"],
    });
    expect(firstListenerDiscovery?.reservePlacements).toHaveBeenCalledWith(
      "u1",
      [{ trackId: "fresh", releaseId: "release-fresh" }],
      { allowExplicit: false },
    );
  });

  it("keeps baseline picks when the fresh placement cap denies the model pick", async () => {
    const { service, firstListenerDiscovery } = serviceFor(
      [track("ordinary"), track("fresh", { artistId: "verified-fresh" })],
      {
        verifiedArtists: ["verified-fresh"],
        freshCandidates: [freshCandidate("fresh", "release-fresh", "verified-fresh")],
      },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("ordinary"), pick("fresh")],
    });

    expect(ids(result)).toEqual(["ordinary"]);
    expect(result.picks?.some((entry) => entry.reasonCode === "discovery_pick")).toBe(false);
    expect(firstListenerDiscovery?.reservePlacements).toHaveBeenCalledTimes(1);
  });

  it("never grants fresh discovery when source lookup fails, including selector fallback", async () => {
    const { service, selector, firstListenerDiscovery } = serviceFor(
      [track("fresh", { artistId: "verified-fresh" }), track("ordinary")],
      {
        verifiedArtists: ["verified-fresh"],
        firstListenerLookupError: new Error("fresh source unavailable"),
        selectorPicks: [
          {
            id: "injected-fresh",
            artistId: "verified-injected",
            releaseId: "release-injected",
            firstListenerEligible: true,
            reasonCode: "discovery_pick",
          },
        ],
      },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("fresh"), pick("ordinary")],
    });

    expect(ids(result)).toEqual(["fresh", "ordinary"]);
    expect(result.picks?.some((entry) => entry.reasonCode === "discovery_pick")).toBe(false);
    expect(selector.select).toHaveBeenCalledWith(
      expect.objectContaining({ reserveFirstListenerPlacements: false }),
    );
    expect(firstListenerDiscovery?.reservePlacements).not.toHaveBeenCalled();
  });

  it("removes fresh privilege on reservation failure and keeps ordinary model picks", async () => {
    const { service, firstListenerDiscovery } = serviceFor(
      [track("ordinary"), track("fresh", { artistId: "verified-fresh" })],
      {
        verifiedArtists: ["verified-fresh"],
        freshCandidates: [freshCandidate("fresh", "release-fresh", "verified-fresh")],
        firstListenerReservationError: new Error("reservation unavailable"),
      },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("ordinary"), pick("fresh")],
    });

    expect(ids(result)).toEqual(["ordinary"]);
    expect(result.picks?.some((entry) => entry.reasonCode === "discovery_pick")).toBe(false);
    expect(firstListenerDiscovery?.reservePlacements).toHaveBeenCalledTimes(1);
  });

  it("reserves only the actual fallback replacement, not other selector candidates", async () => {
    const { service, selector, firstListenerDiscovery } = serviceFor(
      [track("ordinary-a"), track("ordinary-b")],
      {
        selectorPicks: [
          {
            id: "injected-a",
            artistId: "verified-a",
            releaseId: "release-a",
            firstListenerEligible: true,
            reasonCode: "discovery_pick",
          },
          {
            id: "injected-b",
            artistId: "verified-b",
            releaseId: "release-b",
            firstListenerEligible: true,
            reasonCode: "discovery_pick",
          },
        ],
        selectorFreshCandidates: [
          freshCandidate("injected-a", "release-a", "verified-a"),
          freshCandidate("injected-b", "release-b", "verified-b"),
        ],
        reservedReleaseIds: ["release-a"],
      },
    );
    const result = await service.apply(
      baseInput({ recentTrackIds: ["prior"] }),
      {
        status: "approved",
        picks: [pick("ordinary-a"), pick("ordinary-b")],
      },
    );

    expect(ids(result)).toEqual(["ordinary-a", "injected-a"]);
    expect(result.picks?.[1]).toMatchObject({ priceUsd: 0, reasonCode: "discovery_pick" });
    expect(selector.select).toHaveBeenCalledWith(
      expect.objectContaining({ reserveFirstListenerPlacements: false }),
    );
    expect(firstListenerDiscovery?.reservePlacements).toHaveBeenCalledTimes(1);
    expect(firstListenerDiscovery?.reservePlacements).toHaveBeenCalledWith(
      "u1",
      [{ trackId: "injected-a", releaseId: "release-a" }],
      { allowExplicit: false },
    );
    expect(firstListenerDiscovery?.getFreshCandidates).toHaveBeenLastCalledWith({
      userId: "u1",
      allowExplicit: false,
      trackIds: ["injected-a"],
    });
  });

  it("never labels or reserves a fully AI-generated model pick as first-listener", async () => {
    const { service, firstListenerDiscovery } = serviceFor(
      [track("fully-ai", { artistId: "verified-ai", ai: "ALL" }), track("ordinary")],
      {
        verifiedArtists: ["verified-ai"],
        freshCandidates: [
          { ...freshCandidate("fully-ai", "release-ai", "verified-ai"), aiDisclosureLevel: "ALL" },
        ],
        reservedReleaseIds: ["release-ai"],
      },
    );
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("fully-ai"), pick("ordinary")],
    });

    expect(ids(result)).toEqual(["ordinary"]);
    expect(result.policy?.dropped.aiGenerated).toBe(1);
    expect(firstListenerDiscovery?.reservePlacements).not.toHaveBeenCalled();
  });

  it("does not label a pick from an artist the listener already played", async () => {
    const { service } = serviceFor([track("known"), track("fresh", { artistId: "v" })], {
      verifiedArtists: ["v"],
      playedArtists: ["v"],
    });
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("known"), pick("fresh")],
    });
    expect(result.picks?.map((entry) => entry.reasonCode)).not.toContain("discovery_pick");
  });

  it("swaps the model's last pick for the selector's discovery pick when none qualifies", async () => {
    const { service, selector } = serviceFor([track("first"), track("second")], {
      selectorPicks: [
        { id: "ranked", artistId: "x", reasonCode: "taste_match" },
        { id: "discover", artistId: "verified-new", reasonCode: "discovery_pick" },
      ],
    });
    const input = baseInput({
      recentTrackIds: ["s-1"],
      preferences: { genres: ["House"], mood: "Calm", sessionIntent: "focus", energy: "low" },
    });
    const result = await service.apply(input, {
      status: "approved",
      picks: [pick("first"), { ...pick("second"), licenseType: "remix" }],
    });

    expect(ids(result)).toEqual(["first", "discover"]);
    expect(result.picks?.[1]).toEqual(
      expect.objectContaining({
        trackId: "discover",
        licenseType: "remix",
        priceUsd: 0,
        reasonCode: "discovery_pick",
        explanation: [DISCOVERY_EXPLANATIONS.discovery_pick],
      }),
    );
    // The model's lead pick stays the primary track.
    expect(result.trackId).toBe("first");
    expect(result.policy?.exploration).toEqual({ reserved: 1, served: 1, injected: true });
    expect(selector.select).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        queries: ["House", "Calm"],
        recentTrackIds: ["s-1"],
        limit: 2,
        sessionIntent: "focus",
        mood: "Calm",
        energy: "low",
      }),
    );
  });

  it("does not swap once the session already had its share of discovery picks", async () => {
    const { service, selector } = serviceFor([track("a"), track("b")], {
      sessionArtists: { "s-1": "p", "s-2": "q" },
      priorDiscoveryPicks: 1,
      selectorPicks: [{ id: "discover", artistId: "v", reasonCode: "discovery_pick" }],
    });
    const result = await service.apply(baseInput({ recentTrackIds: ["s-1", "s-2"] }), {
      status: "approved",
      picks: [pick("a"), pick("b")],
    });
    expect(ids(result)).toEqual(["a", "b"]);
    expect(result.policy?.exploration).toEqual({ reserved: 0, served: 0, injected: false });
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("never swaps a single pick when the session's discovery count is unknown", async () => {
    const { service, selector } = serviceFor([track("only")], {
      priorDiscoveryPicks: new Error("db down"),
      selectorPicks: [{ id: "discover", artistId: "v", reasonCode: "discovery_pick" }],
    });
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("only")],
    });
    expect(ids(result)).toEqual(["only"]);
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("swaps a single pick when the session's discovery count is known and due", async () => {
    const { service } = serviceFor([track("only")], {
      priorDiscoveryPicks: 0,
      selectorPicks: [{ id: "discover", artistId: "v", reasonCode: "discovery_pick" }],
    });
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("only")],
    });
    expect(ids(result)).toEqual(["discover"]);
    expect(result.trackId).toBe("discover");
  });

  it("skips a selector discovery pick that would break the artist cap or repeat a pick", async () => {
    const { service } = serviceFor(
      [track("a1", { artistId: "A" }), track("a2", { artistId: "A" }), track("b1", { artistId: "B" })],
      {
        sessionArtists: { "s-1": "V" },
        selectorPicks: [
          { id: "a1", artistId: "A", reasonCode: "discovery_pick" },
          { id: "v2", artistId: "A", reasonCode: "discovery_pick" },
        ],
      },
    );
    const result = await service.apply(baseInput({ recentTrackIds: ["s-1"] }), {
      status: "approved",
      picks: [pick("a1"), pick("a2"), pick("b1")],
    });
    // a1 is already picked; v2's artist already has a1 and a2 in the batch.
    expect(ids(result)).toEqual(["a1", "a2", "b1"]);
    expect(result.policy?.exploration?.injected).toBe(false);
  });

  it("keeps the model's picks when the selector has no discovery pick or fails", async () => {
    const none = serviceFor([track("a"), track("b")], {
      selectorPicks: [{ id: "c", artistId: "c", reasonCode: "taste_match" }],
    });
    const kept = await none.service.apply(baseInput(), {
      status: "approved",
      picks: [pick("a"), pick("b")],
    });
    expect(ids(kept)).toEqual(["a", "b"]);
    expect(kept.policy?.exploration).toEqual({ reserved: 1, served: 0, injected: false });

    const failing = serviceFor([track("a"), track("b")]);
    failing.selector.select.mockRejectedValue(new Error("catalog down"));
    const passed = await failing.service.apply(baseInput(), {
      status: "approved",
      picks: [pick("a"), pick("b")],
    });
    expect(ids(passed)).toEqual(["a", "b"]);
  });

  it("disables only exploration when its lookups fail", async () => {
    const { service, policyContext, selector } = serviceFor([track("a"), track("ai", { ai: "ALL" })]);
    policyContext.loadContext.mockRejectedValue(new Error("db down"));
    const result = await service.apply(baseInput(), {
      status: "approved",
      picks: [pick("a"), pick("ai")],
    });
    expect(ids(result)).toEqual(["a"]);
    expect(result.policy?.dropped.aiGenerated).toBe(1);
    expect(selector.select).toHaveBeenCalled();
  });
});

describe("AgentRuntimeService choke point", () => {
  const remote = { enabled: false, required: false } as any;

  it("applies the policy step to LLM picks for every caller", async () => {
    const executor = { run: jest.fn().mockResolvedValue({ status: "approved", picks: [pick("a")] }) };
    const policy = { apply: jest.fn().mockResolvedValue({ status: "rejected" }) };
    const service = new AgentRuntimeService(executor as any, remote, policy as any);
    const input = baseInput();

    expect(await service.run(input)).toEqual({ status: "rejected" });
    expect(policy.apply).toHaveBeenCalledWith(input, { status: "approved", picks: [pick("a")] });
    // runCommerce (SessionsService.agentNext) goes through the same path.
    expect((await service.runCommerce(input)).tracks).toEqual([]);
    expect(policy.apply).toHaveBeenCalledTimes(2);
  });

  it("leaves orchestrator results alone: the selector already applied the policy", async () => {
    const orchestrated = { status: "approved", tracks: [] };
    const executor = { run: jest.fn().mockResolvedValue(orchestrated) };
    const policy = { apply: jest.fn() };
    const service = new AgentRuntimeService(executor as any, remote, policy as any);
    expect(await service.run(baseInput())).toBe(orchestrated);
    expect(policy.apply).not.toHaveBeenCalled();
  });

  it("applies it to remote worker results too", async () => {
    const remoteClient = {
      enabled: true,
      required: true,
      run: jest.fn().mockResolvedValue({ status: "approved", picks: [pick("a")] }),
    };
    const policy = { apply: jest.fn().mockResolvedValue({ status: "rejected" }) };
    const service = new AgentRuntimeService({} as any, remoteClient as any, policy as any);
    expect(await service.run(baseInput())).toEqual({ status: "rejected" });
  });
});

describe("AgentRuntimePolicyService session request (#2037, #2059)", () => {
  const soulRequest = { genres: ["Soul"], moods: [], energy: null, bpm: null };

  it("hands the request's terms, tempo and audio features to the ranking without reordering", async () => {
    const { service, ranking } = serviceFor(
      [track("house", { genre: "House" }), track("soul", { genre: "Soul" })],
      { audioFeatures: { soul: { energyBand: "high", tempoBpm: 122 } } },
    );
    const rank = jest.spyOn(ranking, "rank");
    const result = await service.apply(
      baseInput({
        preferences: {
          genres: ["House"],
          sessionGenres: ["Soul"],
          tempoBpm: { min: 120, max: 125 },
          request: soulRequest,
        },
      }),
      { status: "approved", picks: [pick("house"), pick("soul")] },
    );

    const context = rank.mock.calls[0][1];
    expect(context.requestedTerms).toEqual(["Soul"]);
    expect(context.tempoBpm).toEqual({ min: 120, max: 125 });
    expect(context.audioFeaturesByTrack?.get("soul")).toEqual({ energyBand: "high", tempoBpm: 122 });
    expect(context.audioFeaturesByTrack?.has("house")).toBe(false);
    // The model's order is never changed by the request.
    expect(ids(result)).toEqual(["house", "soul"]);
  });

  it("returns request coverage over the final picks", async () => {
    const { service } = serviceFor([track("house", { genre: "House" }), track("soul", { genre: "Soul" })]);
    const result = await service.apply(
      baseInput({ preferences: { genres: ["House"], sessionGenres: ["Soul"], request: soulRequest } }),
      { status: "approved", picks: [pick("house"), pick("soul")] },
    );

    expect(result.requestCoverage).toEqual({
      picks: 2,
      gaps: [{ filter: "genres", matched: 1 }],
    });
  });

  it("reads energy and measured tempo coverage from the audio features", async () => {
    const { service } = serviceFor([track("a"), track("b")], {
      audioFeatures: {
        a: { energyBand: "high", tempoBpm: 122, featureSources: { tempo: "measured" } },
        b: { energyBand: "high", tempoBpm: 122, featureSources: { tempo: "inferred" } },
      },
    });
    const result = await service.apply(
      baseInput({
        preferences: {
          request: { genres: [], moods: [], energy: "high", bpm: { min: 120, max: 125 } },
        },
      }),
      { status: "approved", picks: [pick("a"), pick("b")] },
    );

    expect(result.requestCoverage).toEqual({
      picks: 2,
      gaps: [{ filter: "bpm", matched: 1 }],
    });
  });

  it("omits request coverage without a request", async () => {
    const { service } = serviceFor([track("house", { genre: "House" })]);
    const result = await service.apply(baseInput(), { status: "approved", picks: [pick("house")] });

    expect(result).not.toHaveProperty("requestCoverage");
  });

  it("measures coverage on the swapped-in discovery pick too", async () => {
    const { service } = serviceFor([track("first", { genre: "Soul" }), track("second", { genre: "Soul" })], {
      selectorPicks: [{ id: "discover", artistId: "verified-new", reasonCode: "discovery_pick", genre: "Polka" }],
    });
    const result = await service.apply(
      baseInput({
        recentTrackIds: ["s-1"],
        preferences: { genres: ["Soul"], sessionGenres: ["Soul"], request: soulRequest },
      }),
      { status: "approved", picks: [pick("first"), pick("second")] },
    );

    expect(ids(result)).toEqual(["first", "discover"]);
    expect(result.requestCoverage).toEqual({ picks: 2, gaps: [{ filter: "genres", matched: 1 }] });
  });

  it("omits a track whose audio features fail instead of failing the step", async () => {
    const { service, audioFeatures } = serviceFor([track("a")], { audioFeatures: {} });
    audioFeatures!.getOrCreate.mockRejectedValueOnce(new Error("boom"));
    const result = await service.apply(
      baseInput({ preferences: { request: { genres: [], moods: [], energy: "high", bpm: null } } }),
      { status: "approved", picks: [pick("a")] },
    );

    expect(ids(result)).toEqual(["a"]);
    expect(result.requestCoverage).toEqual({ picks: 1, gaps: [{ filter: "energy", matched: 0 }] });
  });
});

describe("normalizeAgentRuntimeResult with scored picks", () => {
  it("carries reasonCode, explanation, score and signals to the commerce track", () => {
    const result = normalizeAgentRuntimeResult({
      status: "approved",
      picks: [
        {
          ...pick("t1"),
          score: 48,
          explanation: ["Selected vibe match"],
          reasonCode: "taste_match",
          signals: [{ label: "taste_match", weight: 40, reason: "x" }],
        },
      ],
    });
    expect(result.primaryTrack).toEqual(
      expect.objectContaining({
        trackId: "t1",
        score: 48,
        reasonCode: "taste_match",
        explanation: ["Selected vibe match"],
      }),
    );
  });
});
