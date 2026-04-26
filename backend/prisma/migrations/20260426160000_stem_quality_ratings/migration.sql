-- CreateTable
CREATE TABLE "StemQualityRating" (
    "id" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "curatorUserId" TEXT NOT NULL,
    "curatorAgentConfigId" TEXT,
    "curatorIdentityRegistry" TEXT,
    "curatorIdentityTokenId" TEXT,
    "score" INTEGER NOT NULL,
    "rmsEnergy" DOUBLE PRECISION NOT NULL,
    "spectralDensity" DOUBLE PRECISION NOT NULL,
    "silenceRatio" DOUBLE PRECISION NOT NULL,
    "musicalSalience" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taskType" TEXT NOT NULL DEFAULT 'stem.quality_rating',
    "analysisMethod" TEXT NOT NULL,
    "analysisMetadata" JSONB,
    "analysisUri" TEXT,
    "onchainMetadataKey" TEXT,
    "onchainTaskHash" TEXT,
    "onchainTxHash" TEXT,
    "onchainStatus" TEXT NOT NULL DEFAULT 'local',
    "onchainError" TEXT,
    "purchaseValidationCount" INTEGER NOT NULL DEFAULT 0,
    "skipValidationCount" INTEGER NOT NULL DEFAULT 0,
    "reputationDelta" INTEGER NOT NULL DEFAULT 0,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StemQualityRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StemQualityRating_stemId_curatorUserId_key" ON "StemQualityRating"("stemId", "curatorUserId");

-- CreateIndex
CREATE INDEX "StemQualityRating_stemId_score_idx" ON "StemQualityRating"("stemId", "score");

-- CreateIndex
CREATE INDEX "StemQualityRating_curatorUserId_createdAt_idx" ON "StemQualityRating"("curatorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "StemQualityRating_onchainTaskHash_idx" ON "StemQualityRating"("onchainTaskHash");

-- AddForeignKey
ALTER TABLE "StemQualityRating" ADD CONSTRAINT "StemQualityRating_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StemQualityRating" ADD CONSTRAINT "StemQualityRating_curatorUserId_fkey" FOREIGN KEY ("curatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
