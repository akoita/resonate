-- CreateTable
CREATE TABLE "ContentProtectionStake" (
    "id" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "stakerAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "depositedAt" TIMESTAMP(3) NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "slashedAt" TIMESTAMP(3),
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentProtectionStake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAttestation" (
    "id" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "attesterAddress" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentProtectionStake_stakerAddress_idx" ON "ContentProtectionStake"("stakerAddress");

-- CreateIndex
CREATE INDEX "ContentProtectionStake_active_idx" ON "ContentProtectionStake"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProtectionStake_tokenId_chainId_key" ON "ContentProtectionStake"("tokenId", "chainId");

-- CreateIndex
CREATE INDEX "ContentAttestation_attesterAddress_idx" ON "ContentAttestation"("attesterAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAttestation_tokenId_chainId_key" ON "ContentAttestation"("tokenId", "chainId");
