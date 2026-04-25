import { prisma } from "../db/prisma";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

const TEST_PREFIX = `emb_${Date.now()}_`;

describe("EmbeddingStore (integration)", () => {
  const service = new EmbeddingService();
  const store = new EmbeddingStore();

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}user`,
        email: `${TEST_PREFIX}@test.resonate`,
      },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Embedding Artist",
        payoutAddress: `0x${"e".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Embedding Release",
        genre: "lofi",
        status: "published",
      },
    });
    await prisma.track.createMany({
      data: [
        {
          id: `${TEST_PREFIX}track-a`,
          releaseId: `${TEST_PREFIX}release`,
          title: "Lofi Chill",
          position: 1,
        },
        {
          id: `${TEST_PREFIX}track-b`,
          releaseId: `${TEST_PREFIX}release`,
          title: "Chill Beats",
          position: 2,
        },
        {
          id: `${TEST_PREFIX}track-c`,
          releaseId: `${TEST_PREFIX}release`,
          title: "Metal",
          position: 3,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.trackEmbedding.deleteMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
    }).catch(() => { });
    await prisma.track.deleteMany({
      where: { releaseId: `${TEST_PREFIX}release` },
    }).catch(() => { });
    await prisma.release.delete({
      where: { id: `${TEST_PREFIX}release` },
    }).catch(() => { });
    await prisma.artist.delete({
      where: { id: `${TEST_PREFIX}artist` },
    }).catch(() => { });
    await prisma.user.delete({
      where: { id: `${TEST_PREFIX}user` },
    }).catch(() => { });
  });

  it("persists and retrieves track embeddings", async () => {
    const vector = service.embed("lofi chill");

    await store.upsert(`${TEST_PREFIX}track-a`, vector);

    const persisted = await store.get(`${TEST_PREFIX}track-a`);
    expect(persisted).toHaveLength(vector.length);
    persisted?.forEach((value, index) => {
      expect(value).toBeCloseTo(vector[index]);
    });
  });

  it("ranks candidate tracks by cosine similarity", async () => {
    const query = service.embed("lofi chill");
    await store.upsert(`${TEST_PREFIX}track-a`, service.embed("lofi chill"));
    await store.upsert(`${TEST_PREFIX}track-b`, service.embed("chill beats"));
    await store.upsert(`${TEST_PREFIX}track-c`, service.embed("metal"));

    const ranked = await store.similarity(query, [
      `${TEST_PREFIX}track-c`,
      `${TEST_PREFIX}track-b`,
      `${TEST_PREFIX}track-a`,
      `${TEST_PREFIX}missing`,
    ]);

    expect(ranked.map((item) => item.trackId)).toEqual([
      `${TEST_PREFIX}track-a`,
      `${TEST_PREFIX}track-b`,
      `${TEST_PREFIX}track-c`,
    ]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("returns an empty ranking when no candidates have embeddings", async () => {
    await expect(store.similarity(service.embed("ambient"), [`${TEST_PREFIX}missing`]))
      .resolves.toEqual([]);
  });

  it("rejects vectors with the wrong dimension", async () => {
    await expect(store.upsert(`${TEST_PREFIX}track-a`, [1, 2, 3]))
      .rejects.toThrow("16 dimensions");
  });
});
