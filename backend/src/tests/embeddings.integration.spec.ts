import fs from "fs";
import path from "path";
import { prisma } from "../db/prisma";
import { TRACK_EMBEDDING_DIMENSION } from "../modules/embeddings/embedding.config";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

const TEST_PREFIX = `emb_${Date.now()}_`;

const MODEL_A = `${TEST_PREFIX}model-a`;
const MODEL_B = `${TEST_PREFIX}model-b`;
const HNSW_INDEX = "TrackEmbedding_vector_hnsw_idx";
const MIGRATION_SQL = path.resolve(
  __dirname,
  "../../prisma/migrations/20260928100000_track_embeddings_vertex_768_hnsw/migration.sql",
);

/** A normalized 768-dim vector with weight on the given dimensions. */
function vec(...weights: Array<[number, number]>): number[] {
  const v = new Array<number>(TRACK_EMBEDDING_DIMENSION).fill(0);
  for (const [index, weight] of weights) v[index] = weight;
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

describe("EmbeddingStore (integration)", () => {
  const store = new EmbeddingStore();
  const trackIds = ["a", "b", "c", "d"].map((s) => `${TEST_PREFIX}track-${s}`);
  const [trackA, trackB, trackC, trackD] = trackIds;

  beforeAll(async () => {
    // `prisma db push` (the integration harness) cannot express the HNSW
    // index; apply the exact statement shipped in the migration so the index
    // DDL is exercised against pgvector too. Idempotent (IF NOT EXISTS).
    const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
    const indexStatement = sql.match(
      /CREATE INDEX IF NOT EXISTS "TrackEmbedding_vector_hnsw_idx"[^;]+;/,
    )?.[0];
    expect(indexStatement).toBeDefined();
    await prisma.$executeRawUnsafe(indexStatement as string);

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
      data: trackIds.map((id, index) => ({
        id,
        releaseId: `${TEST_PREFIX}release`,
        title: `Embedding Track ${index}`,
        position: index + 1,
      })),
    });
  });

  afterAll(async () => {
    await prisma.trackEmbedding
      .deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
    await prisma.track
      .deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } })
      .catch(() => {});
    await prisma.release
      .delete({ where: { id: `${TEST_PREFIX}release` } })
      .catch(() => {});
    await prisma.artist
      .delete({ where: { id: `${TEST_PREFIX}artist` } })
      .catch(() => {});
    await prisma.user
      .delete({ where: { id: `${TEST_PREFIX}user` } })
      .catch(() => {});
  });

  beforeEach(async () => {
    await prisma.trackEmbedding.deleteMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
    });
  });

  it("persists and retrieves 768-dim vectors with model and content hash", async () => {
    const vector = vec([0, 1], [1, 0.5]);
    await store.upsert(trackA, vector, MODEL_A, "hash-1");

    const persisted = await store.get(trackA);
    expect(persisted).toHaveLength(TRACK_EMBEDDING_DIMENSION);
    persisted?.forEach((value, index) => {
      expect(value).toBeCloseTo(vector[index], 5);
    });

    const states = await store.getContentStates([trackA, trackB]);
    expect(states.get(trackA)).toEqual({ model: MODEL_A, contentHash: "hash-1" });
    expect(states.has(trackB)).toBe(false);
  });

  it("upserts in place, replacing vector, model and hash", async () => {
    await store.upsert(trackA, vec([0, 1]), MODEL_A, "hash-1");
    await store.upsert(trackA, vec([5, 1]), MODEL_B, "hash-2");

    const rows = await prisma.trackEmbedding.findMany({
      where: { trackId: trackA },
      select: { model: true, contentHash: true },
    });
    expect(rows).toEqual([{ model: MODEL_B, contentHash: "hash-2" }]);
    expect((await store.get(trackA))?.[5]).toBeCloseTo(vec([5, 1])[5], 5);
  });

  it("touch bumps updatedAt without rewriting the vector", async () => {
    await store.upsert(trackA, vec([0, 1]), MODEL_A, "hash-1");
    await prisma.$executeRaw`
      UPDATE "TrackEmbedding" SET "updatedAt" = '2000-01-01T00:00:00Z' WHERE "trackId" = ${trackA}
    `;
    await store.touch([trackA]);
    const row = await prisma.trackEmbedding.findUniqueOrThrow({
      where: { trackId: trackA },
      select: { updatedAt: true, contentHash: true },
    });
    expect(row.updatedAt.getFullYear()).toBeGreaterThan(2000);
    expect(row.contentHash).toBe("hash-1");
  });

  it("has an HNSW cosine index on the vector column", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'TrackEmbedding' AND indexname = ${HNSW_INDEX}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING hnsw/i);
    expect(rows[0].indexdef).toMatch(/vector_cosine_ops/);
  });

  it("the nearest-neighbour query shape can use the HNSW index", async () => {
    const literal = `[${vec([0, 1]).join(",")}]`;
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        `EXPLAIN SELECT "trackId" FROM "TrackEmbedding" WHERE "model" = '${MODEL_A}' ` +
          `ORDER BY "vector" <=> '${literal}'::vector LIMIT 5`,
      );
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(HNSW_INDEX);
  });

  it("nearest returns neighbours in cosine order and honours exclusions", async () => {
    await store.upsert(trackA, vec([0, 1]), MODEL_A, "h");
    await store.upsert(trackB, vec([0, 1], [1, 0.2]), MODEL_A, "h");
    await store.upsert(trackC, vec([0, 1], [1, 1]), MODEL_A, "h");
    await store.upsert(trackD, vec([2, 1]), MODEL_A, "h");

    const query = vec([0, 1]);
    const nearest = await store.nearest(query, { model: MODEL_A, limit: 10 });
    const ours = nearest.filter((row) => row.trackId.startsWith(TEST_PREFIX));
    expect(ours.map((row) => row.trackId)).toEqual([trackA, trackB, trackC, trackD]);
    expect(ours[0].score).toBeCloseTo(1, 5);
    for (let i = 1; i < ours.length; i += 1) {
      expect(ours[i - 1].score).toBeGreaterThanOrEqual(ours[i].score);
    }

    const excluded = await store.nearest(query, {
      model: MODEL_A,
      limit: 10,
      excludeTrackIds: [trackA],
    });
    expect(excluded.map((row) => row.trackId)).not.toContain(trackA);
    expect(excluded[0].trackId).toBe(trackB);
  });

  it("clamps the nearest limit to a sane range", async () => {
    await store.upsert(trackA, vec([0, 1]), MODEL_A, "h");
    await store.upsert(trackB, vec([0, 1], [1, 1]), MODEL_A, "h");
    const query = vec([0, 1]);
    await expect(store.nearest(query, { model: MODEL_A, limit: 0 })).resolves.toHaveLength(1);
    await expect(store.nearest(query, { model: MODEL_A, limit: -5 })).resolves.toHaveLength(1);
    const many = await store.nearest(query, { model: MODEL_A, limit: 100000 });
    expect(many.length).toBeLessThanOrEqual(100);
    expect(many.length).toBeGreaterThanOrEqual(2);
  });

  it("never compares vectors of different models", async () => {
    // Identical vectors, different models: each query only sees its own model.
    await store.upsert(trackA, vec([0, 1]), MODEL_A, "h");
    await store.upsert(trackB, vec([0, 1]), MODEL_B, "h");

    const a = await store.nearest(vec([0, 1]), { model: MODEL_A, limit: 100 });
    expect(a.map((row) => row.trackId)).toContain(trackA);
    expect(a.map((row) => row.trackId)).not.toContain(trackB);

    const b = await store.nearest(vec([0, 1]), { model: MODEL_B, limit: 100 });
    expect(b.map((row) => row.trackId)).toContain(trackB);
    expect(b.map((row) => row.trackId)).not.toContain(trackA);

    const scored = await store.similarity(vec([0, 1]), [trackA, trackB], MODEL_A);
    expect(scored.map((row) => row.trackId)).toEqual([trackA]);

    expect(await store.get(trackA, MODEL_A)).not.toBeNull();
    expect(await store.get(trackA, MODEL_B)).toBeNull();
  });

  it("ranks candidate tracks by cosine similarity", async () => {
    await store.upsert(trackA, vec([0, 1]), MODEL_A, "h");
    await store.upsert(trackB, vec([0, 1], [1, 0.5]), MODEL_A, "h");
    await store.upsert(trackC, vec([3, 1]), MODEL_A, "h");

    const ranked = await store.similarity(
      vec([0, 1]),
      [trackC, trackB, trackA, `${TEST_PREFIX}missing`],
      MODEL_A,
    );

    expect(ranked.map((item) => item.trackId)).toEqual([trackA, trackB, trackC]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("returns an empty ranking when no candidates have embeddings", async () => {
    await expect(
      store.similarity(vec([0, 1]), [`${TEST_PREFIX}missing`], MODEL_A),
    ).resolves.toEqual([]);
    await expect(store.similarity(vec([0, 1]), [], MODEL_A)).resolves.toEqual([]);
  });

  it("rejects wrong-dimension, non-finite and all-zero vectors", async () => {
    await expect(store.upsert(trackA, [1, 2, 3], MODEL_A, "h")).rejects.toThrow(
      "768 dimensions",
    );
    await expect(
      store.upsert(trackA, vec([0, 1]).map((_, i) => (i === 0 ? NaN : 0)), MODEL_A, "h"),
    ).rejects.toThrow("finite");
    await expect(
      store.upsert(trackA, new Array(TRACK_EMBEDDING_DIMENSION).fill(0), MODEL_A, "h"),
    ).rejects.toThrow("zeros");
    await expect(store.nearest([1, 2], { model: MODEL_A })).rejects.toThrow(
      "768 dimensions",
    );
  });
});
