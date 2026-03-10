/*
  Warnings:

  - The `totalBounties` column on the `CuratorReputation` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "CuratorReputation" DROP COLUMN "totalBounties",
ADD COLUMN     "totalBounties" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "chainId" INTEGER,
ADD COLUMN     "transactionHash" TEXT,
ALTER COLUMN "disputeIdOnChain" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "Dispute_disputeIdOnChain_chainId_idx" ON "Dispute"("disputeIdOnChain", "chainId");
