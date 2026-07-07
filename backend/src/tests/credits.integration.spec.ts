/**
 * Generation-credit meter — Integration Test (Testcontainers) — #1334.
 *
 * Exercises GenerationCreditsService against real Postgres: grant, balance,
 * debit (reduce + ledger), insufficient-balance block, refund (restore + ledger
 * + double-refund no-op), and the race-safe concurrent-debit guarantee.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import {
  GenerationCreditsService,
  InsufficientCreditsException,
} from "../modules/credits/generation-credits.service";

const TEST_PREFIX = `credits_${Date.now()}_`;
const USER = `${TEST_PREFIX}user`;
const USER_B = `${TEST_PREFIX}user_b`;

// Default config (no ConfigService) → GENERATION_PRICE_CENTS_PER_30S = 10.
const service = new GenerationCreditsService();

async function ledger(userId: string) {
  return prisma.generationCreditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

describe("GenerationCreditsService integration", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER, email: `${USER}@test.resonate` },
    });
    await prisma.user.create({
      data: { id: USER_B, email: `${USER_B}@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.generationCreditTransaction
      .deleteMany({ where: { userId: { in: [USER, USER_B] } } })
      .catch(() => {});
    await prisma.generationCreditAccount
      .deleteMany({ where: { userId: { in: [USER, USER_B] } } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [USER, USER_B] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("prices a generation by 30s blocks at 10 cents per block (default)", () => {
    expect(service.costForDurationCents(30)).toBe(10);
    expect(service.costForDurationCents(60)).toBe(20);
    expect(service.costForDurationCents(180)).toBe(60);
    // Non-integer block counts round up.
    expect(service.costForDurationCents(45)).toBe(15);
    // A missing/zero duration falls back to one 30s block.
    expect(service.costForDurationCents(0)).toBe(10);
  });

  it("honors a configured price override", () => {
    const priced = new GenerationCreditsService({
      get: () => 25,
    } as any);
    expect(priced.costForDurationCents(30)).toBe(25);
    expect(priced.costForDurationCents(60)).toBe(50);
  });

  it("grants credits and reflects them in the balance + ledger", async () => {
    const balance = await service.grant(USER, 100, "promo_grant");
    expect(balance).toBe(100);

    const { balanceCents, priceCentsPer30s, recentTransactions } = await service.getBalance(USER);
    expect(balanceCents).toBe(100);
    // Balance carries the price so clients can render remaining capacity
    // (100¢ ÷ 10¢/30s = 5 min) without hardcoding it.
    expect(priceCentsPer30s).toBe(10);
    expect(recentTransactions[0]).toMatchObject({
      type: "grant",
      amountCents: 100,
      reason: "promo_grant",
      balanceAfterCents: 100,
    });
  });

  it("debits, reducing the balance and appending a debit txn with balanceAfterCents", async () => {
    const after = await service.debit(USER, 30, "lyria_generation", "job-debit-1", "lyria");
    expect(after).toBe(70);

    const { balanceCents } = await service.getBalance(USER);
    expect(balanceCents).toBe(70);

    const txns = await ledger(USER);
    const debit = txns.find((t) => t.jobId === "job-debit-1");
    expect(debit).toMatchObject({
      type: "debit",
      amountCents: 30,
      balanceAfterCents: 70,
      jobId: "job-debit-1",
    });
  });

  it("BLOCKS an insufficient debit: throws, no charge, balance unchanged", async () => {
    const { balanceCents: before } = await service.getBalance(USER);
    expect(before).toBe(70);

    await expect(
      service.debit(USER, 1000, "lyria_generation", "job-too-big", "lyria"),
    ).rejects.toBeInstanceOf(InsufficientCreditsException);

    const { balanceCents: after } = await service.getBalance(USER);
    expect(after).toBe(70);

    // No debit txn was written for the blocked attempt.
    const txns = await ledger(USER);
    expect(txns.find((t) => t.jobId === "job-too-big")).toBeUndefined();
  });

  it("blocks a zero-balance user (no account row) without creating a charge", async () => {
    await expect(
      service.debit(USER_B, 10, "lyria_generation", "job-zero", "lyria"),
    ).rejects.toBeInstanceOf(InsufficientCreditsException);
    const { balanceCents } = await service.getBalance(USER_B);
    expect(balanceCents).toBe(0);
    expect(await ledger(USER_B)).toHaveLength(0);
  });

  it("refunds, restoring the balance and appending a refund txn", async () => {
    const after = await service.refund(USER, 30, "job_failed_refund", "job-debit-1");
    expect(after).toBe(100);

    const { balanceCents } = await service.getBalance(USER);
    expect(balanceCents).toBe(100);

    const txns = await ledger(USER);
    const refunds = txns.filter((t) => t.type === "refund" && t.jobId === "job-debit-1");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountCents: 30, balanceAfterCents: 100 });
  });

  it("is a no-op on a second refund for the same jobId (no double credit)", async () => {
    const after = await service.refund(USER, 30, "job_failed_refund", "job-debit-1");
    expect(after).toBe(100); // unchanged

    const { balanceCents } = await service.getBalance(USER);
    expect(balanceCents).toBe(100);

    const txns = await ledger(USER);
    const refunds = txns.filter((t) => t.type === "refund" && t.jobId === "job-debit-1");
    expect(refunds).toHaveLength(1); // still exactly one
  });

  it("does NOT oversell under concurrent debits: exactly one of two competing debits succeeds", async () => {
    // Seed a fresh account with room for exactly one 60¢ debit.
    const raceUser = `${TEST_PREFIX}race`;
    await prisma.user.create({
      data: { id: raceUser, email: `${raceUser}@test.resonate` },
    });
    try {
      await service.grant(raceUser, 60, "promo_grant");

      const results = await Promise.allSettled([
        service.debit(raceUser, 60, "lyria_generation", "race-a", "lyria"),
        service.debit(raceUser, 60, "lyria_generation", "race-b", "lyria"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        InsufficientCreditsException,
      );

      // Balance never went negative; exactly one debit txn was written.
      const { balanceCents } = await service.getBalance(raceUser);
      expect(balanceCents).toBe(0);
      const debits = (await ledger(raceUser)).filter((t) => t.type === "debit");
      expect(debits).toHaveLength(1);
    } finally {
      await prisma.generationCreditTransaction
        .deleteMany({ where: { userId: raceUser } })
        .catch(() => {});
      await prisma.generationCreditAccount
        .deleteMany({ where: { userId: raceUser } })
        .catch(() => {});
      await prisma.user.deleteMany({ where: { id: raceUser } }).catch(() => {});
    }
  });
});

describe("GenerationCreditsService signup starter (#1334 onboarding)", () => {
  const STARTER_PREFIX = `credits_starter_${Date.now()}_`;
  const NEW_USER = `${STARTER_PREFIX}new`;
  const SPENT_USER = `${STARTER_PREFIX}spent`;

  // Starter enabled at 100¢; price stays at the 10¢/30s default (so a 1-min /
  // 20¢ generation fits inside the starter).
  const starterService = new GenerationCreditsService({
    get: (key: string, fallback?: unknown) =>
      key === "GENERATION_CREDITS_SIGNUP_STARTER_CENTS" ? 100 : fallback,
  } as any);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: NEW_USER, email: `${NEW_USER}@test.resonate` },
    });
    await prisma.user.create({
      data: { id: SPENT_USER, email: `${SPENT_USER}@test.resonate` },
    });
  });

  afterAll(async () => {
    const ids = [NEW_USER, SPENT_USER];
    await prisma.generationCreditTransaction
      .deleteMany({ where: { userId: { in: ids } } })
      .catch(() => {});
    await prisma.generationCreditAccount
      .deleteMany({ where: { userId: { in: ids } } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  });

  it("provisions the starter on first balance read, exactly once", async () => {
    const first = await starterService.getBalance(NEW_USER);
    expect(first.balanceCents).toBe(100);
    expect(
      first.recentTransactions.filter((t) => t.reason === "signup_starter"),
    ).toHaveLength(1);

    // Idempotent: a second read does not hand out a second free starter.
    const second = await starterService.getBalance(NEW_USER);
    expect(second.balanceCents).toBe(100);
    expect(
      (await ledger(NEW_USER)).filter((t) => t.reason === "signup_starter"),
    ).toHaveLength(1);
  });

  it("lets a brand-new user's first generation succeed by self-provisioning the starter", async () => {
    // SPENT_USER has never been touched: a 20¢ (1-min) debit provisions 100¢
    // then charges, leaving 80¢ — no 402 wall.
    const after = await starterService.debit(
      SPENT_USER,
      20,
      "lyria_generation",
      "starter-job",
      "lyria",
    );
    expect(after).toBe(80);
    const txns = await ledger(SPENT_USER);
    expect(txns.filter((t) => t.reason === "signup_starter")).toHaveLength(1);
    expect(txns.find((t) => t.jobId === "starter-job")).toMatchObject({
      type: "debit",
      amountCents: 20,
      balanceAfterCents: 80,
    });
  });

  it("does NOT re-grant the starter to an account that already spent down to 0", async () => {
    // Drain SPENT_USER from 80¢ to exactly 0.
    await starterService.debit(
      SPENT_USER,
      80,
      "lyria_generation",
      "drain-job",
      "lyria",
    );
    expect((await starterService.getBalance(SPENT_USER)).balanceCents).toBe(0);

    // Re-reading balance at 0 must not resurrect a second free starter.
    expect((await starterService.getBalance(SPENT_USER)).balanceCents).toBe(0);
    expect(
      (await ledger(SPENT_USER)).filter((t) => t.reason === "signup_starter"),
    ).toHaveLength(1);
  });
});
