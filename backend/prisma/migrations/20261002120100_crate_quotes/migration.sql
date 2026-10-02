-- #1964 (Crate Digger purchase, docs/rfc/taste-engine.md section 5.4): crate
-- quotes and their lines. A quote holds on-chain prices (raw token units) and
-- the settlement receipt of each line. "CrateQuoteLine"."trackId", "stemId" and
-- "listingRowId" have no foreign key on purpose, so a later catalog change
-- cannot rewrite what the DJ approved; the listing and price columns are NULL on
-- a dropped line that never had a listing (reason not_listed). Generated with
-- `prisma migrate diff` against the previous schema; no unrelated drift.

-- CreateTable
CREATE TABLE "CrateQuote" (
    "id" TEXT NOT NULL,
    "crateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "chainId" INTEGER NOT NULL,
    "marketplaceAddress" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "quotedAtBlock" BIGINT NOT NULL,
    "transactionHash" TEXT,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrateQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrateQuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "trackId" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "stemType" TEXT NOT NULL,
    "licenseType" "LicenseType" NOT NULL,
    "listingRowId" TEXT,
    "listingId" BIGINT,
    "tokenId" BIGINT,
    "amount" BIGINT NOT NULL DEFAULT 1,
    "paymentToken" TEXT,
    "totalPriceUnits" TEXT,
    "royaltyUnits" TEXT,
    "protocolFeeUnits" TEXT,
    "sellerUnits" TEXT,
    "status" TEXT NOT NULL DEFAULT 'quoted',
    "reason" TEXT,
    "logIndex" INTEGER,
    "settledTotalUnits" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrateQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrateQuote_transactionHash_key" ON "CrateQuote"("transactionHash");

-- CreateIndex
CREATE INDEX "CrateQuote_crateId_createdAt_idx" ON "CrateQuote"("crateId", "createdAt");

-- CreateIndex
CREATE INDEX "CrateQuote_userId_idx" ON "CrateQuote"("userId");

-- CreateIndex
CREATE INDEX "CrateQuoteLine_quoteId_position_idx" ON "CrateQuoteLine"("quoteId", "position");

-- CreateIndex
CREATE INDEX "CrateQuoteLine_userId_idx" ON "CrateQuoteLine"("userId");

-- AddForeignKey
ALTER TABLE "CrateQuote" ADD CONSTRAINT "CrateQuote_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateQuote" ADD CONSTRAINT "CrateQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateQuoteLine" ADD CONSTRAINT "CrateQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrateQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateQuoteLine" ADD CONSTRAINT "CrateQuoteLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

