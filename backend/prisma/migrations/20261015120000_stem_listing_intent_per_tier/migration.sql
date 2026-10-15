-- #2041: an artist can list one stem under several license tiers in a single
-- transaction (one StemMarketplaceV2.list() per tier), so a listing intent is
-- now keyed per seller and tier. The seller is part of the key because an
-- ERC-4337 bundle transaction can carry several senders. Existing rows (one
-- per transaction/token) stay valid under the wider unique key.
DROP INDEX "StemListingIntent_transactionHash_tokenId_key";

ALTER TABLE "StemListingIntent" ADD COLUMN "logOrdinal" INTEGER,
ADD COLUMN "listingId" BIGINT;

CREATE UNIQUE INDEX "StemListingIntent_tx_token_seller_license_key"
ON "StemListingIntent"("transactionHash", "tokenId", "sellerAddress", "licenseType");

CREATE INDEX "StemListingIntent_transactionHash_listingId_idx"
ON "StemListingIntent"("transactionHash", "listingId");
