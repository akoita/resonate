-- #2344: a batched transaction can carry several sales of one token, each with its
-- own RoyaltyPaid log. "RoyaltyPayment" was unique on (transactionHash, tokenId), so
-- the second royalty of such a transaction was dropped. A payment is now the
-- (transactionHash, logIndex) of its RoyaltyPaid log, as a purchase is the
-- (transactionHash, logIndex) of its Sold log (#1964).

-- DropIndex
DROP INDEX "RoyaltyPayment_transactionHash_tokenId_key";

-- AlterTable
ALTER TABLE "RoyaltyPayment" ADD COLUMN "logIndex" INTEGER;

-- Backfill: every payment recorded before this migration is the first RoyaltyPaid of
-- its (transaction, token) (the indexer skipped any later one), so find that log in
-- the raw event table by transaction hash, token and recipient, and take the lowest
-- position. A row with no match keeps a NULL logIndex; the indexer adopts such a
-- legacy row when it sees the same payment again, so a replay cannot duplicate it.
UPDATE "RoyaltyPayment" AS p
SET "logIndex" = first_log."logIndex"
FROM (
  SELECT r."id" AS "paymentId", MIN(e."logIndex") AS "logIndex"
  FROM "RoyaltyPayment" AS r
  JOIN "ContractEvent" AS e
    ON e."eventName" = 'RoyaltyPaid'
   AND e."transactionHash" = r."transactionHash"
   AND e."chainId" = r."chainId"
   AND e."args"->>'tokenId' = r."tokenId"::text
   AND lower(e."args"->>'recipient') = lower(r."recipientAddress")
   AND e."args"->>'amount' = r."amount"
  GROUP BY r."id"
) AS first_log
WHERE p."id" = first_log."paymentId"
  AND p."logIndex" IS NULL;

-- CreateIndex
CREATE INDEX "RoyaltyPayment_transactionHash_tokenId_idx" ON "RoyaltyPayment"("transactionHash", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "RoyaltyPayment_transactionHash_logIndex_key" ON "RoyaltyPayment"("transactionHash", "logIndex");
