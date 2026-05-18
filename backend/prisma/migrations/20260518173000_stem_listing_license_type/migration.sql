ALTER TABLE "StemListing"
ADD COLUMN "licenseType" "LicenseType" NOT NULL DEFAULT 'personal';

CREATE TABLE "StemListingIntent" (
    "id" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "tokenId" BIGINT,
    "stemId" TEXT,
    "chainId" INTEGER NOT NULL,
    "sellerAddress" TEXT,
    "pricePerUnit" TEXT,
    "amount" BIGINT,
    "paymentToken" TEXT,
    "licenseType" "LicenseType" NOT NULL DEFAULT 'personal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StemListingIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StemListingIntent_transactionHash_tokenId_key"
ON "StemListingIntent"("transactionHash", "tokenId");

CREATE INDEX "StemListing_licenseType_idx"
ON "StemListing"("licenseType");

CREATE INDEX "StemListingIntent_transactionHash_idx"
ON "StemListingIntent"("transactionHash");

CREATE INDEX "StemListingIntent_stemId_idx"
ON "StemListingIntent"("stemId");

CREATE INDEX "StemListingIntent_licenseType_idx"
ON "StemListingIntent"("licenseType");
