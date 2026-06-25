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
 *
 * The stake-amount-split arithmetic (60/30/10) is covered by the fuzz/invariant
 * suites and the Halmos formal test, which can reason about token balances.
 */

using ContentProtection as cp;

// ============ Methods ============

methods {
    function owner() external returns (address) envfree;
    function stakes(uint256) external returns (uint256, uint256, bool) envfree;
    function isBlacklisted(address) external returns (bool) envfree;
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
