-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "attestation" TEXT,
ADD COLUMN     "attestationSignature" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "contentStatus" TEXT NOT NULL DEFAULT 'clean';

-- CreateTable
CREATE TABLE "AudioFingerprint" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmcaReport" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "claimantName" TEXT NOT NULL,
    "claimantEmail" TEXT NOT NULL,
    "originalWorkUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "counterNotice" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmcaReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudioFingerprint_trackId_key" ON "AudioFingerprint"("trackId");

-- CreateIndex
CREATE INDEX "AudioFingerprint_fingerprintHash_idx" ON "AudioFingerprint"("fingerprintHash");

-- CreateIndex
CREATE INDEX "DmcaReport_trackId_idx" ON "DmcaReport"("trackId");

-- CreateIndex
CREATE INDEX "DmcaReport_status_idx" ON "DmcaReport"("status");

-- AddForeignKey
ALTER TABLE "AudioFingerprint" ADD CONSTRAINT "AudioFingerprint_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmcaReport" ADD CONSTRAINT "DmcaReport_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
