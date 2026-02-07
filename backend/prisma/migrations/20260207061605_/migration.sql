/*
  Warnings:

  - A unique constraint covering the columns `[transactionHash,tokenId]` on the table `RoyaltyPayment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "RoyaltyPayment_transactionHash_tokenId_key" ON "RoyaltyPayment"("transactionHash", "tokenId");
