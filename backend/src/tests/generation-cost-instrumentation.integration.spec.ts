/**
 * Generation cost instrumentation — Integration Test (Testcontainers) — #1421.
 *
 * Covers the WI-B cost-model refactor + realized-cost telemetry:
 *  (a) the per-path cost model reproduces the pre-refactor cost estimate exactly
 *      with default config (behavior-preserving);
 *  (b) a GenerationCostRecord round-trips through real Postgres with the
 *      expected shape and indexes;
 *  (c) inferColdStart's best-effort classification.
 *
 * The analytics taxonomy registration for `generation.cost_recorded` is covered
 * by src/tests/analytics_event.spec.ts and analytics_warehouse.spec.ts.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import {
  estimateGenerationCostUsd,
  inferColdStart,
  resolveGenerationCostModel,
} from "../modules/generation/generation-cost-model";

const PREFIX = `gencost_${Date.now()}_`;
const USER = `${PREFIX}user`;

/**
 * The exact pre-refactor arithmetic from calculateGenerationCost /
 * estimateRemixGenerationCostUsd (linear per-30s, rounded to cents, NOT ceil).
 * Kept inline as the behavior-preservation oracle.
 */
function legacyFlatCost(durationSeconds: number): number {
  return +((durationSeconds / 30) * 0.06).toFixed(2);
}

describe("generation cost model (behavior-preserving)", () => {
  it("reproduces the legacy flat $0.06/30s cost for the catalog Lyria paths", () => {
    for (const path of ["lyria-002", "lyria-3-pro-preview"]) {
      for (const seconds of [30, 60, 180]) {
        expect(estimateGenerationCostUsd(path, seconds)).toBe(
          legacyFlatCost(seconds),
        );
      }
    }
  });

  it("reproduces the legacy flat cost for the stable-audio and remix-stub paths", () => {
    for (const path of ["stable-audio-3-medium", "remix-stub"]) {
      for (const seconds of [30, 60, 180]) {
        expect(estimateGenerationCostUsd(path, seconds)).toBe(
          legacyFlatCost(seconds),
        );
      }
    }
  });

  it("matches the legacy rounding for sub-30s durations (no ceil)", () => {
    // The old estimateRemixGenerationCostUsd(15) === 0.03; a ceil-per-block
    // model would return 0.06. The cost model must stay linear.
    expect(estimateGenerationCostUsd("remix-stub", 15)).toBe(0.03);
    expect(estimateGenerationCostUsd("lyria-002", 15)).toBe(legacyFlatCost(15));
  });

  it("falls back to the default entry (0.06/0) for an unknown path", () => {
    expect(resolveGenerationCostModel("some-future-model")).toEqual({
      costPer30sUsd: 0.06,
      fixedFloorUsd: 0,
    });
    expect(estimateGenerationCostUsd("some-future-model", 60)).toBe(
      legacyFlatCost(60),
    );
  });

  it("classifies cold starts best-effort per path", () => {
    // Hosted API + deterministic stub never cold-start.
    expect(inferColdStart("lyria-002", 999_999)).toBe(false);
    expect(inferColdStart("remix-stub", 999_999)).toBe(false);
    // Self-hosted GPU: long wall-clock => cold, short => warm.
    expect(inferColdStart("stable-audio-3-medium", 200_000)).toBe(true);
    expect(inferColdStart("stable-audio-3-medium", 5_000)).toBe(false);
    // Unknown path / unmeasured wall-clock => null (honest unknown).
    expect(inferColdStart("some-future-model", 5_000)).toBeNull();
    expect(inferColdStart("stable-audio-3-medium", null)).toBeNull();
  });
});

describe("GenerationCostRecord persistence", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER, email: `${USER}@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.generationCostRecord
      .deleteMany({ where: { userId: USER } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("writes and reads a record with the expected shape", async () => {
    const jobId = `${PREFIX}job1`;
    const created = await prisma.generationCostRecord.create({
      data: {
        jobId,
        userId: USER,
        path: "lyria-002",
        durationSeconds: 30,
        wallClockMs: 4200,
        estimatedCostUsd: estimateGenerationCostUsd("lyria-002", 30),
        sellPriceCents: 10,
        coldStart: false,
      },
    });

    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);

    const read = await prisma.generationCostRecord.findFirst({
      where: { jobId, userId: USER },
    });
    expect(read).toMatchObject({
      jobId,
      userId: USER,
      path: "lyria-002",
      durationSeconds: 30,
      wallClockMs: 4200,
      estimatedCostUsd: 0.06,
      sellPriceCents: 10,
      coldStart: false,
    });
  });

  it("persists a null coldStart for an unknown-path record", async () => {
    const jobId = `${PREFIX}job2`;
    await prisma.generationCostRecord.create({
      data: {
        jobId,
        userId: USER,
        path: "remix-stub",
        durationSeconds: 60,
        wallClockMs: 120,
        estimatedCostUsd: 0,
        sellPriceCents: 0,
        coldStart: null,
      },
    });

    const read = await prisma.generationCostRecord.findFirst({
      where: { jobId, userId: USER },
    });
    expect(read?.coldStart).toBeNull();
    expect(read?.sellPriceCents).toBe(0);
  });

  it("supports the [path, createdAt] index query used for reconciliation", async () => {
    const rows = await prisma.generationCostRecord.findMany({
      where: { userId: USER, path: "lyria-002" },
      orderBy: { createdAt: "desc" },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.path === "lyria-002")).toBe(true);
  });
});
