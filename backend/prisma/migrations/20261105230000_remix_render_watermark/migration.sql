-- Remix render watermark tokens (#2566 slice 2, #2573): one admin-only row per
-- watermarked render job.
CREATE TABLE "RemixRenderWatermark" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "remixProjectId" TEXT NOT NULL,
    "generationJobId" TEXT NOT NULL,
    "renderJobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceTrackId" TEXT NOT NULL,
    "secondarySourceTrackId" TEXT,
    "stemIds" TEXT[],
    "stemLicenses" JSONB NOT NULL,
    "renderedStemIndexes" INTEGER[],
    "policyVersion" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "schemeVersion" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemixRenderWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemixRenderWatermark_token_key" ON "RemixRenderWatermark"("token");

-- CreateIndex
CREATE INDEX "RemixRenderWatermark_remixProjectId_idx" ON "RemixRenderWatermark"("remixProjectId");

-- CreateIndex
CREATE INDEX "RemixRenderWatermark_userId_idx" ON "RemixRenderWatermark"("userId");

-- CreateIndex
CREATE INDEX "RemixRenderWatermark_sourceTrackId_idx" ON "RemixRenderWatermark"("sourceTrackId");

-- AddForeignKey
ALTER TABLE "RemixRenderWatermark" ADD CONSTRAINT "RemixRenderWatermark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
