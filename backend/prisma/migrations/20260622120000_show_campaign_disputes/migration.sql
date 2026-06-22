-- #950: off-chain Shows escrow dispute workflow.

-- CreateEnum
CREATE TYPE "ShowCampaignDisputeStatus" AS ENUM ('open', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "ShowCampaignDisputeOutcome" AS ENUM ('upheld', 'rejected', 'inconclusive');

-- AlterEnum
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'dispute_initiated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'dispute_resolved';

-- CreateTable
CREATE TABLE "ShowCampaignDispute" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "initiatorUserId" TEXT,
    "initiatorRole" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ShowCampaignDisputeStatus" NOT NULL DEFAULT 'open',
    "outcome" "ShowCampaignDisputeOutcome",
    "operatorNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowCampaignDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShowCampaignDispute_campaignId_status_idx" ON "ShowCampaignDispute"("campaignId", "status");

-- CreateIndex
CREATE INDEX "ShowCampaignDispute_status_createdAt_idx" ON "ShowCampaignDispute"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ShowCampaignDispute" ADD CONSTRAINT "ShowCampaignDispute_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ShowCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowCampaignDispute" ADD CONSTRAINT "ShowCampaignDispute_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
