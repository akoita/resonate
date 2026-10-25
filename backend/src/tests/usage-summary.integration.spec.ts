import { Test } from "@nestjs/testing";
import request from "supertest";
import { sign } from "jsonwebtoken";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../modules/app.module";
import { UsageService } from "../modules/usage/usage.service";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { METERED_ACTIONS } from "../modules/credits/metered-actions";
import { prisma } from "../db/prisma";
import { applyGlobalValidation } from "../config/validation";

/**
 * #1422 — unified GET /usage/summary aggregation.
 *
 * Booting the full AppModule here doubles as the module-cycle guard: importing
 * Credits + Generation + Remix into UsageModule is exactly the cross-module
 * shape that broke #1415, so if a circular dependency were reintroduced this
 * `app.init()` would fail to resolve.
 */
describe("Usage summary (integration)", () => {
  let app: INestApplication;
  let usageService: UsageService;
  let credits: GenerationCreditsService;

  const TEST_PREFIX = `usage_summary_${Date.now()}_`;
  const userId = `${TEST_PREFIX}user`;
  const otherUserId = `${TEST_PREFIX}other`;
  const grantedCents = 250;

  beforeAll(async () => {
    // AppModule pulls the encryption provider (via RemixModule), which requires
    // a secret to derive its key. Booting the full app is deliberate — it is
    // the module-cycle guard (see file header).
    process.env.ENCRYPTION_SECRET =
      process.env.ENCRYPTION_SECRET || "usage-summary-test-secret";
    process.env.JWT_SECRET = process.env.JWT_SECRET || "usage-summary-test-jwt";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalValidation(app);
    await app.init();

    usageService = app.get(UsageService);
    credits = app.get(GenerationCreditsService);

    await prisma.user.create({
      data: {
        id: userId,
        email: `${TEST_PREFIX}@test.resonate`,
      },
    });
    await prisma.user.create({
      data: {
        id: otherUserId,
        email: `${TEST_PREFIX}other@test.resonate`,
      },
    });
    await credits.grant(userId, grantedCents, "test_grant");
  });

  afterAll(async () => {
    const ids = [userId, otherUserId];
    await prisma.generationCreditTransaction.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.generationCreditAccount.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  function bearer(sub: string) {
    return `Bearer ${sign({ sub, role: "listener" }, process.env.JWT_SECRET!)}`;
  }

  it("aggregates credits balance, per-kind limits, and the free plan tier", async () => {
    const summary = await usageService.getSummary(userId);

    // Credits: reflects the granted balance and keeps the getBalance shape.
    expect(summary.credits.balanceCents).toBe(grantedCents);
    expect(typeof summary.credits.priceCentsPer30s).toBe("number");
    expect(Array.isArray(summary.credits.recentTransactions)).toBe(true);

    // Limits: both metered kinds, with the registry limit values (50 / 10).
    const byKind = Object.fromEntries(
      summary.limits.map((l) => [l.kind, l]),
    );
    expect(Object.keys(byKind).sort()).toEqual(["lyria", "remix_draft"]);

    const lyria = byKind.lyria;
    expect(lyria.limit).toBe(METERED_ACTIONS.lyria.rateLimit!.limit); // 50
    expect(lyria.label).toBe(METERED_ACTIONS.lyria.label);
    expect(lyria.windowSeconds).toBe(3600);
    expect(lyria.remaining).toBeLessThanOrEqual(lyria.limit);
    expect(lyria.remaining).toBeGreaterThanOrEqual(0);

    const remix = byKind.remix_draft;
    expect(remix.limit).toBe(METERED_ACTIONS.remix_draft.rateLimit!.limit); // 10
    expect(remix.label).toBe(METERED_ACTIONS.remix_draft.label);
    expect(remix.windowSeconds).toBe(3600);
    expect(remix.remaining).toBeLessThanOrEqual(remix.limit);
    expect(remix.remaining).toBeGreaterThanOrEqual(0);

    // A fresh user has recorded no generations → full remaining, no reset.
    expect(lyria.remaining).toBe(lyria.limit);
    expect(lyria.resetsAt).toBeNull();
    expect(remix.remaining).toBe(remix.limit);
    expect(remix.resetsAt).toBeNull();

    // Plan: Free today, no live-money allowance yet (ADR-BM-3).
    expect(summary.plan.tier).toBe("free");
    expect(summary.plan.monthlyAllowanceCents).toBeNull();
    expect(summary.plan).toEqual({ tier: "free", monthlyAllowanceCents: null });
  });

  it("reads Pro from an active operator grant, and free again once revoked (#2406)", async () => {
    const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const grant = await prisma.entitlementGrant.create({
      data: { userId, validUntil, reason: "usage summary test", createdByUserId: otherUserId },
    });
    try {
      const granted = await usageService.getSummary(userId);
      expect(granted.plan).toEqual({
        tier: "pro",
        monthlyAllowanceCents: null,
        source: "operator_grant",
        validUntil: validUntil.toISOString(),
      });
      // The other person's plan is their own.
      expect((await usageService.getSummary(otherUserId)).plan.tier).toBe("free");

      await prisma.entitlementGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
      expect((await usageService.getSummary(userId)).plan).toEqual({ tier: "free", monthlyAllowanceCents: null });
    } finally {
      await prisma.entitlementGrant.deleteMany({ where: { id: grant.id } });
    }
  });
  it("breaks credit spend down per metered kind from the real ledger", async () => {
    // The debit's `kind` argument only decides whether a catalog job-outcome
    // row is created; the breakdown attributes by ledger reason, so a
    // "remix_draft"-kind debit with the lyria reason exercises the lyria row
    // without needing a queued generation job.
    await credits.debit(userId, 10, "lyria_generation", `${TEST_PREFIX}j1`, "remix_draft");
    await credits.debit(userId, 20, "lyria_generation", `${TEST_PREFIX}j2`, "remix_draft");
    await credits.refund(userId, 20, "job_failed_refund", `${TEST_PREFIX}j2`);
    await credits.debit(userId, 10, "remix_draft", `${TEST_PREFIX}j3`, "remix_draft");
    await credits.debit(userId, 5, "remix_part", `${TEST_PREFIX}j4`, "remix_draft");
    // A debit for another user must never leak into this user's breakdown.
    await credits.grant(otherUserId, 100, "test_grant");
    await credits.debit(otherUserId, 40, "lyria_generation", `${TEST_PREFIX}o1`, "remix_draft");

    const summary = await usageService.getSummary(userId);
    const byKind = Object.fromEntries(
      summary.breakdown.items.map((i) => [i.lineId, i]),
    );

    expect(summary.breakdown.periodDays).toBe(30);
    expect(byKind.lyria).toMatchObject({
      charges: 2,
      spentCents: 30,
      refundedCents: 20,
      netCents: 10,
      unitSeconds: 30,
      unitCostCents: summary.credits.priceCentsPer30s,
    });
    expect(byKind.draft).toMatchObject({
      charges: 1,
      spentCents: 10,
      refundedCents: 0,
      netCents: 10,
    });
    expect(byKind.part_take).toMatchObject({
      label: "AI part takes",
      charges: 1,
      spentCents: 5,
      refundedCents: 0,
      netCents: 5,
    });
    // credits, limits and breakdown are separate sections of one payload.
    expect(summary.credits.balanceCents).toBe(grantedCents - 30 + 20 - 15);
    expect(summary.limits.map((l) => l.kind)).toEqual(["lyria", "remix_draft"]);
    expect(summary.limits.every((l) => l.percentLeft === 100)).toBe(true);
  });

  describe("GET /usage/summary (HTTP)", () => {
    it("rejects an unauthenticated request with 401", async () => {
      await request(app.getHttpServer()).get("/usage/summary").expect(401);
    });

    it("returns the caller's own usage and ignores a spoofed userId", async () => {
      const res = await request(app.getHttpServer())
        .get("/usage/summary")
        .query({ userId: otherUserId })
        .set("Authorization", bearer(otherUserId))
        .expect(200);

      // otherUserId's own ledger: granted 100, debited 40 (see breakdown test).
      expect(res.body.credits.balanceCents).toBe(60);
      const lyria = res.body.breakdown.items.find(
        (i: { kind: string }) => i.kind === "lyria",
      );
      expect(lyria.spentCents).toBe(40);

      const mine = await request(app.getHttpServer())
        .get("/usage/summary")
        .query({ userId: otherUserId })
        .set("Authorization", bearer(userId))
        .expect(200);
      expect(mine.body.credits.balanceCents).not.toBe(60);
      expect(Object.keys(mine.body).sort()).toEqual([
        "breakdown",
        "credits",
        "limits",
        "plan",
      ]);
    });
  });
});
