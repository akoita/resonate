import { prisma } from "../db/prisma";
import { AgentSoundsService, computeCatalogSounds } from "../modules/agents/agent_sounds.service";
import { soundsForListener } from "../modules/agents/agent_sounds";
import { AgentConfigController } from "../modules/agents/agent_config.controller";

const TEST_PREFIX = `sounds_${Date.now()}_`;
const USER = `${TEST_PREFIX}user`;
const ARTIST = `${TEST_PREFIX}artist`;

type Fixture = {
  key: string;
  genre: string | null;
  releaseStatus?: string;
  explicit?: boolean;
  aiDisclosureLevel?: "NONE" | "PARTLY" | "ALL" | "UNDECLARED";
  contentStatus?: string;
  withStem?: boolean;
  descriptorFamilies?: string[];
};

const fixtures: Fixture[] = [
  // Hip-hop: 3 clean playable + 1 explicit playable.
  { key: "rap1", genre: "Rap" },
  { key: "rap2", genre: "French Rap" },
  { key: "rap3", genre: "Trap", aiDisclosureLevel: "PARTLY" },
  { key: "rap4", genre: "Hip-Hop", explicit: true },
  // Excluded from every count: fully AI-generated, unready, quarantined, no current stem.
  { key: "rap_ai", genre: "Rap", aiDisclosureLevel: "ALL" },
  { key: "rap_processing", genre: "Rap", releaseStatus: "processing" },
  { key: "rap_withdrawn", genre: "Rap", releaseStatus: "withdrawn" },
  { key: "rap_quarantined", genre: "Rap", contentStatus: "quarantined" },
  { key: "rap_nostem", genre: "Rap", withStem: false },
  // World: one by genre text, one by descriptor only (genre text means nothing).
  { key: "world1", genre: "African" },
  { key: "world2", genre: "Bambara", descriptorFamilies: ["world", "african"] },
  // Jazz: below any sensible threshold.
  { key: "jazz1", genre: "Jazz" },
];

const trackId = (key: string) => `${TEST_PREFIX}track_${key}`;
const releaseId = (key: string) => `${TEST_PREFIX}release_${key}`;
const scope = { id: { startsWith: TEST_PREFIX } };

describe("catalog Sounds aggregate (integration, #2249)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.resonate` } });
    await prisma.artist.create({
      data: { id: ARTIST, userId: USER, displayName: "Sounds Artist", payoutAddress: "0x" + "A".repeat(40) },
    });
    for (const fixture of fixtures) {
      await prisma.release.create({
        data: {
          id: releaseId(fixture.key),
          artistId: ARTIST,
          title: `Release ${fixture.key}`,
          status: fixture.releaseStatus ?? "published",
          genre: fixture.genre,
        },
      });
      await prisma.track.create({
        data: {
          id: trackId(fixture.key),
          releaseId: releaseId(fixture.key),
          title: `Track ${fixture.key}`,
          position: 1,
          processingStatus: "complete",
          contentStatus: fixture.contentStatus ?? "clean",
          explicit: fixture.explicit ?? false,
          aiDisclosureLevel: fixture.aiDisclosureLevel ?? "NONE",
        },
      });
      if (fixture.withStem !== false) {
        await prisma.stem.create({
          data: {
            id: `${TEST_PREFIX}stem_${fixture.key}`,
            trackId: trackId(fixture.key),
            type: "original",
            uri: `local://${TEST_PREFIX}${fixture.key}.mp3`,
            isCurrent: true,
          },
        });
      }
      if (fixture.descriptorFamilies) {
        await prisma.trackDescriptor.create({
          data: {
            trackId: trackId(fixture.key),
            version: 1,
            families: fixture.descriptorFamilies,
            source: "test",
            contentHash: `${TEST_PREFIX}${fixture.key}`,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.trackDescriptor.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: ARTIST } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  const family = (aggregate: Awaited<ReturnType<typeof computeCatalogSounds>>, id: string) =>
    aggregate.families.find((entry) => entry.id === id)!;

  it("counts playable, promotion-eligible tracks per family, with and without explicit", async () => {
    const aggregate = await computeCatalogSounds(scope);
    expect(family(aggregate, "hip-hop")).toMatchObject({ total: 4, clean: 3 });
  });

  it("excludes AI-generated, unready, withdrawn, quarantined and stemless tracks", async () => {
    const aggregate = await computeCatalogSounds(scope);
    // Only rap1..rap4 count; the five excluded Rap rows would make this 9.
    expect(family(aggregate, "hip-hop").total).toBe(4);
  });

  it("counts a descriptor-only match toward its families", async () => {
    const aggregate = await computeCatalogSounds(scope);
    expect(family(aggregate, "world").total).toBe(2);
    expect(family(aggregate, "african").total).toBe(2);
    expect(family(aggregate, "jazz").total).toBe(1);
  });

  it("hides families below the threshold for the listener, honoring explicit", async () => {
    const aggregate = await computeCatalogSounds(scope);
    const clean = soundsForListener(aggregate, { allowExplicit: false, minTracks: 3 });
    expect(clean.families).toEqual([{ id: "hip-hop", label: "Hip-Hop", count: 3 }]);
    const withExplicit = soundsForListener(aggregate, { allowExplicit: true, minTracks: 4 });
    expect(withExplicit.families).toEqual([{ id: "hip-hop", label: "Hip-Hop", count: 4 }]);
    const lenient = soundsForListener(aggregate, { allowExplicit: false, minTracks: 1 });
    expect(lenient.families.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["hip-hop", "world", "african", "jazz"]),
    );
  });

  it("serves one cached aggregate until the TTL passes or it is invalidated", async () => {
    const service = new AgentSoundsService();
    const first = await service.getAggregate();
    const second = await service.getAggregate();
    expect(second).toBe(first);
    const concurrent = new AgentSoundsService();
    const [a, b] = await Promise.all([concurrent.getAggregate(), concurrent.getAggregate()]);
    expect(a).toBe(b);
    service.invalidate();
    expect(await service.getAggregate()).not.toBe(first);
  });

  describe("GET /agents/config/session/sounds handler", () => {
    const learning = { resolveTasteProfile: jest.fn() };
    let controller: AgentConfigController;

    beforeAll(async () => {
      // The listener's request derives from one aggregate: scoped to the fixtures here.
      const aggregate = await computeCatalogSounds(scope);
      const sounds = {
        getForListener: async (options: Parameters<typeof soundsForListener>[1]) =>
          soundsForListener(aggregate, { ...options, minTracks: 1 }),
      } as unknown as AgentSoundsService;
      controller = new AgentConfigController(
        {} as any, {} as any, {} as any, learning as any, { publish: jest.fn() } as any,
        undefined, undefined, sounds,
      );
      await prisma.agentConfig.create({
        data: { userId: USER, monthlyCapUsd: 10, isActive: false, allowExplicit: true },
      });
    });

    afterAll(async () => {
      await prisma.agentConfig.deleteMany({ where: { userId: USER } });
    });

    beforeEach(() => {
      learning.resolveTasteProfile.mockReset();
      learning.resolveTasteProfile.mockResolvedValue({ genreWeights: {} });
    });

    it("applies the saved explicit preference and an explicit query override", async () => {
      const saved = await controller.getSessionSounds({ user: { userId: USER } });
      expect(saved.families.find((entry) => entry.id === "hip-hop")?.count).toBe(4);
      const overridden = await controller.getSessionSounds({ user: { userId: USER } }, "false");
      expect(overridden.families.find((entry) => entry.id === "hip-hop")?.count).toBe(3);
    });

    it("orders by the listener's learned taste", async () => {
      learning.resolveTasteProfile.mockResolvedValue({ genreWeights: { Jazz: 3 } });
      const sounds = await controller.getSessionSounds({ user: { userId: USER } });
      expect(sounds.families[0].id).toBe("jazz");
    });

    it("falls back to catalog size when taste cannot be read", async () => {
      learning.resolveTasteProfile.mockRejectedValue(new Error("history unavailable"));
      const sounds = await controller.getSessionSounds({ user: { userId: USER } });
      expect(sounds.families[0].id).toBe("hip-hop");
    });
  });
});
