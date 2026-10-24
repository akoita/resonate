import { prisma } from "../db/prisma";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { deterministicSelectorInput } from "../modules/agents/deterministic_recommendation.adapter";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

/**
 * "New artists in <family>" (#2249 slice 3), against a real database: a Jazz
 * session that must play only artists the listener has never interacted with.
 */
const PREFIX = `new_artists_${Date.now()}_`;
const LISTENER = `${PREFIX}listener`;
const SESSION = `${PREFIX}session`;
const ARTISTS = ["known", "fresh_a", "fresh_b"].map((key) => ({
  key,
  user: `${PREFIX}user_${key}`,
  artist: `${PREFIX}artist_${key}`,
  tracks: [1, 2].map((n) => ({ release: `${PREFIX}release_${key}_${n}`, track: `${PREFIX}track_${key}_${n}` })),
}));
const knownTracks = ARTISTS[0].tracks.map((entry) => entry.track);
const freshTracks = ARTISTS.slice(1).flatMap((entry) => entry.tracks.map((item) => item.track));

describe("New artists sessions (integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: LISTENER, email: `${LISTENER}@test.resonate` },
        ...ARTISTS.map((entry) => ({ id: entry.user, email: `${entry.user}@test.resonate` })),
      ],
    });
    await prisma.agentConfig.create({ data: { userId: LISTENER, monthlyCapUsd: 10, isActive: false, vibes: ["Jazz"] } });
    await prisma.session.create({ data: { id: SESSION, userId: LISTENER, budgetCapUsd: 10 } });
    for (const entry of ARTISTS) {
      await prisma.artist.create({
        data: {
          id: entry.artist,
          userId: entry.user,
          displayName: `New Artists ${entry.key}`,
          payoutAddress: "0x" + "D".repeat(40),
        },
      });
      for (const [index, item] of entry.tracks.entries()) {
        await prisma.release.create({
          data: {
            id: item.release,
            artistId: entry.artist,
            title: `New Artists ${entry.key} ${index}`,
            status: "published",
            genre: "Jazz",
            moods: ["Warm"],
          },
        });
        await prisma.track.create({
          data: {
            id: item.track,
            releaseId: item.release,
            title: `New Artists ${entry.key} ${index}`,
            position: 1,
            processingStatus: "complete",
            contentStatus: "clean",
            explicit: false,
            aiDisclosureLevel: "NONE",
          },
        });
      }
    }
    // The listener has interacted with one artist (a skip counts: any recorded interaction).
    await prisma.agentSignal.create({
      data: { userId: LISTENER, sessionId: SESSION, trackId: knownTracks[0], action: "skip", weight: -1 },
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: LISTENER } });
    await prisma.session.deleteMany({ where: { userId: LISTENER } });
    await prisma.agentConfig.deleteMany({ where: { userId: LISTENER } });
    const tracks = ARTISTS.flatMap((entry) => entry.tracks);
    await prisma.track.deleteMany({ where: { id: { in: tracks.map((item) => item.track) } } });
    await prisma.release.deleteMany({ where: { id: { in: tracks.map((item) => item.release) } } });
    await prisma.artist.deleteMany({ where: { id: { in: ARTISTS.map((entry) => entry.artist) } } });
    await prisma.user.deleteMany({ where: { id: { in: [LISTENER, ...ARTISTS.map((entry) => entry.user)] } } });
  });

  const selector = new AgentSelectorService(
    new ToolRegistry(new EmbeddingService(), new EmbeddingStore()),
    new DiscoveryRankingService(),
    undefined,
    undefined,
    undefined,
    undefined,
    new DiscoveryPolicyContextService(),
  );
  const select = async (newArtists: boolean) => {
    const result = await selector.select(
      deterministicSelectorInput({
        userId: LISTENER,
        recentTrackIds: [],
        limit: 12,
        preferences: { genres: ["Jazz"], sessionGenres: ["Jazz"], ...(newArtists ? { newArtists: true } : {}) },
      }),
    );
    return result.selected.map((track: { id: string }) => track.id).filter((id: string) => id.startsWith(PREFIX));
  };

  it("plays only artists the listener has never interacted with", async () => {
    const picks = await select(true);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((id: string) => freshTracks.includes(id))).toBe(true);
    expect(picks.some((id: string) => knownTracks.includes(id))).toBe(false);
  });

  it("still plays the artist they know in an ordinary Jazz session", async () => {
    const picks = await select(false);
    expect(picks.some((id: string) => knownTracks.includes(id))).toBe(true);
  });

  describe("runtime routing", () => {
    const run = (preferences: Record<string, unknown>) => {
      const result = { status: "no_tracks", tracks: [], shortfall: 0 };
      const executor = {
        run: jest.fn(async () => result),
        runDeterministic: jest.fn(async () => result),
        runWithMyMix: jest.fn(async () => result),
      };
      const service = new AgentRuntimeService(executor as any, { enabled: false, required: false, run: jest.fn() } as any);
      return {
        executor,
        done: service.run({
          sessionId: SESSION,
          userId: LISTENER,
          recentTrackIds: [],
          budgetRemainingUsd: 10,
          preferences,
        } as any),
      };
    };

    it("sends a New artists session to the deterministic selector, which owns the played-artist lookup", async () => {
      const session = run({ genres: ["Jazz"], sessionGenres: ["Jazz"], newArtists: true });
      await session.done;
      expect(session.executor.runDeterministic).toHaveBeenCalledTimes(1);
      expect(session.executor.run).not.toHaveBeenCalled();
      const [input] = session.executor.runDeterministic.mock.calls[0] as unknown as [any];
      expect(input.preferences.newArtists).toBe(true);
    });

    it("leaves every other session on its usual runtime", async () => {
      for (const newArtists of [undefined, false, "yes", 1]) {
        const session = run({ genres: ["Jazz"], sessionGenres: ["Jazz"], ...(newArtists === undefined ? {} : { newArtists }) });
        await session.done;
        expect(session.executor.runDeterministic).not.toHaveBeenCalled();
        expect(session.executor.run).toHaveBeenCalledTimes(1);
      }
    });

    it("is not weighted by the time of day, even with no other filter", async () => {
      const session = run({ genres: ["Jazz"], newArtists: true, listeningContext: "evening:weekday" });
      await session.done;
      expect(session.executor.runWithMyMix).not.toHaveBeenCalled();
      expect(session.executor.runDeterministic).toHaveBeenCalledTimes(1);
    });
  });
});
