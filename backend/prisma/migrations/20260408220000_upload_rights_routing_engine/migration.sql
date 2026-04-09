-- Add persisted upload-rights routing state to releases and tracks.
ALTER TABLE "Release"
ADD COLUMN "rightsRoute" TEXT,
ADD COLUMN "rightsFlags" JSONB,
ADD COLUMN "rightsReason" TEXT,
ADD COLUMN "rightsPolicyVersion" TEXT,
ADD COLUMN "rightsSourceType" TEXT,
ADD COLUMN "rightsEvaluatedAt" TIMESTAMP(3);

ALTER TABLE "Track"
ADD COLUMN "rightsRoute" TEXT,
ADD COLUMN "rightsFlags" JSONB,
ADD COLUMN "rightsReason" TEXT,
ADD COLUMN "rightsPolicyVersion" TEXT,
ADD COLUMN "rightsEvaluatedAt" TIMESTAMP(3);

CREATE INDEX "Release_rightsRoute_idx" ON "Release"("rightsRoute");
CREATE INDEX "Track_rightsRoute_idx" ON "Track"("rightsRoute");
