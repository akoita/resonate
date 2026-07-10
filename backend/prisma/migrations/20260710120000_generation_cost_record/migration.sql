-- #1421 Realized per-job generation cost telemetry (ADR-BM-3): append-only
-- observations of model-estimated COGS + backend wall-clock per settled
-- generation, for later reconciliation against real cloud billing.

-- CreateTable
CREATE TABLE "GenerationCostRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "wallClockMs" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL,
    "sellPriceCents" INTEGER NOT NULL,
    "coldStart" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationCostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationCostRecord_userId_createdAt_idx" ON "GenerationCostRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationCostRecord_path_createdAt_idx" ON "GenerationCostRecord"("path", "createdAt");

-- AddForeignKey
ALTER TABLE "GenerationCostRecord" ADD CONSTRAINT "GenerationCostRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
