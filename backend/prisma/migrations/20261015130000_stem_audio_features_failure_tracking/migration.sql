-- Audio-feature backfill failure tracking (#2012): stems whose analysis keeps
-- failing are held back instead of being re-selected on every run.
ALTER TABLE "Stem" ADD COLUMN "audioFeaturesFailedAt" TIMESTAMP(3);
ALTER TABLE "Stem" ADD COLUMN "audioFeaturesFailureCount" INTEGER NOT NULL DEFAULT 0;
