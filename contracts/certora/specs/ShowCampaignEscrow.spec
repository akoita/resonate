/**
 * @title ShowCampaignEscrow Formal Verification Specification
 * @notice Certora Prover rules for campaign custody, accounting, and authority.
 * @dev Run with: certoraRun certora/conf/show_campaign_escrow.conf
 *
 * This specification focuses on the safety properties that are hardest to
 * exhaustively cover with examples:
 * 1. Released + refunded funds never exceed pledged funds.
 * 2. Pledging cannot release or refund funds.
 * 3. Refund and release operations are monotonic and conserve accounting.
 * 4. Only owner/authorized confirmers can trigger booking, deposit, and
 *    fulfillment gates.
 */

using ShowCampaignEscrow as escrow;

// ============ Methods ============

methods {
    function owner() external returns (address) envfree;
    function paused() external returns (bool) envfree;
    function MAX_DEPOSIT_RELEASE_BPS() external returns (uint256) envfree;
    function BPS_DENOMINATOR() external returns (uint256) envfree;
    function confirmers(address) external returns (bool) envfree;
    function pledgedByBacker(uint256, address) external returns (uint256) envfree;
    function campaignAccounting(uint256) external returns (uint256, uint256, uint256) envfree;
    function releasable(uint256) external returns (uint256) envfree;
}

// ============ Definitions ============

function accountingConserved(uint256 campaignId) returns bool {
    uint256 totalPledged;
    uint256 totalRefunded;
    uint256 totalReleased;
    (totalPledged, totalRefunded, totalReleased) = campaignAccounting(campaignId);

    return totalRefunded + totalReleased <= totalPledged;
}

definition isAuthorizedConfirmer(address caller) returns bool =
    caller == owner() || confirmers(caller);

// ============ Global Accounting ============

/**
 * @notice Successful protocol calls must preserve accounting solvency.
 */
rule accountingConservedAfterSuccessfulCall(env e, method f, calldataarg args, uint256 campaignId) {
    require accountingConserved(campaignId);

    f@withrevert(e, args);

    assert lastReverted || accountingConserved(campaignId),
        "released + refunded must never exceed pledged";
}

/**
 * @notice `releasable` must be bounded by outstanding escrow accounting.
 */
rule releasableBoundedByOutstandingAccounting(uint256 campaignId) {
    uint256 totalPledged;
    uint256 totalRefunded;
    uint256 totalReleased;
    (totalPledged, totalRefunded, totalReleased) = campaignAccounting(campaignId);

    assert releasable(campaignId) <= totalPledged - totalRefunded - totalReleased,
        "releasable cannot exceed outstanding escrow";
}

// ============ Authority ============

/**
 * @notice Non-owner accounts cannot create campaigns.
 */
rule onlyOwnerCanCreateCampaign(
    env e,
    bytes32 artistIdHash,
    bytes32 authorityHash,
    address beneficiary,
    address paymentToken,
    uint256 goalAmount,
    uint256 minimumBackers,
    uint256 deadline,
    uint256 bookingDeadline,
    uint256 depositReleaseBps,
    uint256 disputeWindowSeconds
) {
    require e.msg.sender != owner();

    createCampaign@withrevert(
        e,
        artistIdHash,
        authorityHash,
        beneficiary,
        paymentToken,
        goalAmount,
        minimumBackers,
        deadline,
        bookingDeadline,
        depositReleaseBps,
        disputeWindowSeconds
    );

    assert lastReverted, "non-owner must not create campaigns";
}

/**
 * @notice Deposit basis points above the disclosed protocol cap must revert.
 */
rule depositReleaseBpsCapped(
    env e,
    bytes32 artistIdHash,
    bytes32 authorityHash,
    address beneficiary,
    address paymentToken,
    uint256 goalAmount,
    uint256 minimumBackers,
    uint256 deadline,
    uint256 bookingDeadline,
    uint256 depositReleaseBps,
    uint256 disputeWindowSeconds
) {
    require e.msg.sender == owner();
    require depositReleaseBps > MAX_DEPOSIT_RELEASE_BPS();

    createCampaign@withrevert(
        e,
        artistIdHash,
        authorityHash,
        beneficiary,
        paymentToken,
        goalAmount,
        minimumBackers,
        deadline,
        bookingDeadline,
        depositReleaseBps,
        disputeWindowSeconds
    );

    assert lastReverted, "deposit release bps above cap must revert";
}

/**
 * @notice Only owner or an allowed confirmer can confirm booking.
 */
rule onlyAuthorizedCanConfirmBooking(env e, uint256 campaignId) {
    require !isAuthorizedConfirmer(e.msg.sender);

    confirmBooking@withrevert(e, campaignId);

    assert lastReverted, "unauthorized account must not confirm booking";
}

/**
 * @notice Only owner or an allowed confirmer can release the booking deposit.
 */
rule onlyAuthorizedCanReleaseDeposit(env e, uint256 campaignId) {
    require !isAuthorizedConfirmer(e.msg.sender);

    releaseDeposit@withrevert(e, campaignId);

    assert lastReverted, "unauthorized account must not release deposit";
}

/**
 * @notice Only owner or an allowed confirmer can confirm fulfillment.
 */
rule onlyAuthorizedCanConfirmFulfillment(env e, uint256 campaignId) {
    require !isAuthorizedConfirmer(e.msg.sender);

    confirmFulfillment@withrevert(e, campaignId);

    assert lastReverted, "unauthorized account must not confirm fulfillment";
}

// ============ Lifecycle Accounting ============

/**
 * @notice Pledging can increase pledged funds but must not release or refund.
 */
rule pledgeDoesNotReleaseOrRefund(env e, uint256 campaignId, uint256 amount) {
    uint256 pledgedBefore;
    uint256 refundedBefore;
    uint256 releasedBefore;
    (pledgedBefore, refundedBefore, releasedBefore) = campaignAccounting(campaignId);

    pledge@withrevert(e, campaignId, amount);

    uint256 pledgedAfter;
    uint256 refundedAfter;
    uint256 releasedAfter;
    (pledgedAfter, refundedAfter, releasedAfter) = campaignAccounting(campaignId);

    assert lastReverted || pledgedAfter >= pledgedBefore,
        "successful pledge must not decrease total pledged";
    assert lastReverted || refundedAfter == refundedBefore,
        "pledge must not refund funds";
    assert lastReverted || releasedAfter == releasedBefore,
        "pledge must not release funds";
}

/**
 * @notice Claiming a refund can only increase refunded accounting and must
 * preserve conservation.
 */
rule claimRefundMonotonicAndConserved(env e, uint256 campaignId) {
    uint256 pledgedBefore;
    uint256 refundedBefore;
    uint256 releasedBefore;
    (pledgedBefore, refundedBefore, releasedBefore) = campaignAccounting(campaignId);

    claimRefund@withrevert(e, campaignId);

    uint256 pledgedAfter;
    uint256 refundedAfter;
    uint256 releasedAfter;
    (pledgedAfter, refundedAfter, releasedAfter) = campaignAccounting(campaignId);

    assert lastReverted || pledgedAfter == pledgedBefore,
        "refund must not change total pledged";
    assert lastReverted || refundedAfter >= refundedBefore,
        "refund accounting must be monotonic";
    assert lastReverted || releasedAfter == releasedBefore,
        "refund must not release funds";
    assert lastReverted || accountingConserved(campaignId),
        "refund must preserve accounting conservation";
}

/**
 * @notice Final fund release must move all remaining outstanding funds into
 * released accounting and must not refund.
 */
rule releaseFundsConservesOutstandingEscrow(env e, uint256 campaignId) {
    uint256 pledgedBefore;
    uint256 refundedBefore;
    uint256 releasedBefore;
    (pledgedBefore, refundedBefore, releasedBefore) = campaignAccounting(campaignId);

    releaseFunds@withrevert(e, campaignId);

    uint256 pledgedAfter;
    uint256 refundedAfter;
    uint256 releasedAfter;
    (pledgedAfter, refundedAfter, releasedAfter) = campaignAccounting(campaignId);

    assert lastReverted || pledgedAfter == pledgedBefore,
        "release must not change pledged accounting";
    assert lastReverted || refundedAfter == refundedBefore,
        "release must not refund funds";
    assert lastReverted || releasedAfter >= releasedBefore,
        "released accounting must be monotonic";
    assert lastReverted || releasedAfter + refundedAfter == pledgedAfter,
        "final release must account for all pledged funds";
}
