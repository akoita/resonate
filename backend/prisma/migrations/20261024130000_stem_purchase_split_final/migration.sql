-- #2172: a marketplace sale's real split (royalty, platform fee, seller proceeds).
-- The Sold log carries only the gross, so these columns stay NULL (pending) until the
-- split is derived from the RoyaltyPaid log and the fee rate at the Sold block.
-- Additive and nullable: existing rows stay pending and are never read as zero.
ALTER TABLE "StemPurchase"
  ADD COLUMN "protocolFeeBps" INTEGER,
  ADD COLUMN "royaltyRecipient" TEXT,
  ADD COLUMN "splitFinalizedAt" TIMESTAMP(3);
