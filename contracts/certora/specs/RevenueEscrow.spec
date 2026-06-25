/**
 * @title RevenueEscrow Formal Verification Specification
 * @notice Certora Prover rules for escrow custody, the freeze/release/redirect
 *         state machine, and access control (issue #944).
 * @dev Run with: certoraRun certora/conf/revenue_escrow.conf
 *
 * Focuses on the safety properties that are hardest to exhaustively cover with
 * examples:
 *   1. Only the owner can freeze, unfreeze, or redirect.
 *   2. Frozen escrows cannot be released; redirect requires a frozen escrow.
 *   3. Release requires the escrow period to have elapsed.
 *   4. Release and redirect zero the balance (and redirect clears the frozen flag).
 *   5. Deposits never decrease an escrow balance.
 */

using RevenueEscrow as escrow;

// ============ Methods ============

methods {
    function owner() external returns (address) envfree;
    function defaultEscrowPeriod() external returns (uint256) envfree;
    function getEscrow(uint256) external returns (address, uint256, uint256, bool) envfree;
    function isReleasable(uint256) external returns (bool) envfree;
}

// ============ Access control ============

/// Only the owner can freeze an escrow.
rule onlyOwnerCanFreeze(env e, uint256 tokenId) {
    require e.msg.sender != owner();
    freeze@withrevert(e, tokenId);
    assert lastReverted, "non-owner must not freeze";
}

/// Only the owner can unfreeze an escrow.
rule onlyOwnerCanUnfreeze(env e, uint256 tokenId) {
    require e.msg.sender != owner();
    unfreeze@withrevert(e, tokenId);
    assert lastReverted, "non-owner must not unfreeze";
}

/// Only the owner can redirect a (frozen) escrow.
rule onlyOwnerCanRedirect(env e, uint256 tokenId, address recipient) {
    require e.msg.sender != owner();
    redirect@withrevert(e, tokenId, recipient);
    assert lastReverted, "non-owner must not redirect";
}

// ============ State machine ============

/// A frozen escrow can never be released.
rule frozenEscrowCannotRelease(env e, uint256 tokenId) {
    address beneficiary;
    uint256 balance;
    uint256 escrowEndTime;
    bool frozen;
    (beneficiary, balance, escrowEndTime, frozen) = getEscrow(tokenId);

    require frozen;

    release@withrevert(e, tokenId);
    assert lastReverted, "frozen escrow must not be releasable";
}

/// Native release before the escrow period has elapsed must revert.
rule releaseRequiresExpiry(env e, uint256 tokenId) {
    address beneficiary;
    uint256 balance;
    uint256 escrowEndTime;
    bool frozen;
    (beneficiary, balance, escrowEndTime, frozen) = getEscrow(tokenId);

    require e.block.timestamp < escrowEndTime;

    release@withrevert(e, tokenId);
    assert lastReverted, "release before expiry must revert";
}

/// Redirect requires a frozen escrow (an existing, non-frozen escrow cannot be redirected).
rule redirectRequiresFrozen(env e, uint256 tokenId, address recipient) {
    address beneficiary;
    uint256 balance;
    uint256 escrowEndTime;
    bool frozen;
    (beneficiary, balance, escrowEndTime, frozen) = getEscrow(tokenId);

    require beneficiary != 0;
    require !frozen;

    redirect@withrevert(e, tokenId, recipient);
    assert lastReverted, "redirect of a non-frozen escrow must revert";
}

/// A successful native release zeroes the escrow balance.
rule releaseZerosBalance(env e, uint256 tokenId) {
    release@withrevert(e, tokenId);

    address beneficiary;
    uint256 balance;
    uint256 escrowEndTime;
    bool frozen;
    (beneficiary, balance, escrowEndTime, frozen) = getEscrow(tokenId);

    assert lastReverted || balance == 0, "release must zero the balance";
}

/// A successful native redirect zeroes the balance and clears the frozen flag.
rule redirectZerosBalanceAndClearsFrozen(env e, uint256 tokenId, address recipient) {
    redirect@withrevert(e, tokenId, recipient);

    address beneficiary;
    uint256 balance;
    uint256 escrowEndTime;
    bool frozen;
    (beneficiary, balance, escrowEndTime, frozen) = getEscrow(tokenId);

    assert lastReverted || (balance == 0 && !frozen),
        "redirect must zero the balance and clear frozen";
}

// ============ Accounting ============

/// A native deposit never decreases the stored escrow balance.
rule depositDoesNotDecreaseBalance(env e, uint256 tokenId, address beneficiary) {
    address b0;
    uint256 balanceBefore;
    uint256 t0;
    bool f0;
    (b0, balanceBefore, t0, f0) = getEscrow(tokenId);

    deposit@withrevert(e, tokenId, beneficiary);

    address b1;
    uint256 balanceAfter;
    uint256 t1;
    bool f1;
    (b1, balanceAfter, t1, f1) = getEscrow(tokenId);

    assert lastReverted || balanceAfter >= balanceBefore,
        "deposit must not decrease the escrow balance";
}
