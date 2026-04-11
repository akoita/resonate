-- CreateEnum
CREATE TYPE "RightsEvidenceSubjectType" AS ENUM ('upload', 'release', 'track', 'dispute');

-- CreateEnum
CREATE TYPE "RightsEvidenceRole" AS ENUM ('reporter', 'creator', 'ops', 'trusted_source', 'system');

-- CreateEnum
CREATE TYPE "RightsEvidenceKind" AS ENUM ('trusted_catalog_reference', 'fingerprint_match', 'prior_publication', 'rights_metadata', 'proof_of_control', 'legal_notice', 'narrative_statement', 'internal_review_note');

-- CreateEnum
CREATE TYPE "RightsEvidenceStrength" AS ENUM ('low', 'medium', 'high', 'very_high');

-- CreateEnum
CREATE TYPE "RightsEvidenceVerificationStatus" AS ENUM ('unverified', 'verified', 'rejected', 'system_generated');

-- CreateEnum
CREATE TYPE "RightsEvidenceBundlePurpose" AS ENUM ('upload_review', 'dispute_report', 'creator_response', 'ops_review', 'jury_packet');

-- AlterTable
ALTER TABLE "Release" ADD COLUMN "processingError" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN "processingError" TEXT;

-- CreateTable
CREATE TABLE "RightsEvidenceBundle" (
    "id" TEXT NOT NULL,
    "subjectType" "RightsEvidenceSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "submittedByRole" "RightsEvidenceRole" NOT NULL,
    "submittedByAddress" TEXT,
    "purpose" "RightsEvidenceBundlePurpose" NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RightsEvidenceBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsEvidence" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT,
    "subjectType" "RightsEvidenceSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "submittedByRole" "RightsEvidenceRole" NOT NULL,
    "submittedByAddress" TEXT,
    "kind" "RightsEvidenceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceUrl" TEXT,
    "sourceLabel" TEXT,
    "claimedRightsholder" TEXT,
    "artistName" TEXT,
    "releaseTitle" TEXT,
    "publicationDate" TIMESTAMP(3),
    "isrc" TEXT,
    "upc" TEXT,
    "fingerprintConfidence" DOUBLE PRECISION,
    "strength" "RightsEvidenceStrength" NOT NULL,
    "verificationStatus" "RightsEvidenceVerificationStatus" NOT NULL DEFAULT 'unverified',
    "attachments" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RightsEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RightsEvidenceBundle_subjectType_subjectId_idx" ON "RightsEvidenceBundle"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "RightsEvidenceBundle_purpose_idx" ON "RightsEvidenceBundle"("purpose");

-- CreateIndex
CREATE INDEX "RightsEvidenceBundle_submittedByRole_idx" ON "RightsEvidenceBundle"("submittedByRole");

-- CreateIndex
CREATE INDEX "RightsEvidence_subjectType_subjectId_idx" ON "RightsEvidence"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "RightsEvidence_bundleId_idx" ON "RightsEvidence"("bundleId");

-- CreateIndex
CREATE INDEX "RightsEvidence_submittedByRole_idx" ON "RightsEvidence"("submittedByRole");

-- CreateIndex
CREATE INDEX "RightsEvidence_kind_idx" ON "RightsEvidence"("kind");

-- CreateIndex
CREATE INDEX "RightsEvidence_verificationStatus_idx" ON "RightsEvidence"("verificationStatus");

-- AddForeignKey
ALTER TABLE "RightsEvidence" ADD CONSTRAINT "RightsEvidence_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "RightsEvidenceBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
