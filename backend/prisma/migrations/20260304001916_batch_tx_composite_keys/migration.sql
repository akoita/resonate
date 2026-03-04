/*
  Warnings:

  - A unique constraint covering the columns `[transactionHash,listingId]` on the table `StemListing` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[transactionHash,tokenId]` on the table `StemNftMint` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "StemListing_transactionHash_key";

-- DropIndex
DROP INDEX "StemNftMint_transactionHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "StemListing_transactionHash_listingId_key" ON "StemListing"("transactionHash", "listingId");

-- CreateIndex
CREATE UNIQUE INDEX "StemNftMint_transactionHash_tokenId_key" ON "StemNftMint"("transactionHash", "tokenId");
