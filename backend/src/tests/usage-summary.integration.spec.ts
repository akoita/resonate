import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../modules/app.module";
import { UsageService } from "../modules/usage/usage.service";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { METERED_ACTIONS } from "../modules/credits/metered-actions";
import { prisma } from "../db/prisma";

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
    await app.init();

    usageService = app.get(UsageService);
    credits = app.get(GenerationCreditsService);

    await prisma.user.create({
      data: {
        id: userId,
        email: `${TEST_PREFIX}@test.resonate`,
      },
    });
    await credits.grant(userId, grantedCents, "test_grant");
  });

  afterAll(async () => {
    await prisma.generationCreditTransaction.deleteMany({ where: { userId } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

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
    expect(lyria.limit).toBe(METERED_ACTIONS.lyria.rateLimit.limit); // 50
    expect(lyria.label).toBe(METERED_ACTIONS.lyria.label);
    expect(lyria.windowSeconds).toBe(3600);
    expect(lyria.remaining).toBeLessThanOrEqual(lyria.limit);
    expect(lyria.remaining).toBeGreaterThanOrEqual(0);

    const remix = byKind.remix_draft;
    expect(remix.limit).toBe(METERED_ACTIONS.remix_draft.rateLimit.limit); // 10
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
  });
});
