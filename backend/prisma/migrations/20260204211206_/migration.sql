-- CreateTable
CREATE TABLE "StemNftMint" (
    "id" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "creatorAddress" TEXT NOT NULL,
    "royaltyBps" INTEGER NOT NULL,
    "remixable" BOOLEAN NOT NULL,
    "metadataUri" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "mintedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StemNftMint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StemListing" (
    "id" TEXT NOT NULL,
    "listingId" BIGINT NOT NULL,
    "stemId" TEXT,
    "tokenId" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "sellerAddress" TEXT NOT NULL,
    "pricePerUnit" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "listedAt" TIMESTAMP(3) NOT NULL,
    "soldAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StemListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StemPurchase" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "totalPaid" TEXT NOT NULL,
    "royaltyPaid" TEXT NOT NULL,
    "protocolFeePaid" TEXT NOT NULL,
    "sellerReceived" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StemPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoyaltyPayment" (
    "id" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoyaltyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractEvent" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StemNftMint_stemId_key" ON "StemNftMint"("stemId");

-- CreateIndex
CREATE UNIQUE INDEX "StemNftMint_transactionHash_key" ON "StemNftMint"("transactionHash");

-- CreateIndex
CREATE INDEX "StemNftMint_tokenId_chainId_idx" ON "StemNftMint"("tokenId", "chainId");

-- CreateIndex
CREATE INDEX "StemNftMint_creatorAddress_idx" ON "StemNftMint"("creatorAddress");

-- CreateIndex
CREATE UNIQUE INDEX "StemListing_transactionHash_key" ON "StemListing"("transactionHash");

-- CreateIndex
CREATE INDEX "StemListing_listingId_chainId_idx" ON "StemListing"("listingId", "chainId");

-- CreateIndex
CREATE INDEX "StemListing_sellerAddress_idx" ON "StemListing"("sellerAddress");

-- CreateIndex
CREATE INDEX "StemListing_tokenId_chainId_idx" ON "StemListing"("tokenId", "chainId");

-- CreateIndex
CREATE INDEX "StemListing_status_idx" ON "StemListing"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StemPurchase_transactionHash_key" ON "StemPurchase"("transactionHash");

-- CreateIndex
CREATE INDEX "StemPurchase_buyerAddress_idx" ON "StemPurchase"("buyerAddress");

-- CreateIndex
CREATE INDEX "StemPurchase_purchasedAt_idx" ON "StemPurchase"("purchasedAt");

-- CreateIndex
CREATE INDEX "RoyaltyPayment_recipientAddress_idx" ON "RoyaltyPayment"("recipientAddress");

-- CreateIndex
CREATE INDEX "RoyaltyPayment_tokenId_chainId_idx" ON "RoyaltyPayment"("tokenId", "chainId");

-- CreateIndex
CREATE INDEX "RoyaltyPayment_paidAt_idx" ON "RoyaltyPayment"("paidAt");

-- CreateIndex
CREATE INDEX "ContractEvent_eventName_idx" ON "ContractEvent"("eventName");

-- CreateIndex
CREATE INDEX "ContractEvent_blockNumber_idx" ON "ContractEvent"("blockNumber");

-- CreateIndex
CREATE INDEX "ContractEvent_contractAddress_chainId_idx" ON "ContractEvent"("contractAddress", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractEvent_transactionHash_logIndex_key" ON "ContractEvent"("transactionHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerState_chainId_key" ON "IndexerState"("chainId");

-- AddForeignKey
ALTER TABLE "StemNftMint" ADD CONSTRAINT "StemNftMint_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StemListing" ADD CONSTRAINT "StemListing_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StemPurchase" ADD CONSTRAINT "StemPurchase_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StemListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
