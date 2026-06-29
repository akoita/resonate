// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IShowCampaignEscrow} from "../interfaces/IShowCampaignEscrow.sol";

/**
 * @title ShowCampaignEscrow
 * @notice Threshold-based stablecoin escrow for fan-funded show campaigns.
 *
 * Funding success never releases funds by itself. Pledges stay locked until
 * booking confirmation, optional disclosed deposit release, fulfillment, and
 * the dispute window complete. Failed, cancelled, or booking-expired campaigns
 * expose permissionless refunds.
 */
contract ShowCampaignEscrow is IShowCampaignEscrow, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_DEPOSIT_RELEASE_BPS = 3000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 public nextCampaignId = 1;
    bool public paused;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public pledgedByBacker;
    mapping(address => bool) public confirmers;

    /// @notice campaignId => number of distinct backers who have claimed a refund.
    /// @dev Used to finalize a campaign to `Refunded` once every backer has claimed,
    ///      without relying on an exact-balance equality (pro-rata refunds after a
    ///      partial deposit release can leave a few wei of dust).
    mapping(uint256 => uint256) public refundedBackers;

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyConfirmer() {
        if (msg.sender != owner() && !confirmers[msg.sender]) revert NotConfirmer(msg.sender);
        _;
    }

    constructor(address _owner) Ownable(_owner) {}

    function createCampaign(
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
    ) external onlyOwner returns (uint256 campaignId) {
        if (beneficiary == address(0) || paymentToken == address(0)) revert ZeroAddress();
        if (artistIdHash == bytes32(0) || authorityHash == bytes32(0)) {
            revert InvalidAuthority(artistIdHash, authorityHash);
        }
        if (goalAmount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp || bookingDeadline <= deadline) {
            revert InvalidDeadline(deadline, bookingDeadline, block.timestamp);
        }
        if (depositReleaseBps > MAX_DEPOSIT_RELEASE_BPS) {
            revert DepositReleaseTooHigh(depositReleaseBps, MAX_DEPOSIT_RELEASE_BPS);
        }

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            artistIdHash: artistIdHash,
            authorityHash: authorityHash,
            beneficiary: beneficiary,
            paymentToken: paymentToken,
            goalAmount: goalAmount,
            minimumBackers: minimumBackers,
            deadline: deadline,
            bookingDeadline: bookingDeadline,
            depositReleaseBps: depositReleaseBps,
            disputeWindowSeconds: disputeWindowSeconds,
            totalPledged: 0,
            totalRefunded: 0,
            totalReleased: 0,
            uniqueBackers: 0,
            fulfilledAt: 0,
            status: CampaignStatus.Draft
        });

        emit CampaignCreated(
            campaignId,
            artistIdHash,
            authorityHash,
            beneficiary,
            paymentToken,
            goalAmount,
            minimumBackers,
            deadline,
            bookingDeadline
        );
    }

    function activateCampaign(uint256 campaignId) external onlyOwner {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Draft) revert InvalidStatus(campaignId, campaign.status);
        campaign.status = CampaignStatus.Active;
        emit CampaignActivated(campaignId);
    }

    function pledge(uint256 campaignId, uint256 amount) external nonReentrant whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Active) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp >= campaign.deadline) {
            revert DeadlinePassed(campaignId, campaign.deadline, block.timestamp);
        }
        if (amount == 0) revert ZeroAmount();

        if (pledgedByBacker[campaignId][msg.sender] == 0) {
            campaign.uniqueBackers += 1;
        }

        pledgedByBacker[campaignId][msg.sender] += amount;
        campaign.totalPledged += amount;
        IERC20(campaign.paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        emit Pledged(campaignId, msg.sender, amount, campaign.totalPledged);

        if (_fundingMet(campaign) && campaign.status == CampaignStatus.Active) {
            campaign.status = CampaignStatus.Funded;
            emit CampaignFunded(campaignId, campaign.totalPledged, campaign.uniqueBackers);
        }
    }

    function markFailed(uint256 campaignId) external {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Active) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp < campaign.deadline) {
            revert DeadlineNotPassed(campaignId, campaign.deadline, block.timestamp);
        }
        if (_fundingMet(campaign)) {
            revert FundingThresholdAlreadyMet(
                campaignId, campaign.totalPledged, campaign.goalAmount, campaign.uniqueBackers, campaign.minimumBackers
            );
        }
        campaign.status = CampaignStatus.RefundAvailable;
        emit CampaignFailed(campaignId);
        emit RefundAvailable(campaignId);
    }

    function cancelCampaign(uint256 campaignId) external onlyOwner {
        Campaign storage campaign = _campaign(campaignId);
        if (!_canCancel(campaign.status)) revert InvalidStatus(campaignId, campaign.status);
        campaign.status = CampaignStatus.RefundAvailable;
        emit CampaignCancelled(campaignId);
        emit RefundAvailable(campaignId);
    }

    function openRefundsAfterMissedBooking(uint256 campaignId) external {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Funded) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp < campaign.bookingDeadline) {
            revert BookingDeadlineNotPassed(campaignId, campaign.bookingDeadline, block.timestamp);
        }
        campaign.status = CampaignStatus.RefundAvailable;
        emit RefundAvailable(campaignId);
    }

    function confirmBooking(uint256 campaignId) external onlyConfirmer {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Funded) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp > campaign.bookingDeadline) {
            revert BookingDeadlineNotPassed(campaignId, campaign.bookingDeadline, block.timestamp);
        }
        campaign.status = CampaignStatus.BookingConfirmed;
        emit BookingConfirmed(campaignId, msg.sender);
    }

    function releaseDeposit(uint256 campaignId) external nonReentrant onlyConfirmer {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.BookingConfirmed) revert InvalidStatus(campaignId, campaign.status);
        if (campaign.depositReleaseBps == 0) revert DepositUnavailable(campaignId, campaign.depositReleaseBps, 0);

        uint256 amount = campaign.totalPledged * campaign.depositReleaseBps / BPS_DENOMINATOR;
        if (amount == 0) revert DepositUnavailable(campaignId, campaign.depositReleaseBps, amount);
        campaign.totalReleased += amount;
        campaign.status = CampaignStatus.DepositReleased;
        IERC20(campaign.paymentToken).safeTransfer(campaign.beneficiary, amount);
        emit DepositReleased(campaignId, campaign.beneficiary, amount);
    }

    function confirmFulfillment(uint256 campaignId) external onlyConfirmer {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.BookingConfirmed && campaign.status != CampaignStatus.DepositReleased) {
            revert InvalidStatus(campaignId, campaign.status);
        }
        campaign.status = CampaignStatus.Fulfilled;
        campaign.fulfilledAt = block.timestamp;
        emit FulfillmentConfirmed(campaignId, msg.sender);
    }

    function releaseFunds(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Fulfilled) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp < campaign.fulfilledAt + campaign.disputeWindowSeconds) {
            revert DisputeWindowActive(
                campaignId, campaign.fulfilledAt + campaign.disputeWindowSeconds, block.timestamp
            );
        }

        uint256 amount = campaign.totalPledged - campaign.totalRefunded - campaign.totalReleased;
        if (amount == 0) revert NothingToRelease(campaignId);
        campaign.totalReleased += amount;
        campaign.status = CampaignStatus.Released;
        IERC20(campaign.paymentToken).safeTransfer(campaign.beneficiary, amount);
        emit FundsReleased(campaignId, campaign.beneficiary, amount);
    }

    function claimRefund(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.RefundAvailable) revert RefundUnavailable(campaignId, campaign.status);

        uint256 pledge = pledgedByBacker[campaignId][msg.sender];
        if (pledge == 0) revert NoPledge(campaignId, msg.sender);

        // Refund the backer's pro-rata share of the *outstanding* balance. With no
        // deposit released (totalReleased == 0) this equals the full pledge, so the
        // common refund path is unchanged. After an early deposit release, backers
        // share only what remains (totalPledged - totalReleased), so refunds plus the
        // already-released deposit can never exceed the escrowed balance. totalPledged
        // is non-zero here because this backer's pledge is non-zero.
        uint256 outstanding = campaign.totalPledged - campaign.totalReleased;
        uint256 amount = (pledge * outstanding) / campaign.totalPledged;

        // Effects (CEI): clear the pledge and book the refund before transferring.
        pledgedByBacker[campaignId][msg.sender] = 0;
        campaign.totalRefunded += amount;

        // Finalize once every distinct backer has claimed. A claim counter is used
        // instead of an exact-balance equality because pro-rata truncation can leave
        // a few wei of dust that would otherwise keep the status from settling.
        uint256 claimed = ++refundedBackers[campaignId];
        if (claimed == campaign.uniqueBackers) {
            campaign.status = CampaignStatus.Refunded;
        }

        // Interactions
        if (amount != 0) {
            IERC20(campaign.paymentToken).safeTransfer(msg.sender, amount);
        }
        emit RefundClaimed(campaignId, msg.sender, amount);
    }

    function updateAuthority(uint256 campaignId, bytes32 authorityHash, address beneficiary) external onlyOwner {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Draft) revert InvalidStatus(campaignId, campaign.status);
        if (authorityHash == bytes32(0)) revert InvalidAuthority(campaign.artistIdHash, authorityHash);
        if (beneficiary == address(0)) revert ZeroAddress();
        campaign.authorityHash = authorityHash;
        campaign.beneficiary = beneficiary;
        emit AuthorityUpdated(campaignId, authorityHash, beneficiary);
    }

    function setConfirmer(address confirmer, bool allowed) external onlyOwner {
        if (confirmer == address(0)) revert ZeroAddress();
        confirmers[confirmer] = allowed;
        emit ConfirmerUpdated(confirmer, allowed);
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit CampaignPaused(isPaused);
    }

    function refundable(uint256 campaignId, address backer) external view returns (uint256) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.RefundAvailable) return 0;
        return pledgedByBacker[campaignId][backer];
    }

    function campaignStatus(uint256 campaignId) external view returns (CampaignStatus) {
        return _campaign(campaignId).status;
    }

    function campaignAuthority(uint256 campaignId) external view returns (bytes32 authorityHash, address beneficiary) {
        Campaign storage campaign = _campaign(campaignId);
        return (campaign.authorityHash, campaign.beneficiary);
    }

    function campaignAccounting(uint256 campaignId)
        external
        view
        returns (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased)
    {
        Campaign storage campaign = _campaign(campaignId);
        return (campaign.totalPledged, campaign.totalRefunded, campaign.totalReleased);
    }

    function releasable(uint256 campaignId) external view returns (uint256) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Fulfilled) return 0;
        if (block.timestamp < campaign.fulfilledAt + campaign.disputeWindowSeconds) return 0;
        return campaign.totalPledged - campaign.totalRefunded - campaign.totalReleased;
    }

    function _campaign(uint256 campaignId) internal view returns (Campaign storage campaign) {
        campaign = campaigns[campaignId];
        if (campaign.beneficiary == address(0)) revert InvalidCampaign(campaignId);
    }

    function _fundingMet(Campaign storage campaign) internal view returns (bool) {
        return campaign.totalPledged >= campaign.goalAmount && campaign.uniqueBackers >= campaign.minimumBackers;
    }

    function _canCancel(CampaignStatus status) internal pure returns (bool) {
        // DepositReleased and Fulfilled are cancellable so the owner can open
        // refunds on a campaign that stalls after an early deposit release or
        // during the dispute window; claimRefund then distributes the remaining
        // (outstanding) balance pro-rata. Released/RefundAvailable/Refunded are
        // terminal and must not be re-opened.
        return status == CampaignStatus.Draft || status == CampaignStatus.Active || status == CampaignStatus.Funded
            || status == CampaignStatus.BookingConfirmed || status == CampaignStatus.DepositReleased
            || status == CampaignStatus.Fulfilled;
    }
}
