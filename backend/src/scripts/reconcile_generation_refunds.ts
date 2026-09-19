/**
 * Reconcile catalog-generation debits affected by #1778.
 *
 * Dry-run is the default. A missing generated track is not proof of failure;
 * mutation requires a durable Postgres `terminal_failed` outcome.
 *
 *   npm run credits:reconcile-generation-refunds -- --cutoff-hours 24
 *   npm run credits:reconcile-generation-refunds -- --apply
 */
import { prisma } from "../db/prisma";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";

const DEFAULT_SINCE = new Date("2026-07-01T00:00:00.000Z");
const DEFAULT_CUTOFF_HOURS = 24;
const REFUND_REASON = "historical_terminal_failure_refund";

type Candidate = {
  userId: string;
  jobId: string;
  amountCents: number;
  createdAt: Date;
  costRecordExists: boolean;
  generatedTrackExists: boolean;
  outcomeStatus: string | null;
};

export type ReconciliationOptions = {
  apply: boolean;
  cutoffHours?: number;
  since?: Date;
};

export type ReconciliationResult = {
  mode: "dry-run" | "apply";
  candidateCount: number;
  successfulCount: number;
  needsConfirmationCount: number;
  candidateJobIds: string[];
  successfulJobIds: string[];
  needsConfirmationJobIds: string[];
  costRecordJobIds: string[];
  terminalFailedJobIds: string[];
  inconsistentJobIds: string[];
  alreadyRefundedJobIds: string[];
  refundedJobIds: string[];
  totalRefundedCents: number;
};

export async function reconcileGenerationRefunds(
  options: ReconciliationOptions,
): Promise<ReconciliationResult> {
  const cutoffHours = options.cutoffHours ?? DEFAULT_CUTOFF_HOURS;
  const since = options.since ?? DEFAULT_SINCE;
  if (!Number.isFinite(cutoffHours) || cutoffHours <= 0) {
    throw new Error("cutoffHours must be a positive number");
  }
  if (Number.isNaN(since.getTime())) {
    throw new Error("since must be a valid date");
  }

  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000);
  const debits = await prisma.generationCreditTransaction.findMany({
    where: {
      type: "debit",
      reason: "lyria_generation",
      jobId: { not: null },
      createdAt: { gte: since, lt: cutoff },
    },
    select: {
      userId: true,
      jobId: true,
      amountCents: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const jobIds = debits.map((debit) => debit.jobId as string);
  const duplicateDebitJobs = duplicateValues(jobIds);
  if (duplicateDebitJobs.length > 0) {
    throw new Error(
      `Refusing ambiguous duplicate debits for job IDs: ${duplicateDebitJobs.join(", ")}`,
    );
  }

  const [refunds, costRecords, outcomes] = await Promise.all([
    prisma.generationCreditTransaction.findMany({
      where: { type: "refund", jobId: { in: jobIds } },
      select: { userId: true, jobId: true },
    }),
    prisma.generationCostRecord.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true },
      distinct: ["jobId"],
    }),
    prisma.generationJobOutcome.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true, status: true },
    }),
  ]);

  const refundedKeys = new Set(refunds.map((row) => `${row.userId}\0${row.jobId}`));
  const alreadyRefundedJobIds = [...new Set(refunds.flatMap((row) => row.jobId ? [row.jobId] : []))];
  const costJobIds = new Set(costRecords.map((row) => row.jobId));
  const outcomeByJobId = new Map(outcomes.map((row) => [row.jobId, row.status]));
  const candidates: Candidate[] = [];
  for (const debit of debits) {
    const jobId = debit.jobId as string;
    if (refundedKeys.has(`${debit.userId}\0${jobId}`)) continue;
    const generatedTrack = await prisma.track.findFirst({
      where: { generationMetadata: { path: ["jobId"], equals: jobId } },
      select: { id: true },
    });
    candidates.push({
      ...debit,
      jobId,
      costRecordExists: costJobIds.has(jobId),
      generatedTrackExists: Boolean(generatedTrack),
      outcomeStatus: outcomeByJobId.get(jobId) ?? null,
    });
  }

  const inconsistent = candidates.filter(
    (row) =>
      (row.generatedTrackExists && row.outcomeStatus === "terminal_failed") ||
      (!row.generatedTrackExists && row.outcomeStatus === "completed"),
  );
  const refundable = candidates.filter(
    (row) => row.outcomeStatus === "terminal_failed" && !row.generatedTrackExists,
  );
  if (options.apply && inconsistent.length > 0) {
    throw new Error(
      `Refusing reconciliation with inconsistent generation outcomes: ${inconsistent
        .map((row) => row.jobId)
        .join(", ")}`,
    );
  }
  const refundedJobIds: string[] = [];
  let totalRefundedCents = 0;
  if (options.apply) {
    const credits = new GenerationCreditsService();
    for (const row of refundable) {
      await credits.refund(row.userId, row.amountCents, REFUND_REASON, row.jobId);
      refundedJobIds.push(row.jobId);
      totalRefundedCents += row.amountCents;
    }
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    candidateCount: candidates.length,
    successfulCount: candidates.filter(
      (row) => row.generatedTrackExists || row.outcomeStatus === "completed",
    ).length,
    needsConfirmationCount: candidates.filter(
      (row) =>
        !row.generatedTrackExists &&
        row.outcomeStatus !== "completed" &&
        row.outcomeStatus !== "terminal_failed",
    ).length,
    candidateJobIds: candidates.map((row) => row.jobId),
    successfulJobIds: candidates
      .filter((row) => row.generatedTrackExists || row.outcomeStatus === "completed")
      .map((row) => row.jobId),
    needsConfirmationJobIds: candidates
      .filter(
        (row) =>
          !row.generatedTrackExists &&
          row.outcomeStatus !== "completed" &&
          row.outcomeStatus !== "terminal_failed",
      )
      .map((row) => row.jobId),
    costRecordJobIds: candidates
      .filter((row) => row.costRecordExists)
      .map((row) => row.jobId),
    terminalFailedJobIds: refundable.map((row) => row.jobId),
    inconsistentJobIds: inconsistent.map((row) => row.jobId),
    alreadyRefundedJobIds,
    refundedJobIds,
    totalRefundedCents,
  };
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function values(name: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) {
      result.push(process.argv[i + 1]);
      i += 1;
    }
  }
  return result;
}

function value(name: string): string | undefined {
  return values(name)[0];
}

async function main() {
  const cutoffRaw = value("cutoff-hours");
  const sinceRaw = value("since");
  if (values("confirmed-failed-job").length > 0) {
    throw new Error(
      "--confirmed-failed-job is no longer accepted; refund authority comes from durable Postgres outcomes",
    );
  }
  const result = await reconcileGenerationRefunds({
    apply: process.argv.includes("--apply"),
    cutoffHours: cutoffRaw ? Number(cutoffRaw) : undefined,
    since: sinceRaw ? new Date(sinceRaw) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
