/**
 * #1456 WS-9: the filter-only policy step for LLM runtime picks
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
  } = {},
) {
  const policyContext = {
    loadTrackCandidates: jest
      .fn()
      .mockResolvedValue(new Map(catalog.map((candidate) => [candidate.id, candidate]))),
    artistIdsForTracks: jest
      .fn()
      .mockResolvedValue(new Map(Object.entries(options.sessionArtists ?? {}))),
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
  const ranking = new DiscoveryRankingService();
  const service = new AgentRuntimePolicyService(
    ranking,
    policyContext as any,
    tasteMemory as any,
    learning as any,
  );
  return { service, policyContext, ranking };
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

  it("never labels a model pick a discovery pick (no exploration slot for LLM picks)", async () => {
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
      policy: { dropped: { hidden: 0, aiGenerated: 1, diversity: 0, unknown: 0 } },
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

  it("passes through untouched when the ranking core is not wired", async () => {
    const service = new AgentRuntimePolicyService();
    const original = { status: "approved" as const, picks: [pick("x")] };
    expect(await service.apply(baseInput(), original)).toBe(original);
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
