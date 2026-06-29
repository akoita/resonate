// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IShowCampaignEscrow {
    enum CampaignStatus {
        Draft,
        Active,
        Funded,
        BookingConfirmed,
        DepositReleased,
        Fulfilled,
        Released,
        Cancelled,
        RefundAvailable,
        Refunded
    }

    struct Campaign {
        bytes32 artistIdHash;
        bytes32 authorityHash;
        address beneficiary;
        address paymentToken;
        uint256 goalAmount;
        uint256 minimumBackers;
        uint256 deadline;
        uint256 bookingDeadline;
        uint256 depositReleaseBps;
        uint256 disputeWindowSeconds;
        uint256 totalPledged;
        uint256 totalRefunded;
        uint256 totalReleased;
        uint256 uniqueBackers;
        uint256 fulfilledAt;
        CampaignStatus status;
    }

    event CampaignCreated(
        uint256 indexed campaignId,
        bytes32 indexed artistIdHash,
        bytes32 indexed authorityHash,
        address beneficiary,
        address paymentToken,
        uint256 goalAmount,
        uint256 minimumBackers,
        uint256 deadline,
        uint256 bookingDeadline
    );
    event CampaignActivated(uint256 indexed campaignId);
    event Pledged(uint256 indexed campaignId, address indexed backer, uint256 amount, uint256 totalPledged);
    event CampaignFunded(uint256 indexed campaignId, uint256 totalPledged, uint256 uniqueBackers);
    event CampaignFailed(uint256 indexed campaignId);
    event CampaignCancelled(uint256 indexed campaignId);
    event BookingConfirmed(uint256 indexed campaignId, address indexed confirmer);
    event RefundAvailable(uint256 indexed campaignId);
    event RefundClaimed(uint256 indexed campaignId, address indexed backer, uint256 amount);
    event DepositReleased(uint256 indexed campaignId, address indexed beneficiary, uint256 amount);
    event FulfillmentConfirmed(uint256 indexed campaignId, address indexed confirmer);
    event FundsReleased(uint256 indexed campaignId, address indexed beneficiary, uint256 amount);
    event AuthorityUpdated(uint256 indexed campaignId, bytes32 indexed authorityHash, address beneficiary);
    event CampaignPaused(bool paused);
    event ConfirmerUpdated(address indexed confirmer, bool allowed);

    error NotConfirmer(address caller);
    error Paused();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidCampaign(uint256 campaignId);
    error InvalidAuthority(bytes32 artistIdHash, bytes32 authorityHash);
    error InvalidDeadline(uint256 deadline, uint256 bookingDeadline, uint256 currentTime);
    error DepositReleaseTooHigh(uint256 requestedBps, uint256 maxBps);
    error InvalidStatus(uint256 campaignId, CampaignStatus current);
    error DeadlinePassed(uint256 campaignId, uint256 deadline, uint256 currentTime);
    error DeadlineNotPassed(uint256 campaignId, uint256 deadline, uint256 currentTime);
    error BookingDeadlineNotPassed(uint256 campaignId, uint256 bookingDeadline, uint256 currentTime);
    error FundingThresholdAlreadyMet(
        uint256 campaignId, uint256 totalPledged, uint256 goalAmount, uint256 uniqueBackers, uint256 minimumBackers
    );
    error RefundUnavailable(uint256 campaignId, CampaignStatus current);
    error NoPledge(uint256 campaignId, address backer);
    error DepositUnavailable(uint256 campaignId, uint256 depositReleaseBps, uint256 computedAmount);
    error DisputeWindowActive(uint256 campaignId, uint256 unlockTime, uint256 currentTime);
    error NothingToRelease(uint256 campaignId);
    error FeeOnTransferNotSupported(uint256 expected, uint256 received);
    error BookingDeadlinePassed(uint256 campaignId, uint256 bookingDeadline, uint256 currentTime);
    error InvalidDisputeWindow(uint256 provided, uint256 min, uint256 max);
    error InvalidMinimumBackers();
}
