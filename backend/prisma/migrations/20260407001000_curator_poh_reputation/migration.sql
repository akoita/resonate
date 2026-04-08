ALTER TABLE "CuratorReputation"
ADD COLUMN "reportsFiled" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastActiveAt" TIMESTAMP(3),
ADD COLUMN "verifiedHuman" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "humanVerificationProvider" TEXT,
ADD COLUMN "humanVerificationStatus" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN "humanVerificationScore" DOUBLE PRECISION,
ADD COLUMN "humanVerificationThreshold" DOUBLE PRECISION,
ADD COLUMN "humanVerifiedAt" TIMESTAMP(3),
ADD COLUMN "humanVerificationExpiresAt" TIMESTAMP(3);
