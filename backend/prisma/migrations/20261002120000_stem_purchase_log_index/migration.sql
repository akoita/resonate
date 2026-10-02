-- #1964 (Crate Digger purchase): one transaction can now carry several
-- purchases (a batched user operation buys many listings at once), so
-- "StemPurchase"."transactionHash" stops being unique. A purchase is identified
-- by the (transactionHash, logIndex) of its Sold log. Generated with
-- `prisma migrate diff` against the previous schema, plus the backfill below.

-- DropIndex
DROP INDEX "StemPurchase_transactionHash_key";

-- AlterTable
ALTER TABLE "StemPurchase" ADD COLUMN     "logIndex" INTEGER;

-- Backfill: every purchase recorded before this migration is the first Sold of
-- its transaction (the indexer skipped any later one), so find its Sold log in
-- the raw event table by transaction hash AND listing id. A row with no match
-- keeps a NULL logIndex; the indexer treats such a legacy row as already
-- recorded for its listing, so a replay cannot duplicate it.
UPDATE "StemPurchase" AS p
SET "logIndex" = e."logIndex"
FROM "StemListing" AS l, "ContractEvent" AS e
WHERE l."id" = p."listingId"
  AND e."eventName" = 'Sold'
  AND e."transactionHash" = p."transactionHash"
  AND e."args"->>'listingId' = l."listingId"::text;

-- CreateIndex
CREATE INDEX "StemPurchase_transactionHash_idx" ON "StemPurchase"("transactionHash");

-- CreateIndex
CREATE UNIQUE INDEX "StemPurchase_transactionHash_logIndex_key" ON "StemPurchase"("transactionHash", "logIndex");
