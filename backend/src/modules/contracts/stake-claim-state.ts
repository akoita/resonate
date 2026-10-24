/**
 * Self-claim state of a Content Protection stake (#1759), as the wallet shows it.
 *
 * Read live from `ContentProtection.getStakeClaimState(tokenId)` rather than
 * stored: the lock is set and cleared by the dispute flow and the claim opens on
 * a timestamp, so a cached copy would go stale without an extra indexer column.
 */
export interface StakeClaimView {
  /** When the attester may claim (ISO). Null when unknown or not yet backfilled. */
  claimableAt: string | null;
  /** When a dispute lock stops blocking the claim (ISO). Null when unknown. */
  failSafeAt: string | null;
  /** Whether a dispute currently holds the stake. Null when unknown. */
  locked: boolean | null;
  /** Whether `claimStakeRefund` would succeed right now. False when unknown. */
  claimable: boolean;
}

export const UNKNOWN_STAKE_CLAIM_STATE: StakeClaimView = {
  claimableAt: null,
  failSafeAt: null,
  locked: null,
  claimable: false,
};

function toIso(seconds: bigint): string | null {
  if (seconds <= 0n) return null;
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Map the `(claimableAt, failSafeAt, locked, claimable)` tuple to the response
 * shape. A zero `claimableAt` means a stake deposited before the V7 upgrade that
 * the operator has not backfilled yet: it is not claimable and has no date.
 */
export function toStakeClaimView(
  tuple: readonly [bigint, bigint, boolean, boolean] | null | undefined,
): StakeClaimView {
  if (!tuple) return UNKNOWN_STAKE_CLAIM_STATE;
  const [claimableAt, failSafeAt, locked, claimable] = tuple;
  if (claimableAt === 0n) {
    return { claimableAt: null, failSafeAt: null, locked, claimable: false };
  }
  return {
    claimableAt: toIso(claimableAt),
    failSafeAt: toIso(failSafeAt),
    locked,
    claimable,
  };
}
