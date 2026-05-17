-- Track x402 settlement state separately from indexed contract events.
-- This lets the HTTP payment rail be idempotent and explicit about whether a
-- paid download has also reached canonical marketplace/license settlement.

CREATE TABLE "X402Settlement" (
    "id" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "listingId" TEXT,
    "listingChainId" INTEGER,
    "listingContractAddress" TEXT,
    "listingTokenId" BIGINT,
    "payerAddress" TEXT,
    "paymentRail" TEXT NOT NULL DEFAULT 'facilitator',
    "paymentProofSha256" TEXT,
    "paymentTransactionHash" TEXT,
    "receiptId" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'download_granted',
    "contractSettlementStatus" TEXT NOT NULL DEFAULT 'not_applicable',
    "contractSettlementTxHash" TEXT,
    "contractSettlementEventName" TEXT,
    "contractSettlementReason" TEXT,
    "paymentToken" TEXT NOT NULL,
    "paymentAssetId" TEXT,
    "paymentAssetSymbol" TEXT NOT NULL,
    "paymentAssetDecimals" INTEGER NOT NULL,
    "settlementAmount" TEXT NOT NULL,
    "settlementAmountUnits" TEXT NOT NULL,
    "canonicalAmountUsd" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "X402Settlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "X402Settlement_paymentProofSha256_key" ON "X402Settlement"("paymentProofSha256");
CREATE UNIQUE INDEX "X402Settlement_paymentTransactionHash_key" ON "X402Settlement"("paymentTransactionHash");
CREATE UNIQUE INDEX "X402Settlement_receiptId_key" ON "X402Settlement"("receiptId");
CREATE INDEX "X402Settlement_stemId_idx" ON "X402Settlement"("stemId");
CREATE INDEX "X402Settlement_status_idx" ON "X402Settlement"("status");
CREATE INDEX "X402Settlement_contractSettlementStatus_idx" ON "X402Settlement"("contractSettlementStatus");

ALTER TABLE "X402Settlement" ADD CONSTRAINT "X402Settlement_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "X402Settlement" ADD CONSTRAINT "X402Settlement_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StemListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
