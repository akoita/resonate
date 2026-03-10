-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "disputeIdOnChain" INTEGER,
    "tokenId" TEXT NOT NULL,
    "reporterAddr" TEXT NOT NULL,
    "creatorAddr" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'filed',
    "outcome" TEXT,
    "evidenceURI" TEXT NOT NULL,
    "counterStake" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "submitter" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "evidenceURI" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "CuratorReputation" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "successfulFlags" INTEGER NOT NULL DEFAULT 0,
    "rejectedFlags" INTEGER NOT NULL DEFAULT 0,
    "totalBounties" TEXT NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CuratorReputation_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Dispute_disputeIdOnChain_key" ON "Dispute"("disputeIdOnChain");
-- CreateIndex
CREATE INDEX "Dispute_tokenId_idx" ON "Dispute"("tokenId");
-- CreateIndex
CREATE INDEX "Dispute_reporterAddr_idx" ON "Dispute"("reporterAddr");
-- CreateIndex
CREATE INDEX "Dispute_creatorAddr_idx" ON "Dispute"("creatorAddr");
-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");
-- CreateIndex
CREATE INDEX "DisputeEvidence_disputeId_idx" ON "DisputeEvidence"("disputeId");
-- CreateIndex
CREATE UNIQUE INDEX "CuratorReputation_walletAddress_key" ON "CuratorReputation"("walletAddress");
-- AddForeignKey
ALTER TABLE "DisputeEvidence"
ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;