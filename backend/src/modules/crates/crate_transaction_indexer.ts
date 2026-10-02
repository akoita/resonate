/**
 * The crate settlement's view of the contract indexer.
 *
 * Settlement indexes its own purchase transaction so the `Sold` logs become
 * `StemPurchase` rows (and the stems count as owned) without waiting for the
 * background poller. The service depends on this interface, not on
 * `IndexerService`; it is optional, and the poller stays the fallback.
 */

/** Nest injection token for the {@link CrateTransactionIndexer}. */
export const CRATE_TRANSACTION_INDEXER = "CRATE_TRANSACTION_INDEXER";

export interface CrateTransactionIndexer {
  indexTransaction(txHash: string, chainId: number): Promise<unknown>;
}
