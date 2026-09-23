ALTER TYPE "ManagementScope" ADD VALUE 'TRACK_AUDIO';

ALTER TABLE "Track"
  ADD COLUMN "activeAudioRevision" TEXT,
  ADD COLUMN "pendingAudioRevision" TEXT,
  ADD COLUMN "audioReplacementStatus" TEXT,
  ADD COLUMN "audioReplacementError" TEXT,
  ADD COLUMN "pendingAudioFingerprint" TEXT,
  ADD COLUMN "pendingAudioFingerprintHash" TEXT,
  ADD COLUMN "pendingAudioFingerprintDuration" DOUBLE PRECISION;

ALTER TABLE "Stem"
  ADD COLUMN "audioRevision" TEXT,
  ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Stem_trackId_isCurrent_idx" ON "Stem"("trackId", "isCurrent");
