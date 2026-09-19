import { prisma } from "../db/prisma";
import { reconcileGenerationRefunds } from "../scripts/reconcile_generation_refunds";

const PREFIX = `refund_reconcile_${Date.now()}_`;
const USER_ID = `${PREFIX}user`;
const FAILED_JOB = `${PREFIX}failed`;
const SUCCESS_JOB = `${PREFIX}success`;
const REFUNDED_JOB = `${PREFIX}refunded`;
const OLD_DATE = new Date("2026-07-02T00:00:00.000Z");

describe("generation refund reconciliation", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@test.resonate` },
    });
    await prisma.generationCreditAccount.create({
      data: { userId: USER_ID, balanceCents: 80 },
    });
    await prisma.generationCreditTransaction.createMany({
      data: [
        debit(FAILED_JOB, 10, 90),
        debit(SUCCESS_JOB, 10, 80),
        debit(REFUNDED_JOB, 10, 70),
        {
          userId: USER_ID,
          type: "refund",
          amountCents: 10,
          reason: "job_failed_refund",
          jobId: REFUNDED_JOB,
          balanceAfterCents: 80,
          createdAt: OLD_DATE,
        },
      ],
    });

    const artist = await prisma.artist.create({
      data: { userId: USER_ID, displayName: `${PREFIX}artist` },
    });
    const release = await prisma.release.create({
      data: { artistId: artist.id, title: `${PREFIX}release`, type: "ai_generated" },
    });
    await prisma.track.create({
      data: {
        releaseId: release.id,
        title: `${PREFIX}track`,
        generationMetadata: { jobId: SUCCESS_JOB },
      },
    });
  });

  afterAll(async () => {
    const artist = await prisma.artist.findUnique({ where: { userId: USER_ID } });
    if (artist) {
      await prisma.track.deleteMany({ where: { release: { artistId: artist.id } } });
      await prisma.release.deleteMany({ where: { artistId: artist.id } });
      await prisma.artist.delete({ where: { id: artist.id } });
    }
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: USER_ID } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  it("reports candidates without changing balances", async () => {
    const result = await reconcileGenerationRefunds({
      apply: false,
      confirmedFailedJobIds: [],
      cutoffHours: 1,
    });

    expect(result.candidateJobIds).toEqual(expect.arrayContaining([FAILED_JOB, SUCCESS_JOB]));
    expect(result.candidateJobIds).not.toContain(REFUNDED_JOB);
    expect(result.successfulCount).toBeGreaterThanOrEqual(1);
    expect(result.needsConfirmationCount).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.generationCreditAccount.findUnique({ where: { userId: USER_ID } }),
    ).toMatchObject({ balanceCents: 80 });
  });

  it("refuses to refund a job that produced a generated track", async () => {
    await expect(
      reconcileGenerationRefunds({
        apply: true,
        confirmedFailedJobIds: [SUCCESS_JOB],
        cutoffHours: 1,
      }),
    ).rejects.toThrow(`Refusing to refund successful generation job ${SUCCESS_JOB}`);
  });

  it("refunds an explicitly confirmed failure and makes reruns a no-op", async () => {
    const applied = await reconcileGenerationRefunds({
      apply: true,
      confirmedFailedJobIds: [FAILED_JOB],
      cutoffHours: 1,
    });
    expect(applied.refundedJobIds).toEqual([FAILED_JOB]);
    expect(applied.totalRefundedCents).toBe(10);

    const rerun = await reconcileGenerationRefunds({
      apply: true,
      confirmedFailedJobIds: [FAILED_JOB],
      cutoffHours: 1,
    });
    expect(rerun.refundedJobIds).toEqual([]);
    expect(rerun.alreadyRefundedJobIds).toEqual([FAILED_JOB]);
    expect(
      await prisma.generationCreditTransaction.count({
        where: { userId: USER_ID, jobId: FAILED_JOB, type: "refund" },
      }),
    ).toBe(1);
    expect(
      await prisma.generationCreditAccount.findUnique({ where: { userId: USER_ID } }),
    ).toMatchObject({ balanceCents: 90 });
  });

  it("refuses ambiguous duplicate debits for one job ID", async () => {
    const duplicateJob = `${PREFIX}duplicate`;
    await prisma.generationCreditTransaction.createMany({
      data: [debit(duplicateJob, 10, 80), debit(duplicateJob, 10, 70)],
    });
    try {
      await expect(
        reconcileGenerationRefunds({
          apply: true,
          confirmedFailedJobIds: [duplicateJob],
          cutoffHours: 1,
        }),
      ).rejects.toThrow(`Refusing ambiguous duplicate debits for job IDs: ${duplicateJob}`);
    } finally {
      await prisma.generationCreditTransaction.deleteMany({
        where: { userId: USER_ID, jobId: duplicateJob },
      });
    }
  });
});

function debit(jobId: string, amountCents: number, balanceAfterCents: number) {
  return {
    userId: USER_ID,
    type: "debit",
    amountCents,
    reason: "lyria_generation",
    jobId,
    balanceAfterCents,
    createdAt: OLD_DATE,
  };
}
