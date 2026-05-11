-- Trusted-source registry and source-link request workflow.

CREATE TYPE "TrustedSourceType" AS ENUM (
  'distributor',
  'label',
  'official_artist_team',
  'catalog_operator'
);

CREATE TYPE "TrustedSourceTrustLevel" AS ENUM (
  'standard',
  'high',
  'very_high'
);

CREATE TYPE "TrustedSourceReviewState" AS ENUM (
  'pending_review',
  'active',
  'suspended',
  'revoked',
  'denied'
);

CREATE TYPE "TrustedSourceLinkStatus" AS ENUM (
  'active',
  'suspended',
  'revoked'
);

CREATE TYPE "TrustedSourceLinkRequestStatus" AS ENUM (
  'submitted',
  'under_review',
  'approved',
  'denied'
);

ALTER TYPE "RightsEvidenceSubjectType" ADD VALUE IF NOT EXISTS 'trusted_source_link_request';
ALTER TYPE "RightsEvidenceBundlePurpose" ADD VALUE IF NOT EXISTS 'trusted_source_link_request';

CREATE TABLE "TrustedSource" (
  "id" TEXT NOT NULL,
  "type" "TrustedSourceType" NOT NULL,
  "name" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "trustLevel" "TrustedSourceTrustLevel" NOT NULL DEFAULT 'standard',
  "reviewState" "TrustedSourceReviewState" NOT NULL DEFAULT 'pending_review',
  "domain" TEXT,
  "feedUrl" TEXT,
  "traceability" JSONB,
  "createdByAddress" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "downgradedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrustedSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrustedSourceArtistLink" (
  "id" TEXT NOT NULL,
  "artistId" TEXT NOT NULL,
  "trustedSourceId" TEXT NOT NULL,
  "status" "TrustedSourceLinkStatus" NOT NULL DEFAULT 'active',
  "trustLevel" "TrustedSourceTrustLevel" NOT NULL DEFAULT 'standard',
  "sourceType" "TrustedSourceType" NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrustedSourceArtistLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrustedSourceLinkRequest" (
  "id" TEXT NOT NULL,
  "artistId" TEXT NOT NULL,
  "trustedSourceId" TEXT,
  "requesterAddress" TEXT NOT NULL,
  "requestedSourceType" "TrustedSourceType" NOT NULL,
  "sourceName" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "requestedTrustLevel" "TrustedSourceTrustLevel" NOT NULL DEFAULT 'standard',
  "proofSummary" TEXT NOT NULL,
  "status" "TrustedSourceLinkRequestStatus" NOT NULL DEFAULT 'submitted',
  "decisionReason" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrustedSourceLinkRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrustedSource_type_sourceKey_key" ON "TrustedSource"("type", "sourceKey");
CREATE INDEX "TrustedSource_reviewState_idx" ON "TrustedSource"("reviewState");
CREATE INDEX "TrustedSource_type_idx" ON "TrustedSource"("type");
CREATE INDEX "TrustedSource_trustLevel_idx" ON "TrustedSource"("trustLevel");

CREATE UNIQUE INDEX "TrustedSourceArtistLink_artistId_trustedSourceId_key" ON "TrustedSourceArtistLink"("artistId", "trustedSourceId");
CREATE INDEX "TrustedSourceArtistLink_artistId_status_idx" ON "TrustedSourceArtistLink"("artistId", "status");
CREATE INDEX "TrustedSourceArtistLink_trustedSourceId_status_idx" ON "TrustedSourceArtistLink"("trustedSourceId", "status");
CREATE INDEX "TrustedSourceArtistLink_sourceType_idx" ON "TrustedSourceArtistLink"("sourceType");

CREATE INDEX "TrustedSourceLinkRequest_artistId_createdAt_idx" ON "TrustedSourceLinkRequest"("artistId", "createdAt");
CREATE INDEX "TrustedSourceLinkRequest_status_createdAt_idx" ON "TrustedSourceLinkRequest"("status", "createdAt");
CREATE INDEX "TrustedSourceLinkRequest_requestedSourceType_idx" ON "TrustedSourceLinkRequest"("requestedSourceType");
CREATE INDEX "TrustedSourceLinkRequest_trustedSourceId_idx" ON "TrustedSourceLinkRequest"("trustedSourceId");

ALTER TABLE "TrustedSourceArtistLink"
  ADD CONSTRAINT "TrustedSourceArtistLink_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrustedSourceArtistLink"
  ADD CONSTRAINT "TrustedSourceArtistLink_trustedSourceId_fkey"
  FOREIGN KEY ("trustedSourceId") REFERENCES "TrustedSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrustedSourceLinkRequest"
  ADD CONSTRAINT "TrustedSourceLinkRequest_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrustedSourceLinkRequest"
  ADD CONSTRAINT "TrustedSourceLinkRequest_trustedSourceId_fkey"
  FOREIGN KEY ("trustedSourceId") REFERENCES "TrustedSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
