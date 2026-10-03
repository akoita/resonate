/**
 * Home and the AI DJ on one ranking core (#1456 WS-9, ADR-TE-2) — Integration
 * (Testcontainers, real Prisma).
 *
 * One seeded listener, both surfaces, the same catalog:
 *  - the DJ and Home resolve the SAME freshly computed taste profile (same learned
 *    genre weights, so the same track gets the same score on both);
 *  - both consult the SAME served history (Home writes it, the DJ reads it);
 *  - both pass their output through the shared policy stage (two per artist,
 *    an exploration slot for a verified unplayed artist, no AI-generated
 *    tracks) and expose a `reasonCode` from the shared vocabulary;
 *  - a listener with no persisted profile gets the same computed weights on
 *    both surfaces.
 *
 * Run: TESTCONTAINERS_RYUK_DISABLED=true npm run test:integration -- \
 *        src/tests/discovery_unification.integration.spec.ts
 */

import { prisma } from "../db/prisma";
import { AgentLearningService, resolveAgentTasteProfile } from "../modules/agents/agent_learning.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import {
  DISCOVERY_EXPLANATIONS,
  DISCOVERY_REASON_CODES,
} from "../modules/recommendations/discovery-explanations";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `unif_${Date.now()}_`;
const GENRE = `${P}Afro`;
const LISTENER = `${P}listener`;
const COMPUTED_LISTENER = `${P}computed`;
const VERIFIED_OWNER = `${P}VerifiedOwner`;

const A_CROWD = `${P}artist_crowd`;
const A_NEW = `${P}artist_new`;
const A_PLAYED = `${P}artist_played`;
const A_LATE = `${P}artist_late`;
const tid = (name: string) => `${P}track_${name}`;

const LEARNED_WEIGHT = 4; // -> learned_preference signal of min(18, 4 * 2) = 8
const EXPECTED_SCORE = 40 + 8; // taste_match + learned_preference
const NOW = new Date("2026-06-01T12:00:00.000Z");

describe("Home and the AI DJ on one ranking core (integration)", () => {
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
  const dj = new AgentSelectorService(
    new ToolRegistry(new EmbeddingService(), new EmbeddingStore()),
    ranking,
    undefined,
    undefined,
    tasteMemory,
    undefined,
    policyContext,
    new AgentLearningService(tasteMemory),
    home,
  );

  let djBefore: Awaited<ReturnType<AgentSelectorService["select"]>>;
  /** The two crowd tracks the DJ picked first (catalog order is newest-first). */
  let crowdPicks: string[] = [];
  let homeResult: Awaited<ReturnType<RecommendationsService["getRecommendations"]>>;

  const mine = <T extends { id: string }>(items: T[]) =>
    items.filter((item) => item.id.startsWith(P));
  const byArtist = (items: Array<{ artistId?: string | null }>, artistId: string) =>
    items.filter((item) => item.artistId === artistId);

  async function seedTrack(name: string, artistId: string, extra: Record<string, unknown> = {}) {
    await prisma.release.create({
      data: {
        id: `${P}release_${name}`,
        title: `${name} release`,
        artistId,
        status: "published",
        genre: GENRE,
        moods: [],
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
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
        "queueMicrotask",
        "hrtime",
        "performance",
      ],
    });
    jest.setSystemTime(NOW);
    for (const id of [LISTENER, COMPUTED_LISTENER, VERIFIED_OWNER]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({ data: { id: A_CROWD, displayName: "Crowd" } });
    await prisma.artist.create({
      data: { id: A_NEW, userId: VERIFIED_OWNER, displayName: "Verified New" },
    });
    await prisma.artist.create({ data: { id: A_PLAYED, displayName: "Played" } });
    await prisma.artist.create({ data: { id: A_LATE, displayName: "Late" } });
    await prisma.curatorReputation.create({
      data: {
        walletAddress: VERIFIED_OWNER.toLowerCase(),
        humanVerificationStatus: "human_verified",
        humanVerifiedAt: new Date(),
      },
    });

    for (const name of ["c1", "c2", "c3", "c4"]) await seedTrack(name, A_CROWD);
    await seedTrack("new1", A_NEW);
    await seedTrack("played1", A_PLAYED);

    // A legacy snapshot to upgrade from recorded history; both surfaces now
    // resolve the same freshly computed profile.
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
          genreWeights: { [GENRE]: LEARNED_WEIGHT },
          diversity: 0.1,
          depth: 0.1,
          consistency: 1,
          updatedAt: NOW.toISOString(),
        },
      },
    });
    // Fresh bounded history supersedes the stale v1 snapshot while preserving
    // its weight (purchase +5, playback skip -1). The skip also marks an artist
    // as played so the discovery policy can preserve its existing behavior.
    await prisma.agentSignal.createMany({
      data: [
        {
          userId: LISTENER,
          trackId: tid("played1"),
          action: "skip",
          weight: -1,
          createdAt: NOW,
        },
        {
          userId: LISTENER,
          trackId: tid("c1"),
          action: "purchase",
          weight: 5,
          createdAt: NOW,
        },
      ],
    });
    await home.setPreferences(LISTENER, { genres: [GENRE] });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({
      where: { userId: { in: [LISTENER, COMPUTED_LISTENER] } },
    });
    await prisma.recommendationProfile.deleteMany({
      where: { userId: { in: [LISTENER, COMPUTED_LISTENER] } },
    });
    await prisma.agentConfig.deleteMany({ where: { userId: LISTENER } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.curatorReputation.deleteMany({
      where: { walletAddress: VERIFIED_OWNER.toLowerCase() },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    jest.useRealTimers();
  });

  it("the DJ ranks with the freshly computed taste profile and passes the policy stage", async () => {
    djBefore = await dj.select({
      userId: LISTENER,
      queries: [GENRE],
      recentTrackIds: [],
      limit: 10,
    });
    const picks = djBefore.selected as any[];

    // Learned weights come from recorded history, governed by current controls.
    crowdPicks = picks
      .filter((track) => track.release.artistId === A_CROWD)
      .map((track) => track.id);
    expect(crowdPicks).toHaveLength(2);
    const c1 = picks.find((track) => track.id === crowdPicks[0]);
    expect(c1.agentRecommendation.score).toBe(EXPECTED_SCORE);
    expect(c1.agentRecommendation.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "learned_preference", weight: 8 }),
      ]),
    );

    // Policy: at most two tracks per artist, exploration labeled.
    expect(byArtist(picks.map((t) => ({ artistId: t.release.artistId })), A_CROWD)).toHaveLength(2);
    const fresh = picks.find((track) => track.id === tid("new1"));
    expect(fresh.agentRecommendation.reasonCode).toBe("discovery_pick");
    expect(fresh.agentRecommendation.explanation[0]).toBe(
      DISCOVERY_EXPLANATIONS.discovery_pick,
    );
    // The played artist is never a discovery pick.
    const played = picks.find((track) => track.id === tid("played1"));
    expect(played.agentRecommendation.reasonCode).not.toBe("discovery_pick");
    for (const track of picks) {
      expect(DISCOVERY_REASON_CODES).toContain(track.agentRecommendation.reasonCode);
    }
    expect(djBefore.policy?.dropped.diversity).toBe(2);
  });

  it("Home ranks with the same profile, applies the same policy, and exposes reasonCode", async () => {
    homeResult = await home.getRecommendations(LISTENER, 10);
    const items = mine(homeResult.items);

    // Same track, same learned weight, same score as the DJ.
    const c1 = items.find((item) => item.id === crowdPicks[0])!;
    const djC1: any = (djBefore.selected as any[]).find((t) => t.id === crowdPicks[0]);
    expect(c1.score).toBe(djC1.agentRecommendation.score);
    expect(c1.explanations).toContain(DISCOVERY_EXPLANATIONS.learned_taste);
    // Legacy contract intact.
    expect(c1.reasons).toEqual([`genre:${GENRE}`]);

    // Policy: at most two per artist, the verified unplayed artist explored.
    expect(byArtist(items, A_CROWD)).toHaveLength(2);
    const fresh = items.find((item) => item.id === tid("new1"))!;
    expect(fresh.reasonCode).toBe("discovery_pick");
    expect(fresh.explanations[0]).toBe(DISCOVERY_EXPLANATIONS.discovery_pick);
    expect(items.find((item) => item.id === tid("played1"))?.reasonCode).not.toBe(
      "discovery_pick",
    );
    for (const item of homeResult.items) {
      expect(DISCOVERY_REASON_CODES).toContain(item.reasonCode);
      expect(item.explanations.length).toBeGreaterThan(0);
    }
    // The page and the DJ shortlist contain the same tracks for this listener.
    expect(items.map((item) => item.id).sort()).toEqual(
      (djBefore.selected as any[]).map((track) => track.id).sort(),
    );
  });

  it("both surfaces read one served history: what Home served, the DJ demotes", async () => {
    const servedByHome = mine(homeResult.items).map((item) => item.id);
    expect((await home.getServedHistory(LISTENER)).filter((id) => id.startsWith(P)).sort()).toEqual(
      [...servedByHome].sort(),
    );

    // A track neither surface has served yet.
    await seedTrack("late", A_LATE);
    const djAfter = await dj.select({
      userId: LISTENER,
      queries: [GENRE],
      recentTrackIds: [],
      limit: 10,
    });
    const picks = djAfter.selected as any[];
    const late = picks.find((track) => track.id === tid("late"));
    expect(late.agentRecommendation.score).toBe(EXPECTED_SCORE);
    expect(picks[0].agentRecommendation.score).toBe(EXPECTED_SCORE);
    // Demoted, not excluded: Home-served tracks stay available at the tail
    // (the two still-unserved crowd tracks now take the artist's two slots).
    for (const id of [tid("new1"), tid("played1")]) {
      const track = picks.find((candidate) => candidate.id === id);
      expect(track.agentRecommendation.signals).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: "recently_played" })]),
      );
      expect(track.agentRecommendation.score).toBe(0);
    }
    const ids = picks.map((track) => track.id);
    const crowdNow = ids.filter((id) => !crowdPicks.includes(id) && id.includes("track_c"));
    // The two crowd tracks Home did not serve take the artist's two slots.
    expect(crowdNow).toHaveLength(2);
    for (const id of crowdPicks) expect(ids).not.toContain(id);
    expect(djAfter.rejected).toEqual([]);
  });

  it("a listener with no stored profile gets the same computed weights on both surfaces", async () => {
    await prisma.agentSignal.create({
      data: { userId: COMPUTED_LISTENER, trackId: tid("c1"), action: "accept", weight: 1, createdAt: NOW },
    });
    await home.setPreferences(COMPUTED_LISTENER, { genres: [GENRE] });

    const profile = await resolveAgentTasteProfile(COMPUTED_LISTENER);
    expect(profile.genreWeights).toEqual({ [GENRE]: 1 });

    const djResult = await dj.select({
      userId: COMPUTED_LISTENER,
      queries: [GENRE],
      recentTrackIds: [],
      limit: 10,
    });
    const djTrack: any = (djResult.selected as any[]).find((t) => t.id === tid("new1"));
    expect(djTrack).toBeDefined();
    const homeItems = mine((await home.getRecommendations(COMPUTED_LISTENER, 10)).items);
    const homeTrack = homeItems.find((item) => item.id === tid("new1"))!;

    // taste_match 40 + learned_preference min(18, 1 * 2) on both surfaces.
    expect(djTrack.agentRecommendation.score).toBe(42);
    expect(homeTrack.score).toBe(42);
  });
});
