/**
 * Reconcile catalog-generation debits affected by #1778.
 *
 * Dry-run is the default. A missing generated track is not proof of failure, so
 * mutation requires each job ID to have been independently confirmed as a
 * terminal failure from BullMQ history or worker logs.
 *
 *   npm run credits:reconcile-generation-refunds -- --cutoff-hours 24
 *   npm run credits:reconcile-generation-refunds -- \
 *     --confirmed-failed-job <job-id> [--confirmed-failed-job <job-id> ...]
 *   npm run credits:reconcile-generation-refunds -- --apply \
 *     --confirmed-failed-job <job-id> [--confirmed-failed-job <job-id> ...]
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
};

export type ReconciliationOptions = {
  apply: boolean;
  confirmedFailedJobIds: string[];
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
  confirmedFailedJobIds: string[];
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

  const [refunds, costRecords] = await Promise.all([
    prisma.generationCreditTransaction.findMany({
      where: { type: "refund", jobId: { in: jobIds } },
      select: { userId: true, jobId: true },
    }),
    prisma.generationCostRecord.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true },
      distinct: ["jobId"],
    }),
  ]);

  const refundedKeys = new Set(refunds.map((row) => `${row.userId}\0${row.jobId}`));
  const costJobIds = new Set(costRecords.map((row) => row.jobId));
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
    });
  }

  const requested = [...new Set(options.confirmedFailedJobIds.filter(Boolean))];
  const requestedRows = new Map(candidates.map((row) => [row.jobId, row]));
  const alreadyRefundedJobIds: string[] = [];
  const invalidJobIds: string[] = [];

  for (const jobId of requested) {
    const candidate = requestedRows.get(jobId);
    if (candidate) {
      if (candidate.generatedTrackExists) {
        throw new Error(`Refusing to refund successful generation job ${jobId}`);
      }
      continue;
    }

    const matchingDebits = await prisma.generationCreditTransaction.findMany({
      where: { type: "debit", reason: "lyria_generation", jobId },
      select: { userId: true },
    });
    if (matchingDebits.length !== 1) {
      invalidJobIds.push(jobId);
      continue;
    }
    const debit = matchingDebits[0];
    const refund = await prisma.generationCreditTransaction.findFirst({
      where: { type: "refund", jobId, userId: debit.userId },
      select: { id: true },
    });
    if (refund) alreadyRefundedJobIds.push(jobId);
    else invalidJobIds.push(jobId);
  }

  if (invalidJobIds.length > 0) {
    throw new Error(
      `Confirmed job IDs are not eligible historical debits: ${invalidJobIds.join(", ")}`,
    );
  }

  const refundable = requested
    .map((jobId) => requestedRows.get(jobId))
    .filter((row): row is Candidate => Boolean(row));
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
    successfulCount: candidates.filter((row) => row.generatedTrackExists).length,
    needsConfirmationCount: candidates.filter((row) => !row.generatedTrackExists).length,
    candidateJobIds: candidates.map((row) => row.jobId),
    successfulJobIds: candidates
      .filter((row) => row.generatedTrackExists)
      .map((row) => row.jobId),
    needsConfirmationJobIds: candidates
      .filter((row) => !row.generatedTrackExists)
      .map((row) => row.jobId),
    costRecordJobIds: candidates
      .filter((row) => row.costRecordExists)
      .map((row) => row.jobId),
    confirmedFailedJobIds: requested,
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
  const result = await reconcileGenerationRefunds({
    apply: process.argv.includes("--apply"),
    confirmedFailedJobIds: values("confirmed-failed-job"),
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
