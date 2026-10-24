import { prisma } from "../db/prisma";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { deterministicSelectorInput } from "../modules/agents/deterministic_recommendation.adapter";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

/**
 * The Discovery control (#2327), against a real database: the same Jazz session
 * with Familiar, Mixed and New. Six verified artists the listener has never
 * played and six they have, all Jazz; three more verified new artists play
 * Techno, which a Jazz request must never reach through an exploration slot.
 */
const PREFIX = `discovery_ctl_${Date.now()}_`;
const LISTENER = `${PREFIX}listener`;
const SESSION = `${PREFIX}session`;

type Seed = { key: string; genre: string; played: boolean };
const SEEDS: Seed[] = [
  ...Array.from({ length: 6 }, (_, n) => ({ key: `known${n}`, genre: "Jazz", played: true })),
  ...Array.from({ length: 6 }, (_, n) => ({ key: `fresh${n}`, genre: "Jazz", played: false })),
  ...Array.from({ length: 3 }, (_, n) => ({ key: `techno${n}`, genre: "Techno", played: false })),
];
const rows = SEEDS.map((seed) => ({
  ...seed,
  user: `${PREFIX}user_${seed.key}`,
  artist: `${PREFIX}artist_${seed.key}`,
  tracks: [1, 2].map((n) => ({ release: `${PREFIX}release_${seed.key}_${n}`, track: `${PREFIX}track_${seed.key}_${n}` })),
}));

describe("Discovery control (integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: LISTENER, email: `${LISTENER}@test.resonate` },
        ...rows.map((row) => ({ id: row.user, email: `${row.user}@test.resonate` })),
      ],
    });
    await prisma.agentConfig.create({ data: { userId: LISTENER, monthlyCapUsd: 10, isActive: false, vibes: ["Jazz"] } });
    await prisma.session.create({ data: { id: SESSION, userId: LISTENER, budgetCapUsd: 10 } });
    for (const row of rows) {
      await prisma.artist.create({
        data: { id: row.artist, userId: row.user, displayName: `Discovery ${row.key}`, payoutAddress: "0x" + "E".repeat(40) },
      });
      // Every artist is a verified human, so only "never played" tells the groups apart.
      await prisma.curatorReputation.create({
        data: { walletAddress: row.user.toLowerCase(), humanVerificationStatus: "human_verified", humanVerifiedAt: new Date() },
      });
      for (const [index, item] of row.tracks.entries()) {
        await prisma.release.create({
          data: {
            id: item.release,
            artistId: row.artist,
            title: `Discovery ${row.key} ${index}`,
            status: "published",
            genre: row.genre,
            moods: ["Warm"],
          },
        });
        await prisma.track.create({
          data: {
            id: item.track,
            releaseId: item.release,
            title: `Discovery ${row.key} ${index}`,
            position: 1,
            processingStatus: "complete",
            contentStatus: "clean",
            explicit: false,
            aiDisclosureLevel: "NONE",
          },
        });
      }
    }
    await prisma.agentSignal.createMany({
      data: rows
        .filter((row) => row.played)
        .map((row) => ({ userId: LISTENER, sessionId: SESSION, trackId: row.tracks[0].track, action: "accept", weight: 1 })),
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: LISTENER } });
    await prisma.session.deleteMany({ where: { userId: LISTENER } });
    await prisma.agentConfig.deleteMany({ where: { userId: LISTENER } });
    const tracks = rows.flatMap((row) => row.tracks);
    await prisma.track.deleteMany({ where: { id: { in: tracks.map((item) => item.track) } } });
    await prisma.release.deleteMany({ where: { id: { in: tracks.map((item) => item.release) } } });
    await prisma.artist.deleteMany({ where: { id: { in: rows.map((row) => row.artist) } } });
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: { in: rows.map((row) => row.user.toLowerCase()) } } });
    await prisma.user.deleteMany({ where: { id: { in: [LISTENER, ...rows.map((row) => row.user)] } } });
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
  type Selected = { id: string; agentRecommendation?: { reasonCode?: string; explanation?: string[] } };
  const select = async (discovery?: "familiar" | "mixed" | "new", extra: Record<string, unknown> = {}) => {
    const result = await selector.select(
      deterministicSelectorInput({
        userId: LISTENER,
        recentTrackIds: [],
        limit: 12,
        preferences: {
          genres: ["Jazz"],
          sessionGenres: ["Jazz"],
          ...(discovery ? { discovery } : {}),
          ...extra,
        },
      }),
    );
    return result.selected as Selected[];
  };
  const discoveryPicks = (selected: Selected[]) =>
    selected.filter((track) => track.agentRecommendation?.reasonCode === "discovery_pick");
  const freshIds = new Set(rows.filter((row) => row.genre === "Jazz" && !row.played).flatMap((row) => row.tracks.map((item) => item.track)));
  const technoIds = new Set(rows.filter((row) => row.genre === "Techno").flatMap((row) => row.tracks.map((item) => item.track)));

  it("Familiar labels no pick as discovery", async () => {
    const selected = await select("familiar");
    expect(selected.length).toBeGreaterThan(0);
    expect(discoveryPicks(selected)).toEqual([]);
  });

  it("Mixed, and a session that never touched the control, are the same as before: about one pick in five", async () => {
    const mixed = discoveryPicks(await select("mixed"));
    const untouched = discoveryPicks(await select());
    expect(mixed.length).toBeGreaterThanOrEqual(1);
    expect(mixed.length).toBeLessThanOrEqual(2);
    expect(untouched.map((track) => track.id)).toEqual(mixed.map((track) => track.id));
  });

  it("New puts more never-played verified artists in the batch than Mixed, and says why in the picks' reasons", async () => {
    const mixed = discoveryPicks(await select("mixed"));
    const newer = discoveryPicks(await select("new"));
    expect(newer.length).toBeGreaterThan(mixed.length);
    expect(newer.length).toBeLessThanOrEqual(5);
    for (const track of newer) {
      expect(freshIds.has(track.id)).toBe(true);
      expect(track.agentRecommendation?.explanation?.length).toBeGreaterThan(0);
    }
  });

  it("New never takes an exploration slot outside the request, even when similar sounds may fill the batch", async () => {
    for (const fillSimilar of [false, true]) {
      const selected = await select("new", { fillSimilar });
      const outside = discoveryPicks(selected).filter((track) => technoIds.has(track.id));
      expect([fillSimilar, outside.map((track) => track.id)]).toEqual([fillSimilar, []]);
    }
  });

  it("Familiar plus New artists only, and New plus New artists only, still play only artists never played", async () => {
    for (const discovery of ["familiar", "new"] as const) {
      const selected = (await select(discovery, { newArtists: true })).filter((track) => track.id.startsWith(PREFIX));
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every((track) => !track.id.includes("known"))).toBe(true);
    }
  });
});
