-- #2360: fenced, database-clock lease for the contract indexer, one per chain
-- cursor row. Same shape as the Shows escrow indexer lease (#1567): the epoch
-- survives release so a successor can reject writes from an older holder even
-- when processes overlap during a cut-over.
ALTER TABLE "IndexerState"
ADD COLUMN "leaseOwnerId" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "leaseHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "leaseEpoch" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "IndexerState"
ADD CONSTRAINT "IndexerState_leaseEpoch_check"
CHECK ("leaseEpoch" >= 0),
ADD CONSTRAINT "IndexerState_lease_state_check"
CHECK (
  (
    "leaseOwnerId" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "leaseHeartbeatAt" IS NULL
  )
  OR
  (
    length("leaseOwnerId") > 0
    AND "leaseExpiresAt" IS NOT NULL
    AND "leaseHeartbeatAt" IS NOT NULL
  )
);

CREATE INDEX "IndexerState_leaseExpiresAt_idx"
ON "IndexerState"("leaseExpiresAt");
