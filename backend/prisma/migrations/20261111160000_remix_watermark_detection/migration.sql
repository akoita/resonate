-- Remix watermark detection (#2566 slice 3, #2575): one row per admin check of
-- an uploaded clip, and the evidence kind a match attaches as.
ALTER TYPE "RightsEvidenceKind" ADD VALUE IF NOT EXISTS 'remix_watermark_match';

CREATE TABLE "RemixWatermarkDetection" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "clipSha256" TEXT NOT NULL,
    "clipBytes" INTEGER NOT NULL,
    "candidatesDecoded" INTEGER NOT NULL DEFAULT 0,
    "renderWatermarkId" TEXT,
    "keyId" TEXT,
    "keySlot" TEXT,
    "stage" TEXT,
    "decodeError" DOUBLE PRECISION,
    "syncQuality" DOUBLE PRECISION,
    "occurrences" INTEGER,
    "failureCode" TEXT,
    "evidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RemixWatermarkDetection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemixWatermarkDetection_createdAt_idx" ON "RemixWatermarkDetection"("createdAt");

-- CreateIndex
CREATE INDEX "RemixWatermarkDetection_renderWatermarkId_idx" ON "RemixWatermarkDetection"("renderWatermarkId");

-- AddForeignKey
ALTER TABLE "RemixWatermarkDetection" ADD CONSTRAINT "RemixWatermarkDetection_renderWatermarkId_fkey" FOREIGN KEY ("renderWatermarkId") REFERENCES "RemixRenderWatermark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
