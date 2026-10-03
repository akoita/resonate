import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import {
  computeAgentTasteProfileFromSignals,
  AGENT_SIGNAL_WEIGHTS,
  buildAgentSignalMetadata,
  parsePersistedAgentTasteProfile,
} from "../modules/agents/agent_learning.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";

describe("agent learning loop", () => {
  it("weights purchase and playlist signals above lightweight accepts", () => {
    const profile = computeAgentTasteProfileFromSignals([
      { trackId: "track-1", action: "accept", genre: "Lo-fi" },
      { trackId: "track-1b", action: "complete", genre: "Lo-fi" },
      { trackId: "track-2", action: "add_to_playlist", genre: "Lo-fi" },
      { trackId: "track-2b", action: "save", genre: "Lo-fi" },
      { trackId: "track-3", action: "purchase", genre: "Deep House" },
      { trackId: "track-4", action: "skip", genre: "Noise" },
    ], [], new Date("2026-01-01T00:00:00.000Z"), { decay: false });

    expect(AGENT_SIGNAL_WEIGHTS.purchase).toBe(5);
    expect(AGENT_SIGNAL_WEIGHTS.complete).toBe(1.5);
    expect(AGENT_SIGNAL_WEIGHTS.save).toBe(3);
    expect(AGENT_SIGNAL_WEIGHTS.loop).toBe(2.5);
    expect(AGENT_SIGNAL_WEIGHTS.unsave).toBe(-2);
    expect(profile.signals).toBe(6);
    expect(profile.positiveSignals).toBe(5);
    expect(profile.negativeSignals).toBe(1);
    expect(profile.favoredGenres[0]).toBe("Lo-fi");
    expect(profile.genreWeights["Lo-fi"]).toBe(8.5);
    expect(profile.genreWeights.Noise).toBe(-1);
    expect(profile.score).toBeGreaterThan(30);
    expect(profile.schemaVersion).toBe("agent-taste-profile/v2");
  });

  it("decays behavioral and commitment weights by their separate half-lives", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const profile = computeAgentTasteProfileFromSignals([
      { trackId: "behavior", action: "accept", genre: "Behavior", createdAt: new Date(now.getTime() - 60 * 86400000) },
      { trackId: "purchase", action: "purchase", genre: "Purchase", createdAt: new Date(now.getTime() - 365 * 86400000) },
      { trackId: "pledge", action: "pledge", weight: 4, genre: "Pledge", createdAt: new Date(now.getTime() - 365 * 86400000) },
      { trackId: "invalid", action: "historical_action", weight: Number.NaN, genre: "Invalid" },
    ], [], now);

    expect(profile.genreWeights).toEqual({
      Behavior: 0.5,
      Purchase: 2.5,
      Pledge: 2,
    });
    expect(profile.signals).toBe(3);
    expect(profile.schemaVersion).toBe("agent-taste-profile/v2");
  });

  it("uses safe measured feature bands and builds global and contextual dimensions", () => {
    const profile = computeAgentTasteProfileFromSignals([
      {
        trackId: "measured",
        action: "accept",
        genre: "Deep House",
        moods: ["Focus", "Dreamy"],
        artists: ["Learning Artist", "Guest Producer"],
        localHourBucket: "night",
        weekdayKind: "weekday",
        audioFeatures: {
          energy: 0.8,
          energySource: "measured",
          tempoBpm: 128,
          tempoSource: "measured",
        },
      },
      {
        trackId: "inferred",
        action: "accept",
        genre: "Ambient",
        audioFeatures: {
          energy: 0.99,
          energySource: "inferred",
          tempoBpm: 180,
          tempoSource: "inferred",
        },
      },
    ], [], new Date("2026-01-01T00:00:00.000Z"), { decay: false });

    expect(profile.moodWeights).toEqual({ Dreamy: 1, Focus: 1 });
    expect(profile.artistWeights).toEqual({ "Guest Producer": 1, "Learning Artist": 1 });
    expect(profile.energyBandWeights).toEqual({ high: 1 });
    expect(profile.tempoBandWeights).toEqual({ fast: 1 });
    expect(profile.contextWeights).toEqual({
      "night:weekday": {
        genreWeights: { "Deep House": 1 },
        moodWeights: { Dreamy: 1, Focus: 1 },
      },
    });
  });

  it("applies controls independently and excludes hidden genres or artists as whole signals", () => {
    const policy = {
      hidden: new Map([
        ["genre", new Set(["noise"])],
        ["artist", new Set(["blocked artist", "canonical artist"])],
        ["mood", new Set(["sad"])],
      ]),
      downranked: new Map([
        ["genre", new Set(["dance"])],
        ["artist", new Set(["canonical downrank"])],
      ]),
      boosted: new Map([["artist", new Set(["boosted display"])]]),
    } as unknown as TasteMemoryPolicy;
    const profile = computeAgentTasteProfileFromSignals([
      {
        trackId: "downranked",
        action: "accept",
        genre: "Dance",
        moods: ["Sad", "Bright"],
        artists: ["Available Artist"],
        localHourBucket: "evening",
        weekdayKind: "weekend",
        audioFeatures: { energy: 0.5, energySource: "measured" },
      },
      { trackId: "hidden-genre", action: "accept", genre: "Noise", moods: ["Bright"], artists: ["Another Artist"] },
      { trackId: "hidden-artist", action: "accept", genre: "Jazz", moods: ["Bright"], artists: ["Blocked Artist"] },
      {
        trackId: "hidden-canonical-artist",
        action: "accept",
        genre: "Rock",
        artists: ["Display Credit"],
        artistAliases: { "Display Credit": ["Canonical Artist"] },
      },
      {
        trackId: "downranked-canonical-artist",
        action: "accept",
        genre: "Artist Alias",
        artists: ["Boosted Display"],
        artistAliases: { "Boosted Display": ["Canonical Downrank"] },
      },
    ], [], new Date("2026-01-01T00:00:00.000Z"), { policy, decay: false });

    expect(profile.signals).toBe(2);
    expect(profile.genreWeights).toEqual({ "Artist Alias": 1, Dance: 0.35 });
    expect(profile.artistWeights).toEqual({ "Available Artist": 1, "Boosted Display": 0.35 });
    expect(profile.moodWeights).toEqual({ Bright: 1 });
    expect(profile.energyBandWeights).toEqual({ medium: 1 });
    expect(profile.contextWeights).toEqual({
      "evening:weekend": {
        genreWeights: { Dance: 0.35 },
        moodWeights: { Bright: 1 },
      },
    });
    expect(profile.genreWeights).not.toHaveProperty("Noise");
    expect(profile.moodWeights).not.toHaveProperty("Sad");
  });

  it("applies boosts independently to global and contextual dimensions", () => {
    const policy = {
      hidden: new Map(),
      downranked: new Map(),
      boosted: new Map([
        ["genre", new Set(["boosted genre"])],
        ["mood", new Set(["boosted mood"])],
        ["artist", new Set(["canonical artist"])],
        ["energy", new Set(["medium"])],
      ]),
    } as unknown as TasteMemoryPolicy;
    const profile = computeAgentTasteProfileFromSignals([
      {
        trackId: "boosted",
        action: "accept",
        genre: "Boosted Genre",
        moods: ["Boosted Mood"],
        artists: ["Display Credit"],
        artistAliases: { "Display Credit": ["Canonical Artist"] },
        localHourBucket: "morning",
        weekdayKind: "weekend",
        audioFeatures: { energy: 0.5, energySource: "measured" },
      },
    ], [], new Date("2026-01-01T00:00:00.000Z"), { policy, decay: false });

    expect(profile.genreWeights).toEqual({ "Boosted Genre": 1.5 });
    expect(profile.moodWeights).toEqual({ "Boosted Mood": 1.5 });
    expect(profile.artistWeights).toEqual({ "Display Credit": 1.5 });
    expect(profile.energyBandWeights).toEqual({ medium: 1.5 });
    expect(profile.contextWeights).toEqual({
      "morning:weekend": {
        genreWeights: { "Boosted Genre": 1.5 },
        moodWeights: { "Boosted Mood": 1.5 },
      },
    });
  });

  it("excludes reset history and fallback genres in pure recomputation", () => {
    const resetAt = new Date("2026-01-01T00:00:00.000Z");
    const policy = { resetAt, hidden: new Map(), downranked: new Map(), boosted: new Map() } as unknown as TasteMemoryPolicy;
    const profile = computeAgentTasteProfileFromSignals([
      { trackId: "before", action: "accept", genre: "Before Reset", createdAt: resetAt },
      { trackId: "after", action: "accept", genre: "After Reset", createdAt: new Date(resetAt.getTime() + 1) },
    ], ["Fallback"], new Date(resetAt.getTime() + 2), { policy, decay: false });

    expect(profile.signals).toBe(1);
    expect(profile.genreWeights).toEqual({ "After Reset": 1 });
    expect(profile.genresExplored).toEqual(["After Reset"]);

    const emptyReset = computeAgentTasteProfileFromSignals(
      [],
      ["Fallback"],
      new Date(resetAt.getTime() + 2),
      { policy, decay: false },
    );
    expect(emptyReset).toMatchObject({
      signals: 0,
      genreWeights: {},
      moodWeights: {},
      artistWeights: {},
      energyBandWeights: {},
      tempoBandWeights: {},
      contextWeights: {},
      genresExplored: [],
      favoredGenres: [],
    });
  });

  it("limits pure inputs to the newest 500 signals within the 730-day window", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const current = Array.from({ length: 501 }, (_, index) => ({
      trackId: "recent-" + index,
      action: "accept",
      genre: index === 500 ? "Oldest Recent" : "Recent",
      createdAt: new Date(now.getTime() - index),
    }));
    const profile = computeAgentTasteProfileFromSignals([
      ...current,
      {
        trackId: "outside-window",
        action: "accept",
        genre: "Too Old",
        createdAt: new Date(now.getTime() - 731 * 86400000),
      },
    ], [], now, { decay: false });

    expect(profile.signals).toBe(500);
    expect(profile.genreWeights).toEqual({ Recent: 500 });
    expect(profile.genreWeights).not.toHaveProperty("Oldest Recent");
    expect(profile.genreWeights).not.toHaveProperty("Too Old");
  });

  it("accepts safe v1 and v2 persisted profiles while rejecting malformed v2 dimensions", () => {
    const legacy = {
      schemaVersion: "agent-taste-profile/v1",
      score: 10,
      tier: "Emerging",
      signals: 1,
      positiveSignals: 1,
      negativeSignals: 0,
      acceptanceRate: 1,
      genresExplored: ["House"],
      favoredGenres: ["House"],
      genreWeights: { House: 1 },
      diversity: 0.1,
      depth: 0.1,
      consistency: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(parsePersistedAgentTasteProfile(legacy)?.schemaVersion).toBe("agent-taste-profile/v1");
    expect(parsePersistedAgentTasteProfile({
      ...legacy,
      schemaVersion: "agent-taste-profile/v2",
      contextWeights: { "night:weekday": { genreWeights: { House: 1 }, moodWeights: {} } },
      energyBandWeights: { high: Number.POSITIVE_INFINITY },
    })).toBeNull();
  });

  it("builds bounded privacy-safe signal metadata for intent outcomes", () => {
    const metadata = buildAgentSignalMetadata({
      source: "agent_session",
      sessionIntent: "focus",
      sessionIntentName: "Neural Flow",
      mood: "Focus",
      energy: "low",
      genres: ["Ambient", "Lo-fi", "https://drop.example/private"],
      startSource: "agent_session_intent",
      reasoning: "0x1234567890abcdef should never leak",
      outcome: {
        type: "playback_completed",
        completionRatio: 0.92,
        durationMs: 180000,
      },
    });

    expect(metadata).toEqual({
      schemaVersion: "agent-signal-metadata/v1",
      source: "agent_session",
      sessionIntent: "focus",
      sessionIntentName: "Neural Flow",
      mood: "Focus",
      energy: "low",
      genres: ["Ambient", "Lo-fi"],
      startSource: "agent_session_intent",
      outcome: {
        type: "playback_completed",
        completionRatio: 0.92,
        durationMs: 180000,
      },
    });
  });

  it("keeps a recommendation reasonCode only when it is in the shared vocabulary", () => {
    const valid = buildAgentSignalMetadata({
      source: "agent_next_pick",
      recommendation: {
        score: 52,
        explanation: ["Fits this session intent"],
        reasonCode: "session_fit",
        signals: [{ label: "session_intent_fit", weight: 12, reason: "raw" }],
      },
    });
    expect(valid.recommendation).toEqual({
      score: 52,
      explanation: ["Fits this session intent"],
      reasonCode: "session_fit",
    });

    // A reasonCode alone is enough to keep the recommendation block.
    expect(
      buildAgentSignalMetadata({ recommendation: { reasonCode: "discovery_pick" } })
        .recommendation,
    ).toEqual({ reasonCode: "discovery_pick" });

    // Anything outside DISCOVERY_REASON_CODES (free text, other types) is dropped.
    for (const reasonCode of ["because you listened to Alice", "purchasable", 7, null, {}]) {
      const metadata = buildAgentSignalMetadata({
        recommendation: { score: 10, reasonCode },
      });
      expect(metadata.recommendation).toEqual({ score: 10 });
    }
    expect(
      buildAgentSignalMetadata({ recommendation: { reasonCode: "not_a_code" } })
        .recommendation,
    ).toBeUndefined();
  });

  it("rejects over-limit scalar metadata and bounds arrays before mapping", () => {
    const genres = Array.from({ length: 9 }, (_, index) => `genre-${index}`);
    Object.defineProperty(genres, 8, {
      configurable: true,
      get() {
        throw new Error("entries beyond maxItems must not be mapped");
      },
    });

    const metadata = buildAgentSignalMetadata({
      source: "s".repeat(81),
      sessionIntent: "i".repeat(64),
      genres,
    });

    expect(metadata.source).toBeUndefined();
    expect(metadata.sessionIntent).toBe("i".repeat(64));
    expect(metadata.genres).toEqual([
      "genre-0",
      "genre-1",
      "genre-2",
      "genre-3",
      "genre-4",
      "genre-5",
      "genre-6",
      "genre-7",
    ]);
  });

  it("keeps only bounded playback context enums and identifiers", () => {
    const metadata = buildAgentSignalMetadata({
      localHourBucket: "night",
      weekdayKind: "weekday",
      playbackInstanceId: "playback-instance-1",
      playlistId: "playlist-1",
      repeatMode: "one",
    });
    expect(metadata).toMatchObject({
      localHourBucket: "night",
      weekdayKind: "weekday",
      playbackInstanceId: "playback-instance-1",
      playlistId: "playlist-1",
      repeatMode: "one",
    });

    const invalid = buildAgentSignalMetadata({
      localHourBucket: "10pm",
      weekdayKind: "Monday",
      playbackInstanceId: "instance-".repeat(20),
      playlistId: "https://example.test/playlist",
      repeatMode: "forever",
    });
    expect(invalid).not.toHaveProperty("localHourBucket");
    expect(invalid).not.toHaveProperty("weekdayKind");
    expect(invalid).not.toHaveProperty("playbackInstanceId");
    expect(invalid).not.toHaveProperty("playlistId");
    expect(invalid).not.toHaveProperty("repeatMode");
  });

  it("falls back to user-selected vibes until enough signals exist", () => {
    const profile = computeAgentTasteProfileFromSignals([], ["Focus", "Ambient"]);

    expect(profile.score).toBe(0);
    expect(profile.tier).toBe("New");
    expect(profile.genresExplored).toEqual(["Focus", "Ambient"]);
    expect(profile.favoredGenres).toEqual([]);
  });

  it("ranks by learned genres; an active stem listing never raises a track (ADR-TE-2)", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "jazz", title: "Jazz Track", hasListing: false, release: { genre: "Jazz" } },
          { id: "house", title: "House Track", hasListing: false, release: { genre: "Deep House" } },
          { id: "listed", title: "Listed Track", hasListing: true, release: { genre: "Ambient" } },
        ],
      }),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService());

    const result = await selector.select({
      queries: ["music"],
      recentTrackIds: [],
      learnedGenreWeights: { "Deep House": 10, Jazz: 1 },
      limit: 3,
    });

    // The listed Ambient track only earns the shared query match (40), same as
    // any unlisted track, so it ranks last; selling stems buys no listener rank.
    expect(result.selected.map((track: any) => track.id)).toEqual(["house", "jazz", "listed"]);
    const listed: any = result.selected[2];
    expect(listed.agentRecommendation?.score).toBe(40);
    expect(listed.agentRecommendation?.signals.map((signal: any) => signal.label)).toEqual(["taste_match"]);
    expect(listed.agentRecommendation?.explanation).toEqual(["Selected vibe match"]);
    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "learned_preference" }),
      ]),
    );
  });

  it("keeps fully AI-generated tracks out of AI DJ promotion", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          {
            id: "human",
            title: "Human Track",
            aiDisclosureLevel: "NONE",
            release: { genre: "Ambient" },
          },
          {
            id: "assisted",
            title: "Assisted Track",
            aiDisclosureLevel: "PARTLY",
            release: { genre: "Ambient" },
          },
          {
            id: "generated",
            title: "Generated Track",
            aiDisclosureLevel: "ALL",
            release: { genre: "Ambient" },
          },
        ],
      }),
    };
    const selector = new AgentSelectorService(
      { get: jest.fn().mockReturnValue(tool) } as any,
      new DiscoveryRankingService(),
    );

    const result = await selector.select({
      queries: ["Ambient"],
      recentTrackIds: [],
      limit: 5,
    });

    expect(result.candidates).toEqual(expect.arrayContaining(["human", "assisted"]));
    expect(result.candidates).not.toContain("generated");
    expect(result.selected.map((track: any) => track.id)).not.toContain("generated");
  });

  it("blends precomputed BigQuery taste scores into selector ranking", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "ambient", title: "Ambient Track", hasListing: false, release: { genre: "Ambient" } },
          { id: "techno", title: "Techno Track", hasListing: false, release: { genre: "Techno" } },
        ],
      }),
    };
    const bigQueryTasteSignals = {
      scoreTracks: jest.fn().mockResolvedValue(new Map([
        ["techno", {
          trackId: "techno",
          score: 0.9,
          confidence: 0.8,
          explanation: "strong collaborative taste fit",
          modelVersion: "bqml-mf-v1",
        }],
      ])),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService(), undefined, bigQueryTasteSignals as any);

    const result = await selector.select({
      userId: "user-1",
      queries: ["music"],
      recentTrackIds: [],
      limit: 2,
    });

    expect(bigQueryTasteSignals.scoreTracks).toHaveBeenCalledWith({
      userId: "user-1",
      trackIds: ["ambient", "techno"],
    });
    expect(result.selected.map((track: any) => track.id)).toEqual(["techno", "ambient"]);
    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "bigquery_taste_score",
          weight: 18,
          reason: "strong collaborative taste fit",
        }),
      ]),
    );
    expect(result.selected[0]?.agentRecommendation?.explanation).toContain("Learned listening pattern fit");
    expect(result.selected[0]?.agentRecommendation?.trace).toEqual({
      bigQueryTasteScore: expect.objectContaining({
        trackId: "techno",
        modelVersion: "bqml-mf-v1",
      }),
    });
  });

  it("does not use warehouse taste scores for governed matching when social taste matching is disabled", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "ambient", title: "Ambient Track", hasListing: false, release: { genre: "Ambient" } },
        ],
      }),
    };
    const bigQueryTasteSignals = {
      scoreTracks: jest.fn().mockResolvedValue(new Map()),
    };
    const tasteMemory = {
      getPolicy: jest.fn().mockResolvedValue(undefined),
      canUseTasteForSocialMatching: jest.fn().mockResolvedValue(false),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService(), undefined, bigQueryTasteSignals as any, tasteMemory as any);

    await selector.select({
      userId: "user-1",
      queries: ["music"],
      recentTrackIds: [],
      limit: 1,
    });

    expect(tasteMemory.canUseTasteForSocialMatching).toHaveBeenCalledWith("user-1");
    expect(bigQueryTasteSignals.scoreTracks).not.toHaveBeenCalled();
  });

  it("maps analytics explanations into safe listener-facing reason categories", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "focus", title: "Focus Track", hasListing: false, release: { genre: "Ambient" } },
        ],
      }),
    };
    const bigQueryTasteSignals = {
      scoreTracks: jest.fn().mockResolvedValue(new Map([
        ["focus", {
          trackId: "focus",
          score: 0.8,
          confidence: 0.7,
          explanation: "playlist saves, fewer skips, and Focus session intent",
        }],
      ])),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService(), undefined, bigQueryTasteSignals as any);

    const result = await selector.select({
      userId: "user-1",
      queries: ["music"],
      recentTrackIds: [],
      limit: 1,
    });

    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "bigquery_taste_score",
          reason: "playlist saves, fewer skips, and Focus session intent",
        }),
      ]),
    );
    expect(result.selected[0]?.agentRecommendation?.explanation).toEqual(
      expect.arrayContaining([
        "Fits this session intent",
        "Strong save or purchase signal",
        "Fresh pick based on replay and skip patterns",
      ]),
    );
  });

  it("falls back to generic analytics explanation when warehouse copy is missing", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "quiet", title: "Quiet Track", hasListing: false, release: { genre: "Ambient" } },
        ],
      }),
    };
    const bigQueryTasteSignals = {
      scoreTracks: jest.fn().mockResolvedValue(new Map([
        ["quiet", {
          trackId: "quiet",
          score: 0.7,
        }],
      ])),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService(), undefined, bigQueryTasteSignals as any);

    const result = await selector.select({
      userId: "user-1",
      queries: ["music"],
      recentTrackIds: [],
      limit: 1,
    });

    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "bigquery_taste_score",
          reason: "precomputed warehouse taste fit",
        }),
      ]),
    );
    expect(result.selected[0]?.agentRecommendation?.explanation).toContain("Learned listening pattern fit");
  });

  it("expands common taste vocabulary without falling back to unrelated catalog items", async () => {
    const tool = {
      run: jest.fn().mockImplementation(async (input: { query: string }) => ({
        items: input.query === "rap"
          ? [{ id: "rap-track", title: "Rap Track", hasListing: false, release: { genre: "Rap" } }]
          : [],
      })),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService());

    const result = await selector.select({
      queries: ["Hip Hop"],
      recentTrackIds: [],
      limit: 3,
    });

    expect(tool.run).toHaveBeenCalledWith(expect.objectContaining({ query: "Hip Hop" }));
    expect(tool.run).toHaveBeenCalledWith(expect.objectContaining({ query: "rap" }));
    expect(result.selected.map((track: any) => track.id)).toEqual(["rap-track"]);
    expect(result.selected[0]?.agentRecommendation?.explanation).toContain("Nearby vibe match");
  });

  it("uses joined cohort context as an explainable AI DJ signal", async () => {
    const tool = {
      run: jest.fn().mockImplementation(async (input: { query: string }) => ({
        items: input.query === "dream pop"
          ? [{ id: "dream", title: "Dream Pop Signal", hasListing: false, release: { genre: "Dream Pop" } }]
          : [],
      })),
    };
    const cohortContext = [{
      cohortId: "cohort-1",
      cohortType: "taste",
      reasonCode: "taste:dream_pop",
      title: "Dream Pop listeners",
      explanation: "From your Dream Pop listeners cohort",
      queryHints: ["dream pop"],
      analytics: {
        cohortId: "cohort-1",
        cohortType: "taste",
        reasonCode: "taste:dream_pop",
      },
    }];
    const communityCohortService = {
      getDiscoveryContextForUser: jest.fn().mockResolvedValue(cohortContext),
    };
    const selector = new AgentSelectorService(
      { get: jest.fn().mockReturnValue(tool) } as any,
      new DiscoveryRankingService(),
      undefined,
      undefined,
      undefined,
      communityCohortService as any,
    );

    const result = await selector.select({
      userId: "user-1",
      queries: [],
      recentTrackIds: [],
      limit: 1,
    });

    expect(communityCohortService.getDiscoveryContextForUser).toHaveBeenCalledWith("user-1");
    expect(tool.run).toHaveBeenCalledWith(expect.objectContaining({ query: "dream pop" }));
    expect(result.selected.map((track: any) => track.id)).toEqual(["dream"]);
    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "cohort_context",
          weight: 12,
          reason: "taste:dream_pop",
        }),
      ]),
    );
    expect(result.selected[0]?.agentRecommendation?.explanation).toContain("From your Dream Pop listeners cohort");
    expect(JSON.stringify(result)).not.toContain("user-1");
    expect(JSON.stringify(result)).not.toContain("0x");
  });

  it("returns no selections when original and expanded taste queries miss", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({ items: [] }),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService());

    const result = await selector.select({
      queries: ["Reggaeton"],
      recentTrackIds: [],
      limit: 3,
    });

    expect(result.selected).toEqual([]);
  });

  it("excludes recently played tracks instead of falling back to duplicates", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "recent", title: "Recent Track", hasListing: true, release: { genre: "Techno" } },
        ],
      }),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, new DiscoveryRankingService());

    const result = await selector.select({
      queries: ["Techno"],
      recentTrackIds: ["recent"],
      limit: 3,
    });

    expect(result.selected).toEqual([]);
    expect(result.rejected).toEqual([{ trackId: "recent", reason: "recently_played" }]);
  });
});
