/**
 * @title ContentProtection Formal Verification Specification
 * @notice Certora Prover rules for the stake state machine and access control of
 *         ContentProtection's slashing/refund custody (issue #944).
 * @dev Run with: certoraRun certora/conf/content_protection.conf
 *
 * Focuses on:
 *   1. Only the owner can slash, refund, or blacklist.
 *   2. Slash and refund require an active stake and deactivate it (no double-spend).
 *   3. A successful slash never leaves the stake active.
 *   4. Self-claim (#1759): the attester's claim needs an active stake, deactivates it,
 *      is blocked by the pause, and a dispute-locked stake cannot leave through any
 *      non-owner call before escrow + fail-safe.
 *
 * The stake-amount-split arithmetic (60/30/10) is covered by the fuzz/invariant
 * suites and the Halmos formal test, which can reason about token balances.
 */

using ContentProtection as cp;

// ============ Methods ============

methods {
    function owner() external returns (address) envfree;
    function upgradeAuthority() external returns (address) envfree;
    function paused() external returns (bool) envfree;
    function stakes(uint256) external returns (uint256, uint256, bool) envfree;
    function isBlacklisted(address) external returns (bool) envfree;
    function stakeLocked(uint256) external returns (bool) envfree;
    function stakeClaimableAt(uint256) external returns (uint256) envfree;
    function STAKE_CLAIM_FAIL_SAFE() external returns (uint256) envfree;
}

// ============ Definitions ============

function stakeActive(uint256 tokenId) returns bool {
    uint256 amount;
    uint256 depositedAt;
    bool active;
    (amount, depositedAt, active) = stakes(tokenId);
    return active;
}

// ============ Access control ============

/// Only the owner can slash a stake.
rule onlyOwnerCanSlash(env e, uint256 tokenId, address reporter) {
    require e.msg.sender != owner();
    slash@withrevert(e, tokenId, reporter);
    assert lastReverted, "non-owner must not slash";
}

/// Only the owner can refund a stake.
rule onlyOwnerCanRefund(env e, uint256 tokenId) {
    require e.msg.sender != owner();
    refundStake@withrevert(e, tokenId);
    assert lastReverted, "non-owner must not refund";
}

/// Only the owner can blacklist an account.
rule onlyOwnerCanBlacklist(env e, address account) {
    require e.msg.sender != owner();
    blacklist@withrevert(e, account);
    assert lastReverted, "non-owner must not blacklist";
}

/// Only the operational owner can toggle the fast pause.
rule onlyOwnerCanSetPaused(env e, bool isPaused) {
    require e.msg.sender != owner();
    setPaused@withrevert(e, isPaused);
    assert lastReverted, "non-owner must not toggle pause";
}

/// Only the current delayed authority can rotate upgrade governance.
rule onlyUpgradeAuthorityCanRotate(env e, address newAuthority) {
    require e.msg.sender != upgradeAuthority();
    setUpgradeAuthority@withrevert(e, newAuthority);
    assert lastReverted, "non-authority must not rotate upgrade governance";
}

// ============ Stake state machine ============

/// Slashing requires an active stake.
rule slashRequiresActiveStake(env e, uint256 tokenId, address reporter) {
    require !stakeActive(tokenId);
    slash@withrevert(e, tokenId, reporter);
    assert lastReverted, "slash of an inactive stake must revert";
}

/// Refunding requires an active stake.
rule refundRequiresActiveStake(env e, uint256 tokenId) {
    require !stakeActive(tokenId);
    refundStake@withrevert(e, tokenId);
    assert lastReverted, "refund of an inactive stake must revert";
}

/// A successful slash always deactivates the stake (prevents slash/refund double-spend).
rule slashDeactivatesStake(env e, uint256 tokenId, address reporter) {
    slash@withrevert(e, tokenId, reporter);
    assert lastReverted || !stakeActive(tokenId), "slash must deactivate the stake";
}

/// A successful refund always deactivates the stake.
rule refundDeactivatesStake(env e, uint256 tokenId) {
    refundStake@withrevert(e, tokenId);
    assert lastReverted || !stakeActive(tokenId), "refund must deactivate the stake";
}

/// Emergency pause blocks owner-triggered custody outflows as well as deposits.
rule pausedBlocksSlash(env e, uint256 tokenId, address reporter) {
    require paused();
    slash@withrevert(e, tokenId, reporter);
    assert lastReverted, "paused slash must revert";
}

rule pausedBlocksRefund(env e, uint256 tokenId) {
    require paused();
    refundStake@withrevert(e, tokenId);
    assert lastReverted, "paused refund must revert";
}

/// A blacklisted attester stays blacklisted across any single call (monotonic ban
/// during slash; only removeBlacklist may lift it).
rule blacklistOnlyLiftedByRemove(env e, method f, calldataarg args, address account) {
    require isBlacklisted(account);

    f@withrevert(e, args);

    assert lastReverted
        || isBlacklisted(account)
        || f.selector == sig:removeBlacklist(address).selector,
        "blacklist must only be lifted by removeBlacklist";
}

// ============ Self-claim (#1759) ============

/// The attester's self-claim requires an active stake.
rule claimRequiresActiveStake(env e, uint256 tokenId) {
    require !stakeActive(tokenId);
    claimStakeRefund@withrevert(e, tokenId);
    assert lastReverted, "claim of an inactive stake must revert";
}

/// A successful claim always deactivates the stake (no claim/refund/slash double-spend).
rule claimDeactivatesStake(env e, uint256 tokenId) {
    claimStakeRefund@withrevert(e, tokenId);
    assert lastReverted || !stakeActive(tokenId), "claim must deactivate the stake";
}

rule pausedBlocksClaim(env e, uint256 tokenId) {
    require paused();
    claimStakeRefund@withrevert(e, tokenId);
    assert lastReverted, "paused claim must revert";
}

/// The front-running guard: while a dispute lock holds a stake and the fail-safe has not
/// passed, no call by anyone other than the owner or the upgrade authority can make the
/// stake inactive. (The owner keeps slash/refund; the upgrade authority is timelocked.)
rule lockedStakeCannotLeaveBeforeFailSafe(env e, method f, calldataarg args, uint256 tokenId) {
    require stakeActive(tokenId);
    require stakeLocked(tokenId);
    require to_mathint(e.block.timestamp) < stakeClaimableAt(tokenId) + STAKE_CLAIM_FAIL_SAFE();
    require e.msg.sender != owner();
    require e.msg.sender != upgradeAuthority();

    f@withrevert(e, args);

    assert lastReverted || stakeActive(tokenId), "a locked stake left before the fail-safe";
}
