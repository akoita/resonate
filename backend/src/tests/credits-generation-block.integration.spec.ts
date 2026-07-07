/**
 * Generation-credit meter gating createGeneration — Integration Test (#1334).
 *
 * Proves the meter blocks a zero-balance user from starting a Lyria generation
 * (HTTP 402, nothing enqueued) and debits a granted user (job enqueued, balance
 * reduced by the 30s price). Uses a REAL GenerationCreditsService against real
 * Postgres; the BullMQ queue and Lyria/storage are mocked (infrastructure).
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { GenerationService } from "../modules/generation/generation.service";
import {
  GenerationCreditsService,
  InsufficientCreditsException,
} from "../modules/credits/generation-credits.service";

const P = `credgen_${Date.now()}_`;
const POOR = `${P}poor`;
const RICH = `${P}rich`;

describe("Generation-credit meter gates createGeneration", () => {
  const queue = { add: jest.fn().mockResolvedValue({ id: "job" }), getJob: jest.fn() };
  const lyriaClient = { generate: jest.fn() };
  const storageProvider = { upload: jest.fn(), download: jest.fn(), delete: jest.fn() };
  // Config returns undefined for every key → price defaults to 10¢/30s;
  // rate limit falls back to the service default.
  const configService = { get: (_key: string, fallback?: unknown) => fallback };
  const credits = new GenerationCreditsService(configService as any);

  let service: GenerationService;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: POOR, email: `${POOR}@test.resonate` } });
    await prisma.user.create({ data: { id: RICH, email: `${RICH}@test.resonate` } });

    service = new GenerationService(
      new EventBus() as any,
      storageProvider as any,
      {} as any,
      lyriaClient as any,
      configService as any,
      queue as any,
      credits as any,
    );
  });

  afterAll(async () => {
    await prisma.generationCreditTransaction
      .deleteMany({ where: { userId: { in: [POOR, RICH] } } })
      .catch(() => {});
    await prisma.generationCreditAccount
      .deleteMany({ where: { userId: { in: [POOR, RICH] } } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [POOR, RICH] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(() => jest.clearAllMocks());

  it("blocks a zero-balance user and enqueues nothing", async () => {
    await expect(
      service.createGeneration(
        { prompt: "ambient dawn", artistId: "artist-x", durationSeconds: 30 },
        POOR,
      ),
    ).rejects.toBeInstanceOf(InsufficientCreditsException);

    expect(queue.add).not.toHaveBeenCalled();
    expect((await credits.getBalance(POOR)).balanceCents).toBe(0);
  });

  it("debits a granted user and enqueues the job", async () => {
    await credits.grant(RICH, 100, "promo_grant");

    const { jobId } = await service.createGeneration(
      { prompt: "ambient dawn", artistId: "artist-x", durationSeconds: 30 },
      RICH,
    );

    expect(jobId).toBeTruthy();
    expect(queue.add).toHaveBeenCalledTimes(1);

    // 30s at 10¢/30s → 10¢ charged, 90¢ left, one debit txn for this job.
    const { balanceCents, recentTransactions } = await credits.getBalance(RICH);
    expect(balanceCents).toBe(90);
    const debit = recentTransactions.find((t) => t.jobId === jobId && t.type === "debit");
    expect(debit).toMatchObject({ amountCents: 10, balanceAfterCents: 90 });
  });

  it("refunds the charge if enqueue throws (user not charged for a no-op)", async () => {
    await credits.grant(RICH, 50, "promo_grant"); // balance → 140
    queue.add.mockRejectedValueOnce(new Error("redis down"));

    await expect(
      service.createGeneration(
        { prompt: "ambient dusk", artistId: "artist-x", durationSeconds: 60 },
        RICH,
      ),
    ).rejects.toThrow("redis down");

    // 60s → 20¢ debited then refunded, so the balance is back to 140.
    expect((await credits.getBalance(RICH)).balanceCents).toBe(140);
  });
});
