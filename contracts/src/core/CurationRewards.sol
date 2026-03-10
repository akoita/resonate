// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
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
 * @custom:version 1.0.0
 */
contract CurationRewards is Ownable, ReentrancyGuard {
    // ============ State ============

    IContentProtection public contentProtection;
    IDisputeResolution public disputeResolution;
    address public treasury;

    /// @notice Counter-stake = stakeAmount * counterStakeBps / 10000
    uint256 public counterStakeBps = 2000; // 20% of creator's stake

    /// @notice disputeId → counter-stake deposited
    mapping(uint256 => uint256) public counterStakes;

    /// @notice disputeId → reporter address
    mapping(uint256 => address) public reporters;

    /// @notice disputeId → bounty claimed?
    mapping(uint256 => bool) public bountyClaimed;

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

    event BountyClaimed(
        uint256 indexed disputeId,
        address indexed reporter,
        uint256 amount
    );

    event CounterStakeSlashed(
        uint256 indexed disputeId,
        address indexed reporter,
        address indexed creator,
        uint256 amount
    );

    event CounterStakeRefunded(
        uint256 indexed disputeId,
        address indexed reporter,
        uint256 amount
    );

    event ReputationUpdated(
        address indexed curator,
        int256 oldScore,
        int256 newScore
    );

    // ============ Errors ============

    error SelfReport();
    error InsufficientCounterStake();
    error NotStaked();
    error DisputeNotResolved();
    error AlreadyClaimed();
    error NotUpheld();
    error TransferFailed();
    error ZeroAddress();

    // ============ Constructor ============

    constructor(
        address _owner,
        address _contentProtection,
        address _disputeResolution,
        address _treasury
    ) Ownable(_owner) {
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
    function reportContent(
        uint256 tokenId,
        string calldata evidenceURI
    ) external payable nonReentrant returns (uint256 disputeId) {
        // Get creator from attestation
        (, , , address creator, , bool valid) = contentProtection.attestations(
            tokenId
        );
        if (!valid) revert NotStaked();

        // Reporter cannot be the creator
        if (msg.sender == creator) revert SelfReport();

        // Verify counter-stake amount
        uint256 requiredStake = _getRequiredCounterStake();
        if (msg.value < requiredStake) revert InsufficientCounterStake();

        // File dispute on DisputeResolution
        disputeId = disputeResolution.fileDispute{value: 0}(
            tokenId,
            msg.sender,
            creator,
            evidenceURI
        );

        // Track counter-stake and reporter
        counterStakes[disputeId] = msg.value;
        reporters[disputeId] = msg.sender;

        emit ContentReported(
            disputeId,
            tokenId,
            msg.sender,
            msg.value,
            evidenceURI
        );
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

        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(
            disputeId
        );
        if (d.status != IDisputeResolution.DisputeStatus.Resolved)
            revert DisputeNotResolved();
        if (d.outcome != IDisputeResolution.Outcome.Upheld) revert NotUpheld();

        bountyClaimed[disputeId] = true;

        // Refund counter-stake to reporter
        uint256 counterStake = counterStakes[disputeId];

        // Update reputation: +10 for successful report
        _updateReputation(msg.sender, 10);
        successfulReports[msg.sender]++;

        // Transfer counter-stake refund
        if (counterStake > 0) {
            (bool ok, ) = payable(msg.sender).call{value: counterStake}("");
            if (!ok) revert TransferFailed();
        }

        emit BountyClaimed(disputeId, msg.sender, counterStake);
    }

    // ============ Handle Rejected Dispute ============

    /**
     * @notice Process a rejected dispute — slash reporter's counter-stake
     *         and send it to the creator as compensation.
     * @param disputeId The resolved dispute
     */
    function processRejection(uint256 disputeId) external nonReentrant {
        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(
            disputeId
        );
        if (d.status != IDisputeResolution.DisputeStatus.Resolved)
            revert DisputeNotResolved();
        if (d.outcome != IDisputeResolution.Outcome.Rejected)
            revert NotUpheld();
        if (bountyClaimed[disputeId]) revert AlreadyClaimed();

        bountyClaimed[disputeId] = true; // prevent double-processing

        uint256 counterStake = counterStakes[disputeId];
        address reporter = reporters[disputeId];

        // Update reputation: -15 for rejected report
        _updateReputation(reporter, -15);
        rejectedReports[reporter]++;

        // Send counter-stake to creator as compensation
        if (counterStake > 0) {
            (bool ok, ) = payable(d.creator).call{value: counterStake}("");
            if (!ok) revert TransferFailed();
        }

        emit CounterStakeSlashed(disputeId, reporter, d.creator, counterStake);
    }

    // ============ Handle Inconclusive ============

    /**
     * @notice Refund counter-stake on inconclusive dispute.
     * @param disputeId The resolved dispute
     */
    function processInconclusive(uint256 disputeId) external nonReentrant {
        IDisputeResolution.Dispute memory d = disputeResolution.getDispute(
            disputeId
        );
        if (d.status != IDisputeResolution.DisputeStatus.Resolved)
            revert DisputeNotResolved();
        if (d.outcome != IDisputeResolution.Outcome.Inconclusive)
            revert NotUpheld();
        if (bountyClaimed[disputeId]) revert AlreadyClaimed();

        bountyClaimed[disputeId] = true;

        uint256 counterStake = counterStakes[disputeId];
        address reporter = reporters[disputeId];

        // Refund counter-stake — no reputation change
        if (counterStake > 0) {
            (bool ok, ) = payable(reporter).call{value: counterStake}("");
            if (!ok) revert TransferFailed();
        }

        emit CounterStakeRefunded(disputeId, reporter, counterStake);
    }

    // ============ Internal ============

    function _getRequiredCounterStake() internal view returns (uint256) {
        uint256 stakeAmount = contentProtection.stakeAmount();
        return (stakeAmount * counterStakeBps) / 10000;
    }

    function _updateReputation(address curator, int256 delta) internal {
        int256 oldScore = reputationScores[curator];
        reputationScores[curator] = oldScore + delta;
        emit ReputationUpdated(curator, oldScore, oldScore + delta);
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
        return _getRequiredCounterStake();
    }

    function getReputation(address curator) external view returns (int256) {
        return reputationScores[curator];
    }
}
