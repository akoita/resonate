-- #948: ShowCampaignEscrow event indexer + on-chain reconciliation.

-- AlterTable: on-chain reconciliation columns driven only by indexed events.
ALTER TABLE "ShowCampaign"
  ADD COLUMN "onChainStatus" TEXT,
  ADD COLUMN "totalRefundedUnits" TEXT NOT NULL DEFAULT '0',
  ADD COLUMN "totalReleasedUnits" TEXT NOT NULL DEFAULT '0',
  ADD COLUMN "lastEscrowIndexedBlock" BIGINT,
  ADD COLUMN "reconciliationErrorAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationError" TEXT;

-- CreateTable: per-chain block cursor for the escrow indexer.
CREATE TABLE "ShowEscrowIndexerState" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowEscrowIndexerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable: idempotent processed-event log.
CREATE TABLE "ShowCampaignEscrowEvent" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "contractCampaignId" TEXT,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowCampaignEscrowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShowEscrowIndexerState_chainId_key" ON "ShowEscrowIndexerState"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowCampaignEscrowEvent_transactionHash_logIndex_key" ON "ShowCampaignEscrowEvent"("transactionHash", "logIndex");

-- CreateIndex
CREATE INDEX "ShowCampaignEscrowEvent_contractCampaignId_eventName_idx" ON "ShowCampaignEscrowEvent"("contractCampaignId", "eventName");

-- CreateIndex
CREATE INDEX "ShowCampaignEscrowEvent_blockNumber_idx" ON "ShowCampaignEscrowEvent"("blockNumber");

-- CreateIndex
CREATE INDEX "ShowCampaignEscrowEvent_chainId_contractAddress_idx" ON "ShowCampaignEscrowEvent"("chainId", "contractAddress");
