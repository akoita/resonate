-- AlterTable
ALTER TABLE "Track"
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "lastProgressAt" TIMESTAMP(3);
