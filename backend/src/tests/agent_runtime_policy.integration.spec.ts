/**
 * Policy step for LLM runtime picks (#1456 WS-9, ADR-TE-2) — Integration
 * (Testcontainers, real Prisma).
 *
 * `AgentRuntimeService.run` is the choke point both `startSession` and
 * `agentNext` reach. Here the model's picks are a stub; everything else (batched
 * metadata load, ranking core, taste memory, shared profile, Home) is real.
 *
 * Run: TESTCONTAINERS_RYUK_DISABLED=true npm run test:integration -- \
 *        src/tests/agent_runtime_policy.integration.spec.ts
 */

import { prisma } from "../db/prisma";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { AgentRuntimePolicyService } from "../modules/agents/agent_runtime.policy.service";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `rtpol_${Date.now()}_`;
const GENRE = `${P}Afro`;
const HIDDEN_GENRE = `${P}Polka`;
const LISTENER = `${P}listener`;
const A_CROWD = `${P}artist_crowd`;
const A_OTHER = `${P}artist_other`;
const tid = (name: string) => `${P}track_${name}`;

describe("LLM runtime picks through the policy step (integration)", () => {
  const eventBus = new EventBus();
  const tasteMemory = new TasteMemoryService(eventBus);
  const ranking = new DiscoveryRankingService();
  const policyContext = new DiscoveryPolicyContextService();
  const home = new RecommendationsService(
    eventBus,
    ranking,
    tasteMemory,
    undefined,
    undefined,
    policyContext,
  );
  const policy = new AgentRuntimePolicyService(
    ranking,
    policyContext,
    tasteMemory,
    new AgentLearningService(tasteMemory),
    home,
  );
  const llmPicks = (...names: string[]) => ({
    status: "approved" as const,
    reason: "adk_llm",
    picks: names.map((name) => ({
      trackId: name.startsWith(P) ? name : tid(name),
      licenseType: "personal" as const,
      priceUsd: 0.05,
    })),
  });
  const runtime = (picks: ReturnType<typeof llmPicks>) =>
    new AgentRuntimeService(
      { run: jest.fn().mockResolvedValue(picks) } as any,
      { enabled: false, required: false } as any,
      policy,
    );
  const input = {
    sessionId: "s",
    userId: LISTENER,
    recentTrackIds: [] as string[],
    budgetRemainingUsd: 5,
    preferences: { genres: [GENRE] },
  };

  async function seedTrack(
    name: string,
    artistId: string,
    genre: string,
    extra: Record<string, unknown> = {},
  ) {
    await prisma.release.create({
      data: {
        id: `${P}release_${name}`,
        title: `${name} release`,
        artistId,
        status: "published",
        genre,
        moods: ["Warm"],
      },
    });
    await prisma.track.create({
      data: {
        id: tid(name),
        title: `${name} track`,
        releaseId: `${P}release_${name}`,
        position: 1,
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    await prisma.user.create({ data: { id: LISTENER, email: `${LISTENER}@test.resonate` } });
    await prisma.artist.create({ data: { id: A_CROWD, displayName: "Crowd" } });
    await prisma.artist.create({ data: { id: A_OTHER, displayName: "Other" } });
    for (const name of ["c1", "c2", "c3"]) await seedTrack(name, A_CROWD, GENRE);
    await seedTrack("o1", A_OTHER, GENRE, { artist: "Credited Name" });
    await seedTrack("polka", A_OTHER, HIDDEN_GENRE);
    await seedTrack("ai", A_OTHER, GENRE, {
      aiDisclosureLevel: "ALL",
      aiDisclosureSource: "artist",
    });

    // The shared persisted profile: learned weight 4 -> +8 on GENRE tracks.
    await prisma.agentConfig.create({
      data: {
        userId: LISTENER,
        learnedTasteProfile: {
          schemaVersion: "agent-taste-profile/v1",
          score: 40,
          tier: "Emerging",
          signals: 4,
          positiveSignals: 4,
          negativeSignals: 0,
          acceptanceRate: 1,
          genresExplored: [GENRE],
          favoredGenres: [GENRE],
          genreWeights: { [GENRE]: 4 },
          diversity: 0.1,
          depth: 0.1,
          consistency: 1,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    await tasteMemory.upsertSignalControl(LISTENER, {
      signalType: "genre",
      value: HIDDEN_GENRE,
      action: "hidden",
    });
    await home.setPreferences(LISTENER, { genres: [GENRE] });
  });

  afterAll(async () => {
    await prisma.recommendationProfile.deleteMany({ where: { userId: LISTENER } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: LISTENER } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: LISTENER } });
    await prisma.agentConfig.deleteMany({ where: { userId: LISTENER } });
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  });

  it("loads the picked tracks' metadata in one batched query", async () => {
    const map = await policyContext.loadTrackCandidates([
      tid("o1"),
      tid("c1"),
      tid("o1"),
      `${P}no_such_track`,
      "",
    ]);
    expect([...map.keys()].sort()).toEqual([tid("c1"), tid("o1")].sort());
    expect(map.get(tid("o1"))).toEqual({
      id: tid("o1"),
      title: "o1 track",
      artist: "Credited Name",
      artistId: A_OTHER,
      aiDisclosureLevel: "UNDECLARED",
      release: {
        genre: GENRE,
        title: "o1 release",
        moods: ["Warm"],
        // Credited artist (#1492), not the uploader account label.
        artistDisplayName: "Credited Name",
      },
    });
    expect(map.get(tid("c1"))?.release?.artistDisplayName).toBe("Crowd");
    expect((await policyContext.loadTrackCandidates([])).size).toBe(0);
  });

  it("drops hidden-genre, fully AI, over-cap and invented picks and keeps the model's order", async () => {
    const result = await runtime(
      llmPicks("polka", "ai", "c3", "o1", "c2", "c1", `${P}invented`),
    ).run(input);
    const picks = (result as any).picks as Array<{ trackId: string }>;

    // Hidden genre, AI and the invented id are gone; the third Crowd track is
    // over the two-per-artist cap; the rest keep the model's order.
    expect(picks.map((entry) => entry.trackId)).toEqual([tid("c3"), tid("o1"), tid("c2")]);
    expect((result as any).trackId).toBe(tid("c3"));
    expect((result as any).policy.dropped).toEqual({
      hidden: 1,
      aiGenerated: 1,
      diversity: 1,
      unknown: 1,
    });
  });

  it("returns the no-pick shape when nothing survives", async () => {
    const result: any = await runtime(llmPicks("polka", "ai")).run(input);
    expect(result).toMatchObject({ status: "rejected", reason: "no_policy_eligible_picks" });
    expect(result.picks).toBeUndefined();
  });

  it("session mode: earlier session tracks of an artist count toward its cap", async () => {
    const result: any = await runtime(llmPicks("c3", "o1")).run({
      ...input,
      recentTrackIds: [tid("c1"), tid("c2")],
    });
    expect(result.picks.map((entry: any) => entry.trackId)).toEqual([tid("o1")]);
  });

  it("gives a pick the same score, explanation and reasonCode Home gives the same track", async () => {
    // Before Home runs (it records served history and would demote tracks).
    const result: any = await runtime(llmPicks("o1", "c1", "c2")).run(input);
    const homeResult = await home.getRecommendations(LISTENER, 50);

    const common = result.picks.filter((entry: any) =>
      homeResult.items.some((item) => item.id === entry.trackId),
    );
    expect(common.length).toBeGreaterThanOrEqual(2);
    for (const entry of common) {
      const item = homeResult.items.find((candidate) => candidate.id === entry.trackId)!;
      expect(entry.reasonCode).toBe(item.reasonCode);
      expect(entry.explanation).toEqual(item.explanations);
      expect(entry.score).toBe(item.score);
      // taste_match 40 + learned_preference 8 from the shared profile.
      expect(entry.score).toBe(48);
    }
    // The LLM path never relabels a pick as an exploration pick.
    expect(result.picks.map((entry: any) => entry.reasonCode)).not.toContain("discovery_pick");
  });
});
