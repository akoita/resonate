-- CreateTable
CREATE TABLE "StemQualityRating" (
    "id" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "curatorId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rmsEnergy" DOUBLE PRECISION NOT NULL,
    "spectralDensity" DOUBLE PRECISION NOT NULL,
    "silenceRatio" DOUBLE PRECISION NOT NULL,
    "musicalSalience" DOUBLE PRECISION NOT NULL,
    "analysisJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StemQualityRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StemQualityRating_stemId_idx" ON "StemQualityRating"("stemId");

-- CreateIndex
CREATE INDEX "StemQualityRating_score_idx" ON "StemQualityRating"("score");

-- CreateIndex
CREATE UNIQUE INDEX "StemQualityRating_stemId_curatorId_key" ON "StemQualityRating"("stemId", "curatorId");

-- AddForeignKey
ALTER TABLE "StemQualityRating" ADD CONSTRAINT "StemQualityRating_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
