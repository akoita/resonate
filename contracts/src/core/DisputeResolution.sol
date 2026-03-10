// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDisputeResolution} from "../interfaces/IDisputeResolution.sol";

/**
 * @title DisputeResolution
 * @notice On-chain dispute lifecycle: filed → evidence → review → resolved.
 *
 * Design:
 *   - Disputes reference a tokenId and track reporter vs creator
 *   - Evidence submitted by either party (max 5 per party)
 *   - Admin resolves in Phase 1 (Kleros/DAO jury in future phases)
 *   - Resolution triggers slash or counter-stake refund via CurationRewards
 *
 * @custom:version 1.0.0
 */
contract DisputeResolution is Ownable, ReentrancyGuard, IDisputeResolution {
    // ============ Constants ============

    uint256 public constant MAX_EVIDENCE_PER_PARTY = 5;

    // ============ State ============

    uint256 private _disputeCount;

    /// @notice disputeId → Dispute
    mapping(uint256 => Dispute) public disputes;

    /// @notice disputeId → party address → evidence count
    mapping(uint256 => mapping(address => uint256)) public evidenceCounts;

    /// @notice disputeId → evidence index → Evidence
    mapping(uint256 => mapping(uint256 => Evidence)) public evidences;

    /// @notice disputeId → total evidence count
    mapping(uint256 => uint256) public totalEvidenceCounts;

    /// @notice tokenId → active disputeId (0 = no active dispute)
    mapping(uint256 => uint256) public activeDisputeByToken;

    // ============ Structs ============

    struct Evidence {
        address submitter;
        string evidenceURI;
        uint256 timestamp;
    }

    // ============ Events ============

    event DisputeFiled(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        address indexed reporter,
        address creator,
        string evidenceURI,
        uint256 counterStake
    );

    event EvidenceSubmitted(
        uint256 indexed disputeId,
        address indexed submitter,
        string evidenceURI,
        uint256 evidenceIndex
    );

    event DisputeStatusChanged(
        uint256 indexed disputeId,
        DisputeStatus oldStatus,
        DisputeStatus newStatus
    );

    event DisputeResolved(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        Outcome outcome,
        address resolver
    );

    // ============ Errors ============

    error DisputeNotFound();
    error NotDisputeParty();
    error MaxEvidenceReached();
    error DisputeAlreadyResolved();
    error InvalidOutcome();
    error DisputeNotUnderReview();
    error ActiveDisputeExists();

    // ============ Constructor ============

    constructor(address _owner) Ownable(_owner) {}

    // ============ File Dispute ============

    /**
     * @notice File a new dispute. Called by CurationRewards.
     * @param tokenId The token being disputed
     * @param reporter The address filing the report
     * @param creator The content creator's address
     * @param evidenceURI IPFS URI to evidence
     * @return disputeId The new dispute's ID
     */
    function fileDispute(
        uint256 tokenId,
        address reporter,
        address creator,
        string calldata evidenceURI
    ) external payable returns (uint256 disputeId) {
        if (activeDisputeByToken[tokenId] != 0) revert ActiveDisputeExists();

        _disputeCount++;
        disputeId = _disputeCount;

        disputes[disputeId] = Dispute({
            tokenId: tokenId,
            reporter: reporter,
            creator: creator,
            evidenceURI: evidenceURI,
            counterStake: msg.value,
            status: DisputeStatus.Filed,
            outcome: Outcome.Pending,
            filedAt: block.timestamp,
            resolvedAt: 0
        });

        activeDisputeByToken[tokenId] = disputeId;

        emit DisputeFiled(
            disputeId,
            tokenId,
            reporter,
            creator,
            evidenceURI,
            msg.value
        );
    }

    // ============ Evidence ============

    /**
     * @notice Submit evidence for an active dispute.
     *         Only reporter or creator can submit. Max 5 per party.
     * @param disputeId The dispute to add evidence to
     * @param evidenceURI IPFS URI to the evidence document
     */
    function submitEvidence(
        uint256 disputeId,
        string calldata evidenceURI
    ) external {
        Dispute storage d = disputes[disputeId];
        if (d.filedAt == 0) revert DisputeNotFound();
        if (d.status == DisputeStatus.Resolved) revert DisputeAlreadyResolved();
        if (msg.sender != d.reporter && msg.sender != d.creator)
            revert NotDisputeParty();
        if (evidenceCounts[disputeId][msg.sender] >= MAX_EVIDENCE_PER_PARTY)
            revert MaxEvidenceReached();

        // Transition to Evidence status if still Filed
        if (d.status == DisputeStatus.Filed) {
            DisputeStatus old = d.status;
            d.status = DisputeStatus.Evidence;
            emit DisputeStatusChanged(disputeId, old, d.status);
        }

        uint256 evidenceIndex = totalEvidenceCounts[disputeId];
        evidences[disputeId][evidenceIndex] = Evidence({
            submitter: msg.sender,
            evidenceURI: evidenceURI,
            timestamp: block.timestamp
        });

        totalEvidenceCounts[disputeId]++;
        evidenceCounts[disputeId][msg.sender]++;

        emit EvidenceSubmitted(
            disputeId,
            msg.sender,
            evidenceURI,
            evidenceIndex
        );
    }

    // ============ Resolution ============

    /**
     * @notice Move dispute to UnderReview. Admin only.
     * @param disputeId The dispute to mark for review
     */
    function markUnderReview(uint256 disputeId) external onlyOwner {
        Dispute storage d = disputes[disputeId];
        if (d.filedAt == 0) revert DisputeNotFound();
        if (d.status == DisputeStatus.Resolved) revert DisputeAlreadyResolved();

        DisputeStatus old = d.status;
        d.status = DisputeStatus.UnderReview;
        emit DisputeStatusChanged(disputeId, old, d.status);
    }

    /**
     * @notice Resolve a dispute. Admin only in Phase 1.
     *         Does NOT transfer funds — caller (CurationRewards) handles payouts.
     * @param disputeId The dispute to resolve
     * @param outcome The resolution outcome
     */
    function resolve(uint256 disputeId, Outcome outcome) external onlyOwner {
        Dispute storage d = disputes[disputeId];
        if (d.filedAt == 0) revert DisputeNotFound();
        if (d.status == DisputeStatus.Resolved) revert DisputeAlreadyResolved();
        if (outcome == Outcome.Pending) revert InvalidOutcome();

        d.status = DisputeStatus.Resolved;
        d.outcome = outcome;
        d.resolvedAt = block.timestamp;

        // Clear active dispute for this token
        activeDisputeByToken[d.tokenId] = 0;

        emit DisputeResolved(disputeId, d.tokenId, outcome, msg.sender);
    }

    // ============ Views ============

    function getDispute(
        uint256 disputeId
    ) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function getEvidence(
        uint256 disputeId,
        uint256 index
    ) external view returns (Evidence memory) {
        return evidences[disputeId][index];
    }

    function disputeCount() external view returns (uint256) {
        return _disputeCount;
    }

    function getActiveDispute(uint256 tokenId) external view returns (uint256) {
        return activeDisputeByToken[tokenId];
    }
}
