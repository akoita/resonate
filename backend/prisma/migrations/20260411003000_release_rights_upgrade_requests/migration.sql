-- AlterEnum
ALTER TYPE "RightsEvidenceBundlePurpose" ADD VALUE 'rights_upgrade_request';

-- CreateTable
CREATE TABLE "ReleaseRightsUpgradeRequest" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "requestedByAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "requestedRoute" TEXT NOT NULL DEFAULT 'STANDARD_ESCROW',
    "currentRouteAtSubmission" TEXT,
    "summary" TEXT,
    "decisionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseRightsUpgradeRequest_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "RightsEvidenceBundle" ADD COLUMN "rightsUpgradeRequestId" TEXT;

-- CreateIndex
CREATE INDEX "ReleaseRightsUpgradeRequest_releaseId_createdAt_idx" ON "ReleaseRightsUpgradeRequest"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseRightsUpgradeRequest_artistId_createdAt_idx" ON "ReleaseRightsUpgradeRequest"("artistId", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseRightsUpgradeRequest_status_createdAt_idx" ON "ReleaseRightsUpgradeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RightsEvidenceBundle_rightsUpgradeRequestId_idx" ON "RightsEvidenceBundle"("rightsUpgradeRequestId");

-- AddForeignKey
ALTER TABLE "ReleaseRightsUpgradeRequest" ADD CONSTRAINT "ReleaseRightsUpgradeRequest_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRightsUpgradeRequest" ADD CONSTRAINT "ReleaseRightsUpgradeRequest_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsEvidenceBundle" ADD CONSTRAINT "RightsEvidenceBundle_rightsUpgradeRequestId_fkey" FOREIGN KEY ("rightsUpgradeRequestId") REFERENCES "ReleaseRightsUpgradeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
