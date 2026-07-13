// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
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
 *
 * Upgradeability & authority split (issue #1497, RFC contract-upgradeability-and-recovery):
 *   - Deployed behind an ERC1967 proxy; the implementation is UUPS-upgradeable.
 *   - The `owner` runs day-to-day operations (create/activate/cancel campaigns,
 *     confirm bookings, set fees/confirmers, and the emergency pause).
 *   - A SEPARATE `upgradeAuthority` — a TimelockController with a guardian
 *     CANCELLER — is the ONLY account allowed to upgrade the implementation or
 *     reassign the upgrade authority. The operational owner cannot upgrade.
 *
 * Emergency freeze:
 *   - {setPaused} is the instant, owner-controlled lever. When paused, EVERY
 *     function that moves funds out (pledge in, deposit/final release, refund)
 *     or advances a campaign's lifecycle status reverts with {Paused}. Only
 *     configuration setters and {setPaused}/{setUpgradeAuthority} stay callable
 *     so the emergency lever and governance path always work. Views are never
 *     affected. A code fix ships as a new implementation through the timelock;
 *     the guardian can cancel a scheduled upgrade.
 *
 * Permissionless fulfillment escape (issue #1271, SCE-1):
 *   - A booking confirmation captures a `fulfillmentDeadline`
 *     (`block.timestamp + fulfillmentWindow`). Once it passes, ANYONE may call
 *     {openRefundsAfterMissedFulfillment} to move a stalled `BookingConfirmed` or
 *     `DepositReleased` campaign to `RefundAvailable` — mirroring the existing
 *     {openRefundsAfterMissedBooking} escape for `Funded`. This removes the trust
 *     assumption that the operator's confirmer keys AND the ops owner both stay
 *     live after booking; backers can always reclaim their remaining escrow.
 *   - The window is a global, owner-tunable value (bounded by
 *     {MIN_FULFILLMENT_WINDOW}/{MAX_FULFILLMENT_WINDOW}), NOT a per-campaign
 *     creation input, so `createCampaign`'s ABI is unchanged.
 *   - Inert when `fulfillmentWindow == 0`: the deadline stays 0 and the escape
 *     reverts, so the contract never regresses if the window is unset. Legacy
 *     campaigns already in `BookingConfirmed`/`DepositReleased` at the 2.1.0
 *     upgrade carry `fulfillmentDeadline == 0` and are therefore NOT retro-covered
 *     by this escape (they remain governed by the owner/confirmer exits); this is
 *     accepted and not backfilled.
 *
 * @custom:version 2.1.0
 */
contract ShowCampaignEscrow is IShowCampaignEscrow, Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_DEPOSIT_RELEASE_BPS = 3000;
    uint256 public constant MAX_CAMPAIGN_FEE_BPS = 1000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Bounds for `disputeWindowSeconds`: a non-zero floor guarantees backers
    /// a real contest period, and the ceiling avoids a `fulfilledAt + window` overflow
    /// that would brick `releaseFunds`.
    uint256 public constant MIN_DISPUTE_WINDOW = 1 hours;
    uint256 public constant MAX_DISPUTE_WINDOW = 90 days;

    /// @notice Bounds for the global `fulfillmentWindow` (issue #1271): a non-zero floor
    /// keeps the operator a realistic window to actually deliver the show before the
    /// permissionless refund escape opens, and the ceiling both bounds how long backer
    /// funds can be trapped and avoids a `block.timestamp + fulfillmentWindow` overflow.
    uint256 public constant MIN_FULFILLMENT_WINDOW = 1 days;
    uint256 public constant MAX_FULFILLMENT_WINDOW = 180 days;

    uint256 public nextCampaignId;
    bool public paused;
    /// @notice Default fee rate snapshotted into each campaign at creation: the rate is a
    /// backer-facing term and never changes for an existing campaign. The recipient is
    /// deliberately NOT snapshotted — it is the platform's own wallet, read at charge
    /// time, so it stays rotatable (e.g. key compromise) without touching campaign terms.
    uint256 public campaignFeeBps;
    address public feeRecipient;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public pledgedByBacker;
    mapping(address => bool) public confirmers;

    /// @notice campaignId => number of distinct backers who have claimed a refund.
    /// @dev Used to finalize a campaign to `Refunded` once every backer has claimed,
    ///      without relying on an exact-balance equality (pro-rata refunds after a
    ///      partial deposit release can leave a few wei of dust).
    mapping(uint256 => uint256) public refundedBackers;

    /// @notice The sole account authorized to upgrade the implementation (via UUPS
    /// {upgradeToAndCall}) or reassign this authority. In production this is a
    /// TimelockController; the operational {owner} deliberately cannot upgrade.
    address public upgradeAuthority;

    /// @notice Global window (seconds) added to `block.timestamp` at booking confirmation
    /// to derive each campaign's `fulfillmentDeadline`. After that deadline anyone may open
    /// refunds via {openRefundsAfterMissedFulfillment} (issue #1271). Owner-tunable within
    /// [{MIN_FULFILLMENT_WINDOW}, {MAX_FULFILLMENT_WINDOW}]; 0 leaves the escape inert.
    /// Appended after `upgradeAuthority` (old `__gap[0]` slot) — no existing slot moves.
    uint256 public fulfillmentWindow;

    /// @dev Reserved storage to allow appending new state in future upgrades without
    /// shifting the layout of inheriting/composed code. 8 pre-existing slots +
    /// `upgradeAuthority` + `fulfillmentWindow` + 40 = 50 reserved. Shrink this array by
    /// exactly the number of slots any appended variable consumes.
    uint256[40] private __gap;

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyConfirmer() {
        if (msg.sender != owner() && !confirmers[msg.sender]) revert NotConfirmer(msg.sender);
        _;
    }

    modifier onlyUpgradeAuthority() {
        if (msg.sender != upgradeAuthority) revert UnauthorizedUpgrade(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the proxy state. Callable exactly once.
     * @param _owner Operational owner (create/activate/cancel, confirm, fees, pause).
     * @param _feeBps Default success-only campaign fee, snapshotted per campaign.
     * @param _feeRecipient Platform fee wallet (rotatable; read at charge time).
     * @param _upgradeAuthority TimelockController that governs implementation upgrades.
     */
    function initialize(address _owner, uint256 _feeBps, address _feeRecipient, address _upgradeAuthority)
        external
        initializer
    {
        if (_upgradeAuthority == address(0)) revert ZeroAddress();
        __Ownable_init(_owner);
        nextCampaignId = 1;
        _setFeeConfig(_feeBps, _feeRecipient);
        upgradeAuthority = _upgradeAuthority;
        emit UpgradeAuthorityUpdated(address(0), _upgradeAuthority);
    }

    /// @notice 2.1.0 reinitializer (issue #1271). Sets the global {fulfillmentWindow} on
    /// BOTH already-deployed proxies (called via the timelock `upgradeToAndCall` during the
    /// 2.0.0→2.1.0 upgrade) and fresh deploys (called right after {initialize}). Runs once.
    /// @param _fulfillmentWindow Seconds between booking confirmation and when anyone may
    /// force refunds; must be within [{MIN_FULFILLMENT_WINDOW}, {MAX_FULFILLMENT_WINDOW}].
    function initializeV2(uint256 _fulfillmentWindow) external reinitializer(2) {
        if (_fulfillmentWindow < MIN_FULFILLMENT_WINDOW || _fulfillmentWindow > MAX_FULFILLMENT_WINDOW) {
            revert InvalidFulfillmentWindow(_fulfillmentWindow, MIN_FULFILLMENT_WINDOW, MAX_FULFILLMENT_WINDOW);
        }
        fulfillmentWindow = _fulfillmentWindow;
        emit FulfillmentWindowUpdated(0, _fulfillmentWindow);
    }

    /// @notice Reassigns the upgrade authority. Callable ONLY by the current authority
    /// (e.g. the timelock handing off to a new timelock/governor), never by the owner.
    function setUpgradeAuthority(address newAuthority) external onlyUpgradeAuthority {
        if (newAuthority == address(0)) revert ZeroAddress();
        address previous = upgradeAuthority;
        upgradeAuthority = newAuthority;
        emit UpgradeAuthorityUpdated(previous, newAuthority);
    }

    /// @dev UUPS upgrade gate: only the {upgradeAuthority} (timelock) may upgrade.
    function _authorizeUpgrade(address newImplementation) internal view override onlyUpgradeAuthority {}

    function setFeeConfig(uint256 _feeBps, address _feeRecipient) external onlyOwner {
        _setFeeConfig(_feeBps, _feeRecipient);
    }

    /// @notice Updates the global fulfillment window (issue #1271). Only affects campaigns
    /// booked AFTER the change — an in-flight campaign's `fulfillmentDeadline` is snapshotted
    /// at its booking confirmation and never revised. Bounded so backers always get a real
    /// delivery window and funds can never be trapped past the ceiling.
    function setFulfillmentWindow(uint256 _fulfillmentWindow) external onlyOwner {
        if (_fulfillmentWindow < MIN_FULFILLMENT_WINDOW || _fulfillmentWindow > MAX_FULFILLMENT_WINDOW) {
            revert InvalidFulfillmentWindow(_fulfillmentWindow, MIN_FULFILLMENT_WINDOW, MAX_FULFILLMENT_WINDOW);
        }
        uint256 previous = fulfillmentWindow;
        fulfillmentWindow = _fulfillmentWindow;
        emit FulfillmentWindowUpdated(previous, _fulfillmentWindow);
    }

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
        if (minimumBackers == 0) revert InvalidMinimumBackers();
        if (disputeWindowSeconds < MIN_DISPUTE_WINDOW || disputeWindowSeconds > MAX_DISPUTE_WINDOW) {
            revert InvalidDisputeWindow(disputeWindowSeconds, MIN_DISPUTE_WINDOW, MAX_DISPUTE_WINDOW);
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
            status: CampaignStatus.Draft,
            feeBps: campaignFeeBps,
            totalFeePaid: 0,
            fulfillmentDeadline: 0
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

        // Reject fee-on-transfer / deflationary tokens: the accounting above credits
        // the full `amount`, so the escrow must actually receive exactly `amount`.
        IERC20 token = IERC20(campaign.paymentToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert FeeOnTransferNotSupported(amount, received);

        emit Pledged(campaignId, msg.sender, amount, campaign.totalPledged);

        if (_fundingMet(campaign) && campaign.status == CampaignStatus.Active) {
            campaign.status = CampaignStatus.Funded;
            emit CampaignFunded(campaignId, campaign.totalPledged, campaign.uniqueBackers);
        }
    }

    function markFailed(uint256 campaignId) external whenNotPaused {
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

    function cancelCampaign(uint256 campaignId) external onlyOwner whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (!_canCancel(campaign.status)) revert InvalidStatus(campaignId, campaign.status);
        // A Fulfilled campaign is only cancellable (for dispute resolution) while its
        // dispute window is open. Once the window closes the payout has matured and
        // releaseFunds is permissionless, so the owner must not be able to divert an
        // already-claimable artist payout back to refunds. The boundary mirrors
        // releaseFunds: at `fulfilledAt + disputeWindowSeconds` the funds become
        // releasable and cancellation is no longer permitted.
        if (
            campaign.status == CampaignStatus.Fulfilled
                && block.timestamp >= campaign.fulfilledAt + campaign.disputeWindowSeconds
        ) {
            revert DisputeWindowClosed(
                campaignId, campaign.fulfilledAt + campaign.disputeWindowSeconds, block.timestamp
            );
        }
        campaign.status = CampaignStatus.RefundAvailable;
        emit CampaignCancelled(campaignId);
        emit RefundAvailable(campaignId);
    }

    function openRefundsAfterMissedBooking(uint256 campaignId) external whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Funded) revert InvalidStatus(campaignId, campaign.status);
        // Exclusive boundary: the deadline second belongs to confirmBooking, so refunds
        // only open strictly after it — removing the both-callable overlap at `==`.
        if (block.timestamp <= campaign.bookingDeadline) {
            revert BookingDeadlineNotPassed(campaignId, campaign.bookingDeadline, block.timestamp);
        }
        campaign.status = CampaignStatus.RefundAvailable;
        emit RefundAvailable(campaignId);
    }

    function confirmBooking(uint256 campaignId) external onlyConfirmer whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Funded) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp > campaign.bookingDeadline) {
            revert BookingDeadlinePassed(campaignId, campaign.bookingDeadline, block.timestamp);
        }
        campaign.status = CampaignStatus.BookingConfirmed;
        // Capture the fulfillment deadline for the permissionless escape (issue #1271).
        // Only when the global window is configured — a 0 window leaves the deadline 0
        // (escape inert), so the feature never activates unless deliberately enabled.
        if (fulfillmentWindow != 0) {
            campaign.fulfillmentDeadline = block.timestamp + fulfillmentWindow;
        }
        emit BookingConfirmed(campaignId, msg.sender);
    }

    function releaseDeposit(uint256 campaignId) external nonReentrant onlyConfirmer whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.BookingConfirmed) revert InvalidStatus(campaignId, campaign.status);
        if (campaign.depositReleaseBps == 0) revert DepositUnavailable(campaignId, campaign.depositReleaseBps, 0);

        uint256 gross = campaign.totalPledged * campaign.depositReleaseBps / BPS_DENOMINATOR;
        if (gross == 0) revert DepositUnavailable(campaignId, campaign.depositReleaseBps, gross);
        (uint256 net, uint256 fee) = _netAndFee(gross, campaign.feeBps);
        campaign.totalReleased += gross;
        campaign.totalFeePaid += fee;
        campaign.status = CampaignStatus.DepositReleased;
        IERC20 token = IERC20(campaign.paymentToken);
        address recipient = feeRecipient;
        token.safeTransfer(campaign.beneficiary, net);
        if (fee != 0) {
            token.safeTransfer(recipient, fee);
            emit FeeCharged(campaignId, recipient, fee);
        }
        emit DepositReleased(campaignId, campaign.beneficiary, net);
    }

    function confirmFulfillment(uint256 campaignId) external onlyConfirmer whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.BookingConfirmed && campaign.status != CampaignStatus.DepositReleased) {
            revert InvalidStatus(campaignId, campaign.status);
        }
        campaign.status = CampaignStatus.Fulfilled;
        campaign.fulfilledAt = block.timestamp;
        emit FulfillmentConfirmed(campaignId, msg.sender);
    }

    /// @notice Permissionless escape (issue #1271, SCE-1): once a confirmed booking's
    /// fulfillment deadline passes without the operator advancing the campaign to
    /// `Fulfilled`, ANYONE can move it to `RefundAvailable` so backers reclaim their
    /// remaining escrow. Mirrors {openRefundsAfterMissedBooking} for the `Funded` state.
    ///
    /// Callable from `BookingConfirmed` OR `DepositReleased`. For `DepositReleased`,
    /// {claimRefund} distributes the pro-rata share of the *outstanding* balance
    /// (`totalPledged - totalReleased`), so the already-released deposit is untouched and
    /// only the un-released remainder is refunded.
    ///
    /// Inert when `fulfillmentDeadline == 0` (global window unset, or a legacy campaign
    /// booked before the 2.1.0 upgrade): the call reverts {FulfillmentDeadlineNotPassed}.
    function openRefundsAfterMissedFulfillment(uint256 campaignId) external whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (
            campaign.status != CampaignStatus.BookingConfirmed && campaign.status != CampaignStatus.DepositReleased
        ) {
            revert InvalidStatus(campaignId, campaign.status);
        }
        // A 0 deadline (window unset / legacy campaign) never elapses: the `!= 0` guard
        // keeps the escape inert rather than opening refunds the instant a booking is made.
        if (campaign.fulfillmentDeadline == 0 || block.timestamp <= campaign.fulfillmentDeadline) {
            revert FulfillmentDeadlineNotPassed(campaignId, campaign.fulfillmentDeadline, block.timestamp);
        }
        campaign.status = CampaignStatus.RefundAvailable;
        emit RefundAvailable(campaignId);
    }

    function releaseFunds(uint256 campaignId) external nonReentrant whenNotPaused {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.Fulfilled) revert InvalidStatus(campaignId, campaign.status);
        if (block.timestamp < campaign.fulfilledAt + campaign.disputeWindowSeconds) {
            revert DisputeWindowActive(
                campaignId, campaign.fulfilledAt + campaign.disputeWindowSeconds, block.timestamp
            );
        }

        uint256 gross = campaign.totalPledged - campaign.totalRefunded - campaign.totalReleased;
        if (gross == 0) revert NothingToRelease(campaignId);
        (uint256 net, uint256 fee) = _netAndFee(gross, campaign.feeBps);
        campaign.totalReleased += gross;
        campaign.totalFeePaid += fee;
        campaign.status = CampaignStatus.Released;
        IERC20 token = IERC20(campaign.paymentToken);
        address recipient = feeRecipient;
        token.safeTransfer(campaign.beneficiary, net);
        if (fee != 0) {
            token.safeTransfer(recipient, fee);
            emit FeeCharged(campaignId, recipient, fee);
        }
        emit FundsReleased(campaignId, campaign.beneficiary, net);
    }

    function claimRefund(uint256 campaignId) external nonReentrant whenNotPaused {
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

    /// @notice The amount `backer` can actually withdraw via {claimRefund}. Mirrors
    /// claimRefund's pro-rata math so the view never overstates the claimable amount
    /// after an early deposit release (when only the outstanding balance is shared).
    function refundable(uint256 campaignId, address backer) external view returns (uint256) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.status != CampaignStatus.RefundAvailable) return 0;
        uint256 pledge = pledgedByBacker[campaignId][backer];
        if (pledge == 0) return 0; // totalPledged is non-zero whenever a pledge is
        uint256 outstanding = campaign.totalPledged - campaign.totalReleased;
        return (pledge * outstanding) / campaign.totalPledged;
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

    function campaignFees(uint256 campaignId) external view returns (uint256 feeBps, uint256 totalFeePaid) {
        Campaign storage campaign = _campaign(campaignId);
        return (campaign.feeBps, campaign.totalFeePaid);
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
        // (outstanding) balance pro-rata. Cancelling a Fulfilled campaign is
        // additionally time-bounded in cancelCampaign — only allowed while the
        // dispute window is open. Released/RefundAvailable/Refunded are terminal
        // and must not be re-opened.
        return status == CampaignStatus.Draft || status == CampaignStatus.Active || status == CampaignStatus.Funded
            || status == CampaignStatus.BookingConfirmed || status == CampaignStatus.DepositReleased
            || status == CampaignStatus.Fulfilled;
    }

    function _setFeeConfig(uint256 _feeBps, address _feeRecipient) internal {
        if (_feeBps > MAX_CAMPAIGN_FEE_BPS) revert InvalidFeeBps(_feeBps, MAX_CAMPAIGN_FEE_BPS);
        // The recipient must be valid even at 0 bps: releases read it at charge time,
        // and an in-flight campaign may carry a non-zero snapshotted rate, so a zero
        // recipient could otherwise brick releaseDeposit/releaseFunds.
        if (_feeRecipient == address(0) || _feeRecipient == address(this)) revert ZeroAddress();

        campaignFeeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit FeeConfigUpdated(_feeBps, _feeRecipient);
    }

    function _netAndFee(uint256 gross, uint256 feeBps) internal pure returns (uint256 net, uint256 fee) {
        fee = gross * feeBps / BPS_DENOMINATOR;
        net = gross - fee;
    }
}
