/**
 * Pure mapping of ContentProtection.getStakeClaimState to the wallet response (#1759).
 */
import { toStakeClaimView, UNKNOWN_STAKE_CLAIM_STATE } from "../modules/contracts/stake-claim-state";

describe("toStakeClaimView", () => {
  const claimableAt = 1_700_000_000n;
  const failSafeAt = claimableAt + 180n * 86_400n;

  it("maps a claimable, unlocked stake", () => {
    expect(toStakeClaimView([claimableAt, failSafeAt, false, true])).toEqual({
      claimableAt: new Date(Number(claimableAt) * 1000).toISOString(),
      failSafeAt: new Date(Number(failSafeAt) * 1000).toISOString(),
      locked: false,
      claimable: true,
    });
  });

  it("keeps the lock and dates for a stake on hold", () => {
    const view = toStakeClaimView([claimableAt, failSafeAt, true, false]);
    expect(view.locked).toBe(true);
    expect(view.claimable).toBe(false);
    expect(view.claimableAt).not.toBeNull();
    expect(view.failSafeAt).not.toBeNull();
  });

  it("treats an unrecorded (pre-upgrade, not backfilled) deadline as dateless and unclaimable", () => {
    expect(toStakeClaimView([0n, 0n, false, true])).toEqual({
      claimableAt: null,
      failSafeAt: null,
      locked: false,
      claimable: false,
    });
  });

  it("returns the unknown state when the contract could not be read", () => {
    expect(toStakeClaimView(null)).toEqual(UNKNOWN_STAKE_CLAIM_STATE);
    expect(toStakeClaimView(undefined)).toEqual(UNKNOWN_STAKE_CLAIM_STATE);
    expect(UNKNOWN_STAKE_CLAIM_STATE.claimable).toBe(false);
  });
});
