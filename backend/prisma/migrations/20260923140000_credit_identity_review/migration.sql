ALTER TABLE "ReleaseArtistCredit"
  ADD COLUMN "identityReviewedAt" TIMESTAMP(3),
  ADD COLUMN "identityReviewerUserId" TEXT,
  ADD COLUMN "identityReviewNote" TEXT;
