// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IContentProtection} from "../interfaces/IContentProtection.sol";
import {IDisputeResolution} from "../interfaces/IDisputeResolution.sol";

/**
 * @title CurationRewards
 * @notice Manages counter-stakes and bounty payouts for community curation.
 *
 * Design:
 *   - Any user can report content by depositing a counter-stake
 *   - Reporter ≠ creator (enforced on-chain)
 *   - Multiple flags on same tokenId consolidated into one dispute
 *   - On upheld: creator's stake slashed via ContentProtection, bounty to reporter
 *   - On rejected: counter-stake sent to creator as compensation
 *   - Bounty split: 60% reporter, 30% treasury, 10% burned
 *     (matches ContentProtection.slash() distribution)
 *
 * @custom:version 2.0.0
 */
contract CurationRewards is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    IContentProtection public contentProtection;
    IDisputeResolution public disputeResolution;
    address public treasury;

    /// @notice Counter-stake = stakeAmount * counterStakeBps / 10000
    uint256 public counterStakeBps = 2000; // 20% of creator's stake

    /// @notice disputeId → counter-stake deposited
    mapping(uint256 => uint256) public counterStakes;

    /// @notice disputeId → counter-stake token, address(0) for native ETH
    mapping(uint256 => address) public counterStakeTokens;

    /// @notice disputeId → reporter address
    mapping(uint256 => address) public reporters;

    /// @notice disputeId → bounty claimed?
    mapping(uint256 => bool) public bountyClaimed;

    /// @notice disputeId → appeal stake deposited by appealer
    mapping(uint256 => uint256) public appealStakes;

    /// @notice disputeId → appeal stake token, address(0) for native ETH
    mapping(uint256 => address) public appealStakeTokens;

    /// @notice disputeId → appealer address
    mapping(uint256 => address) public appealers;

    /// @notice reporter → reputation score
    mapping(address => int256) public reputationScores;

    /// @notice reporter → successful reports
    mapping(address => uint256) public successfulReports;

    /// @notice reporter → rejected reports
    mapping(address => uint256) public rejectedReports;

    /// @notice reporter → total bounties earned (wei)
    mapping(address => uint256) public totalBounties;

    // ============ Events ============

    event ContentReported(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 counterStake,
        string evidenceURI
    );

    event ContentReportedWithAsset(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        address indexed reporter,
        address token,
        uint256 counterStake,
        string evidenceURI
    );

    event BountyClaimed(uint256 indexed disputeId, address indexed reporter, uint256 amount);

    event BountyClaimedWithAsset(
        uint256 indexed disputeId, address indexed reporter, address indexed token, uint256 amount
    );

    event CounterStakeSlashed(
        uint256 indexed disputeId, address indexed reporter, address indexed creator, uint256 amount
    );

    event CounterStakeSlashedWithAsset(
        uint256 indexed disputeId, address indexed reporter, address indexed creator, address token, uint256 amount
    );

    event CounterStakeRefunded(uint256 indexed disputeId, address indexed reporter, uint256 amount);

    event CounterStakeRefundedWithAsset(
        uint256 indexed disputeId, address indexed reporter, address indexed token, uint256 amount
    );

    event AppealStakeDeposited(uint256 indexed disputeId, address indexed appealer, uint256 amount);

    event AppealStakeDepositedWithAsset(
        uint256 indexed disputeId, address indexed appealer, address indexed token, uint256 amount
    );

    event AppealStakeSlashed(
        uint256 indexed disputeId, address indexed appealer, address indexed winner, uint256 amount
    );

    event AppealStakeSlashedWithAsset(
        uint256 indexed disputeId, address indexed appealer, address indexed winner, address token, uint256 amount
    );

    event AppealStakeRefunded(uint256 indexed disputeId, address indexed appealer, uint256 amount);

    event AppealStakeRefundedWithAsset(
        uint256 indexed disputeId, address indexed appealer, address indexed token, uint256 amount
    );

    event ReputationUpdated(address indexed curator, int256 oldScore, int256 newScore);

    // ============ Errors ============

    error SelfReport();
    error InsufficientCounterStake();
    error NotStaked();
    error DisputeNotResolved();
    error AlreadyClaimed();
    error NotUpheld();
    error TransferFailed();
    error ZeroAddress();
    error InsufficientAppealStake();
    error NotDisputeParty();
    error UnexpectedETH();
    error UnsupportedStakeAsset();

    // ============ Constructor ============

    constructor(address _owner, address _contentProtection, address _disputeResolution, address _treasury)
        Ownable(_owner)
    {
        if (_contentProtection == address(0)) revert ZeroAddress();
        if (_disputeResolution == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        contentProtection = IContentProtection(_contentProtection);
        disputeResolution = IDisputeResolution(_disputeResolution);
        treasury = _treasury;
    }

    // ============ Report Content ============

    /**
     * @notice Report potentially stolen content. Requires counter-stake deposit.
     * @param tokenId The token to report
     * @param evidenceURI IPFS URI to evidence supporting the claim
     * @return disputeId The created dispute's ID
     */
    function reportContent(uint256 tokenId, string calldata evidenceURI)
        external
        payable
        nonReentrant
        returns (uint256 disputeId)
    {
        disputeId = _reportContent(tokenId, evidenceURI, address(0), msg.value);
    }

    function reportContentWithAsset(uint256 tokenId, string calldata evidenceURI, uint256 amount)
        external
        nonReentrant
        returns (uint256 disputeId)
    {
        disputeId = _reportContent(tokenId, evidenceURI, address(type(uint160).max), amount);
    }

    function _reportContent(uint256 tokenId, string calldata evidenceURI, address requestedToken, uint256 amount)
        internal
        returns (uint256 disputeId)
    {
        uint256 targetId = contentProtection.resolveProtectionTarget(tokenId);
        uint256 stakeRoot = _resolveActiveStakeRoot(targetId);

        // Get creator from attestation
        (,,, address creator,, bool valid) = contentProtection.attestations(targetId);
        if (!valid) revert NotStaked();

        // Reporter cannot be the creator
        if (msg.sender == creator) revert SelfReport();

        (address stakeToken, uint256 creatorStake, bool active) = contentProtection.getStakeAsset(stakeRoot);
        if (!active) revert NotStaked();
        if (requestedToken == address(0)) {
            if (stakeToken != address(0)) revert UnsupportedStakeAsset();
        } else {
            if (msg.value != 0) revert UnexpectedETH();
            if (stakeToken == address(0)) revert UnsupportedStakeAsset();
            requestedToken = stakeToken;
        }

        // Verify counter-stake amount
        uint256 requiredStake = _getRequiredCounterStakeForAmount(creatorStake, msg.sender);
        if (amount < requiredStake) revert InsufficientCounterStake();

        // File dispute on DisputeResolution
        disputeId = disputeResolution.fileDispute{value: 0}(targetId, msg.sender, creator, evidenceURI);

        // Track counter-stake and reporter
        counterStakes[disputeId] = amount;
        counterStakeTokens[disputeId] = stakeToken;
        reporters[disputeId] = msg.sender;

        if (stakeToken != address(0)) {
            IERC20(stakeToken).safeTransferFrom(msg.sender, address(this), amount);
        }

        emit ContentReported(disputeId, targetId, msg.sender, amount, evidenceURI);
        emit ContentReportedWithAsset(disputeId, targetId, msg.sender, stakeToken, amount, evidenceURI);
    }

    // ============ Claim Bounty ============

    /**
     * @notice Claim bounty after dispute is upheld. Reporter only.
     *         The actual creator stake slash is triggered separately via
     *         ContentProtection.slash() by the admin.
     * @param disputeId The resolved dispute
     */
    function claimBounty(uint256 disputeId) external nonReentrant {
        if (bountyClaimed[disputeId]) revert AlreadyClaimed();
        if (reporters[disputeId] != msg.sender) revert NotUpheld();

        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(disputeId);
        if (d.status != IDisputeResolution.DisputeStatus.Resolved) {
            revert DisputeNotResolved();
        }
        if (d.outcome != IDisputeResolution.Outcome.Upheld) revert NotUpheld();

        bountyClaimed[disputeId] = true;

        // Refund counter-stake to reporter
        uint256 counterStake = counterStakes[disputeId];
        address token = counterStakeTokens[disputeId];

        // Update reputation: +10 for successful report
        _updateReputation(msg.sender, 10);
        successfulReports[msg.sender]++;

        // Transfer counter-stake refund
        if (counterStake > 0) {
            _pay(token, msg.sender, counterStake);
        }

        emit BountyClaimed(disputeId, msg.sender, counterStake);
        emit BountyClaimedWithAsset(disputeId, msg.sender, token, counterStake);
    }

    // ============ Handle Rejected Dispute ============

    /**
     * @notice Process a rejected dispute — slash reporter's counter-stake
     *         and send it to the creator as compensation.
     * @param disputeId The resolved dispute
     */
    function processRejection(uint256 disputeId) external nonReentrant {
        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(disputeId);
        if (d.status != IDisputeResolution.DisputeStatus.Resolved) {
            revert DisputeNotResolved();
        }
        if (d.outcome != IDisputeResolution.Outcome.Rejected) {
            revert NotUpheld();
        }
        if (bountyClaimed[disputeId]) revert AlreadyClaimed();

        bountyClaimed[disputeId] = true; // prevent double-processing

        uint256 counterStake = counterStakes[disputeId];
        address token = counterStakeTokens[disputeId];
        address reporter = reporters[disputeId];

        // Update reputation: -15 for rejected report
        _updateReputation(reporter, -15);
        rejectedReports[reporter]++;

        // Send counter-stake to creator as compensation
        if (counterStake > 0) {
            _pay(token, d.creator, counterStake);
        }

        emit CounterStakeSlashed(disputeId, reporter, d.creator, counterStake);
        emit CounterStakeSlashedWithAsset(disputeId, reporter, d.creator, token, counterStake);
    }

    // ============ Handle Inconclusive ============

    /**
     * @notice Refund counter-stake on inconclusive dispute.
     * @param disputeId The resolved dispute
     */
    function processInconclusive(uint256 disputeId) external nonReentrant {
        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(disputeId);
        if (d.status != IDisputeResolution.DisputeStatus.Resolved) {
            revert DisputeNotResolved();
        }
        if (d.outcome != IDisputeResolution.Outcome.Inconclusive) {
            revert NotUpheld();
        }
        if (bountyClaimed[disputeId]) revert AlreadyClaimed();

        bountyClaimed[disputeId] = true;

        uint256 counterStake = counterStakes[disputeId];
        address token = counterStakeTokens[disputeId];
        address reporter = reporters[disputeId];

        // Refund counter-stake — no reputation change
        if (counterStake > 0) {
            _pay(token, reporter, counterStake);
        }

        emit CounterStakeRefunded(disputeId, reporter, counterStake);
        emit CounterStakeRefundedWithAsset(disputeId, reporter, token, counterStake);
    }

    // ============ Appeals ============

    /**
     * @notice Appeal a resolved dispute. Only the losing party can appeal.
     *         Requires 2x the original counter-stake as appeal deposit.
     * @param disputeId The resolved dispute to appeal
     */
    function appealDispute(uint256 disputeId) external payable nonReentrant {
        address token = counterStakeTokens[disputeId];
        if (token != address(0)) revert UnsupportedStakeAsset();
        _appealDispute(disputeId, token, msg.value);
    }

    function appealDisputeWithAsset(uint256 disputeId, uint256 amount) external nonReentrant {
        address token = counterStakeTokens[disputeId];
        if (token == address(0)) revert UnsupportedStakeAsset();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _appealDispute(disputeId, token, amount);
    }

    function _appealDispute(uint256 disputeId, address token, uint256 amount) internal {
        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(disputeId);

        // Verify caller is a party to the dispute
        if (msg.sender != d.reporter && msg.sender != d.creator) {
            revert NotDisputeParty();
        }

        // Require 2x original counter-stake
        uint256 requiredAppealStake = counterStakes[disputeId] * 2;
        if (amount < requiredAppealStake) revert InsufficientAppealStake();

        // Store appeal stake
        appealStakes[disputeId] += amount;
        appealStakeTokens[disputeId] = token;
        appealers[disputeId] = msg.sender;

        // Reset processing flag so new outcome can be handled
        bountyClaimed[disputeId] = false;

        // Trigger appeal on DisputeResolution (checks losing party, max appeals)
        disputeResolution.appeal(disputeId, msg.sender);

        emit AppealStakeDeposited(disputeId, msg.sender, amount);
        emit AppealStakeDepositedWithAsset(disputeId, msg.sender, token, amount);
    }

    /**
     * @notice Process appeal outcome — returns or slashes appeal stake.
     *         Called after a re-resolved dispute (post-appeal).
     * @param disputeId The dispute that was re-resolved after appeal
     */
    function processAppealOutcome(uint256 disputeId) external nonReentrant {
        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(disputeId);
        if (d.status != IDisputeResolution.DisputeStatus.Resolved) {
            revert DisputeNotResolved();
        }

        uint256 stake = appealStakes[disputeId];
        if (stake == 0) return; // No appeal stake to process

        address appealer = appealers[disputeId];
        address token = appealStakeTokens[disputeId];
        appealStakes[disputeId] = 0;
        appealers[disputeId] = address(0);
        appealStakeTokens[disputeId] = address(0);

        // Determine if the appealer won on re-review
        bool appealerWon;
        if (appealer == d.creator) {
            // Creator appealed → they won if the dispute was rejected this time
            appealerWon = d.outcome == IDisputeResolution.Outcome.Rejected
                || d.outcome == IDisputeResolution.Outcome.Inconclusive;
        } else {
            // Reporter appealed → they won if the dispute was upheld this time
            appealerWon = d.outcome == IDisputeResolution.Outcome.Upheld;
        }

        if (appealerWon) {
            // Refund appeal stake to appealer
            _pay(token, appealer, stake);
            emit AppealStakeRefunded(disputeId, appealer, stake);
            emit AppealStakeRefundedWithAsset(disputeId, appealer, token, stake);
        } else {
            // Slash appeal stake → send to the other party
            address winner = appealer == d.creator ? d.reporter : d.creator;
            _pay(token, winner, stake);
            emit AppealStakeSlashed(disputeId, appealer, winner, stake);
            emit AppealStakeSlashedWithAsset(disputeId, appealer, winner, token, stake);
        }
    }

    // ============ Internal ============

    function _getCounterStakeBpsForScore(int256 score) internal view returns (uint256) {
        if (score >= 50) return 1000;
        if (score >= 20) return 1500;
        if (score < 0) return 3000;
        return counterStakeBps;
    }

    function _getRequiredCounterStake(address curator) internal view returns (uint256) {
        uint256 stakeAmount = contentProtection.stakeAmount();
        return _getRequiredCounterStakeForAmount(stakeAmount, curator);
    }

    function _getRequiredCounterStakeForAmount(uint256 creatorStake, address curator) internal view returns (uint256) {
        uint256 applicableBps = _getCounterStakeBpsForScore(reputationScores[curator]);
        return (creatorStake * applicableBps) / 10000;
    }

    function _resolveActiveStakeRoot(uint256 targetId) internal view returns (uint256) {
        uint256 stakeRoot = contentProtection.resolveStakeRoot(targetId);
        (,, bool active) = contentProtection.getStakeAsset(stakeRoot);
        if (active || stakeRoot == targetId) return stakeRoot;
        return targetId;
    }

    function _updateReputation(address curator, int256 delta) internal {
        int256 oldScore = reputationScores[curator];
        reputationScores[curator] = oldScore + delta;
        emit ReputationUpdated(curator, oldScore, oldScore + delta);
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ============ Admin ============

    function setCounterStakeBps(uint256 newBps) external onlyOwner {
        counterStakeBps = newBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
    }

    // ============ Views ============

    function getRequiredCounterStake() external view returns (uint256) {
        return _getRequiredCounterStake(msg.sender);
    }

    function getRequiredCounterStakeFor(address curator) external view returns (uint256) {
        return _getRequiredCounterStake(curator);
    }

    function getRequiredCounterStakeForToken(uint256 tokenId, address curator)
        external
        view
        returns (address token, uint256 amount)
    {
        uint256 targetId = contentProtection.resolveProtectionTarget(tokenId);
        uint256 stakeRoot = _resolveActiveStakeRoot(targetId);
        uint256 creatorStake;
        bool active;
        (token, creatorStake, active) = contentProtection.getStakeAsset(stakeRoot);
        if (!active) revert NotStaked();
        amount = _getRequiredCounterStakeForAmount(creatorStake, curator);
    }

    function getReputation(address curator) external view returns (int256) {
        return reputationScores[curator];
    }
}
