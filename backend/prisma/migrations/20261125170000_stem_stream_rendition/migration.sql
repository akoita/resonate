-- Streaming renditions (#2661): listeners receive a lossy copy, never the original.
ALTER TABLE "Stem" ADD COLUMN "streamUri" TEXT;
ALTER TABLE "Stem" ADD COLUMN "streamStorageProvider" TEXT;
ALTER TABLE "Stem" ADD COLUMN "streamMimeType" TEXT;
ALTER TABLE "Stem" ADD COLUMN "streamCreatedAt" TIMESTAMP(3);
ALTER TABLE "Stem" ADD COLUMN "streamFailedAt" TIMESTAMP(3);
ALTER TABLE "Stem" ADD COLUMN "streamFailureCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Stem_isCurrent_streamUri_idx" ON "Stem"("isCurrent", "streamUri");
