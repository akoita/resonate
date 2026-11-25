-- Upload limits for accounts that are not yet verified (#2659).
ALTER TABLE "CreatorTrust" ADD COLUMN "uploadLimitsLiftedAt" TIMESTAMP(3);
ALTER TABLE "CreatorTrust" ADD COLUMN "uploadLimitsLiftedBy" TEXT;
