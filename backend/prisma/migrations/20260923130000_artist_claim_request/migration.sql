BEGIN;

CREATE TYPE "ArtistClaimRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked');

CREATE TABLE "ArtistClaimRequest" (
  "id" TEXT NOT NULL,
  "artistId" TEXT NOT NULL,
  "claimantUserId" TEXT NOT NULL,
  "evidence" TEXT,
  "status" "ArtistClaimRequestStatus" NOT NULL DEFAULT 'pending',
  "reviewerUserId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ArtistClaimRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArtistClaimRequest_claimantUserId_createdAt_idx"
  ON "ArtistClaimRequest"("claimantUserId", "createdAt");
CREATE INDEX "ArtistClaimRequest_status_createdAt_idx"
  ON "ArtistClaimRequest"("status", "createdAt");

CREATE UNIQUE INDEX "ArtistClaimRequest_one_pending_per_artist_claimant"
  ON "ArtistClaimRequest"("artistId", "claimantUserId")
  WHERE "status" = 'pending';
CREATE UNIQUE INDEX "ArtistClaimRequest_one_approved_per_artist"
  ON "ArtistClaimRequest"("artistId")
  WHERE "status" = 'approved';

ALTER TABLE "ArtistClaimRequest"
  ADD CONSTRAINT "ArtistClaimRequest_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistClaimRequest"
  ADD CONSTRAINT "ArtistClaimRequest_claimantUserId_fkey"
  FOREIGN KEY ("claimantUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistClaimRequest"
  ADD CONSTRAINT "ArtistClaimRequest_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
