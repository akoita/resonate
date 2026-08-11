-- #1567: fenced, database-clock leases for each Shows escrow indexer target.
-- The epoch survives release so a successor can reject writes from an older
-- holder even when Cloud Run instances overlap during handoff.
ALTER TABLE "ShowEscrowIndexerState"
ADD COLUMN "leaseOwnerId" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "leaseHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "leaseEpoch" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ShowEscrowIndexerState"
ADD CONSTRAINT "ShowEscrowIndexerState_leaseEpoch_check"
CHECK ("leaseEpoch" >= 0),
ADD CONSTRAINT "ShowEscrowIndexerState_lease_state_check"
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

CREATE INDEX "ShowEscrowIndexerState_leaseExpiresAt_idx"
ON "ShowEscrowIndexerState"("leaseExpiresAt");
