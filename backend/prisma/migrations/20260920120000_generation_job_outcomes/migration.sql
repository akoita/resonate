-- Durable Postgres evidence for metered catalogue-generation outcomes (#1815).
-- The row is born in the same transaction as its credit debit; terminal
-- failure and catalogue completion no longer depend on expiring BullMQ state.
CREATE TYPE "GenerationJobOutcomeStatus" AS ENUM (
  'queued',
  'in_flight',
  'completed',
  'terminal_failed',
  'enqueue_failed'
);

CREATE TABLE "GenerationJobOutcome" (
  "jobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "GenerationJobOutcomeStatus" NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "trackId" TEXT,
  "releaseId" TEXT,
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "terminalAt" TIMESTAMP(3),
  CONSTRAINT "GenerationJobOutcome_pkey" PRIMARY KEY ("jobId")
);

CREATE INDEX "GenerationJobOutcome_userId_status_updatedAt_idx"
  ON "GenerationJobOutcome"("userId", "status", "updatedAt");

ALTER TABLE "GenerationJobOutcome"
  ADD CONSTRAINT "GenerationJobOutcome_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
