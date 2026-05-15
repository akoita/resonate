import { prisma } from "../db/prisma";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

const TEST_PREFIX = `agcs_${Date.now()}_`;
const MATCH_GENRE = `${TEST_PREFIX}HipHop`;
const MISS_GENRE = `${TEST_PREFIX}Reggaeton`;

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: "gen-mock-1" }),
} as any;

describe("agent catalog search tool (integration)", () => {
  let tools: ToolRegistry;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Agent Catalog Artist",
        payoutAddress: `0x${"A".repeat(40)}`,
      },
    });
    await prisma.release.createMany({
      data: [
        {
          id: `${TEST_PREFIX}match_release`,
          title: "Matched Release",
          artistId: `${TEST_PREFIX}artist`,
          status: "published",
          genre: MATCH_GENRE,
        },
        {
          id: `${TEST_PREFIX}other_release`,
          title: "Other Release",
          artistId: `${TEST_PREFIX}artist`,
          status: "published",
          genre: `${TEST_PREFIX}Electronic`,
        },
      ],
    });
    await prisma.track.createMany({
      data: [
        {
          id: `${TEST_PREFIX}match_track`,
          title: "Boom Bap Signal",
          releaseId: `${TEST_PREFIX}match_release`,
          position: 1,
        },
        {
          id: `${TEST_PREFIX}other_track`,
          title: "Glowing Pads",
          releaseId: `${TEST_PREFIX}other_release`,
          position: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.track.deleteMany({
      where: { releaseId: { in: [`${TEST_PREFIX}match_release`, `${TEST_PREFIX}other_release`] } },
    }).catch(() => {});
    await prisma.release.deleteMany({
      where: { id: { in: [`${TEST_PREFIX}match_release`, `${TEST_PREFIX}other_release`] } },
    }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it("returns genre matches without pulling unrelated recent tracks", async () => {
    const result = await tools.get("catalog.search").run({
      query: MATCH_GENRE,
      limit: 10,
      allowExplicit: true,
    });

    const ids = ((result.items as Array<{ id: string }>) ?? []).map((item) => item.id);
    expect(ids).toContain(`${TEST_PREFIX}match_track`);
    expect(ids).not.toContain(`${TEST_PREFIX}other_track`);
  });

  it("returns no candidates when an explicit genre query has no matches", async () => {
    const result = await tools.get("catalog.search").run({
      query: MISS_GENRE,
      limit: 10,
      allowExplicit: true,
    });

    expect(result.items).toEqual([]);
  });

  it("still supports unfiltered recent catalog search when no query is supplied", async () => {
    const result = await tools.get("catalog.search").run({
      query: "",
      limit: 50,
      allowExplicit: true,
    });

    const ids = ((result.items as Array<{ id: string }>) ?? []).map((item) => item.id);
    expect(ids).toContain(`${TEST_PREFIX}match_track`);
    expect(ids).toContain(`${TEST_PREFIX}other_track`);
  });
});
