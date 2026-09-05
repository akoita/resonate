-- Preserve reconciliation for legacy escrows while a new current escrow is
-- promoted. Cursor and fee state are scoped to the contract, not only chain.
UPDATE "ShowEscrowIndexerState"
SET "contractAddress" = lower("contractAddress");

DROP INDEX "ShowEscrowIndexerState_chainId_key";

CREATE UNIQUE INDEX "ShowEscrowIndexerState_chainId_contractAddress_key"
ON "ShowEscrowIndexerState"("chainId", "contractAddress");
