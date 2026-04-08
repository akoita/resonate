// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDisputeResolution} from "../interfaces/IDisputeResolution.sol";

/**
 * @title DisputeResolution
 * @notice On-chain dispute lifecycle: filed → evidence → review → resolved → (appeal).
 *
 * Design:
 *   - Disputes reference a tokenId and track reporter vs creator
 *   - Evidence submitted by either party (max 5 per party)
 *   - Admin resolves in Phase 1 (Kleros/DAO jury in future phases)
 *   - Resolution triggers slash or counter-stake refund via CurationRewards
 *   - Losing party may appeal up to 2 times (RFC §5.4)
 *
 * @custom:version 2.0.0
 */
contract DisputeResolution is Ownable, ReentrancyGuard, IDisputeResolution {
    // ============ Constants ============

    uint256 public constant MAX_EVIDENCE_PER_PARTY = 5;
    uint8 public constant MAX_APPEALS = 2;
    uint8 public constant DEFAULT_JURY_SIZE = 3;
    uint256 public constant DEFAULT_JURY_VOTING_PERIOD = 7 days;

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

    /// @notice tokenId → reporter → whether this wallet has already reported the token
    mapping(uint256 => mapping(address => bool)) public hasReportedByToken;

    /// @notice eligible juror set managed from the current staked-curator pool
    mapping(address => bool) public eligibleJurors;

    /// @notice pool of eligible jurors used for pseudo-random assignment
    address[] public jurorPool;

    /// @notice disputeId → assigned jurors
    mapping(uint256 => address[]) private _assignedJurors;

    /// @notice disputeId → juror → assigned?
    mapping(uint256 => mapping(address => bool)) public isAssignedJuror;

    /// @notice disputeId → juror → vote
    mapping(uint256 => mapping(address => JuryVote)) public juryVotes;

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

    event DisputeAppealed(
        uint256 indexed disputeId,
        address indexed appealer,
        uint8 appealNumber
    );

    event JurorRegistered(address indexed juror);
    event JurorRemoved(address indexed juror);
    event DisputeEscalatedToJury(
        uint256 indexed disputeId,
        uint8 jurySize,
        uint256 juryDeadlineAt
    );
    event JuryVoteCast(
        uint256 indexed disputeId,
        address indexed juror,
        JuryVote vote
    );
    event JuryResolved(
        uint256 indexed disputeId,
        Outcome outcome,
        uint8 votesForReporter,
        uint8 votesForCreator
    );

    // ============ Errors ============

    error DisputeNotFound();
    error NotDisputeParty();
    error MaxEvidenceReached();
    error DisputeAlreadyResolved();
    error InvalidOutcome();
    error DisputeNotUnderReview();
    error ActiveDisputeExists();
    error AlreadyReported();
    error DisputeNotResolved();
    error MaxAppealsReached();
    error NotLosingParty();
    error InvalidDisputeStatus();
    error ZeroAddress();
    error JurorAlreadyRegistered();
    error JurorNotRegistered();
    error InsufficientJurors();
    error NotAssignedJuror();
    error AlreadyVoted();
    error JuryVotePending();

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
        if (hasReportedByToken[tokenId][reporter]) revert AlreadyReported();

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
            resolvedAt: 0,
            appealCount: 0,
            escalatedAt: 0,
            juryDeadlineAt: 0,
            jurorCount: 0,
            votesForReporter: 0,
            votesForCreator: 0
        });

        activeDisputeByToken[tokenId] = disputeId;
        hasReportedByToken[tokenId][reporter] = true;

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

        // Transition to Evidence status if still Filed or Appealed
        if (
            d.status == DisputeStatus.Filed ||
            d.status == DisputeStatus.Appealed
        ) {
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
        if (
            d.status == DisputeStatus.Escalated ||
            d.status == DisputeStatus.JuryVoting
        ) revert InvalidDisputeStatus();
        if (outcome == Outcome.Pending) revert InvalidOutcome();

        d.status = DisputeStatus.Resolved;
        d.outcome = outcome;
        d.resolvedAt = block.timestamp;

        // Clear active dispute for this token
        activeDisputeByToken[d.tokenId] = 0;

        emit DisputeResolved(disputeId, d.tokenId, outcome, msg.sender);
    }

    // ============ Jury Management ============

    function registerJuror(address juror) external onlyOwner {
        if (juror == address(0)) revert ZeroAddress();
        if (eligibleJurors[juror]) revert JurorAlreadyRegistered();

        eligibleJurors[juror] = true;
        jurorPool.push(juror);

        emit JurorRegistered(juror);
    }

    function removeJuror(address juror) external onlyOwner {
        if (!eligibleJurors[juror]) revert JurorNotRegistered();

        eligibleJurors[juror] = false;

        uint256 length = jurorPool.length;
        for (uint256 i = 0; i < length; i++) {
            if (jurorPool[i] == juror) {
                jurorPool[i] = jurorPool[length - 1];
                jurorPool.pop();
                emit JurorRemoved(juror);
                return;
            }
        }

        revert JurorNotRegistered();
    }

    function escalateToJury(uint256 disputeId) external onlyOwner {
        Dispute storage d = disputes[disputeId];
        if (d.filedAt == 0) revert DisputeNotFound();
        if (
            d.status != DisputeStatus.UnderReview &&
            d.status != DisputeStatus.Appealed
        ) revert InvalidDisputeStatus();
        if (jurorPool.length < DEFAULT_JURY_SIZE) revert InsufficientJurors();

        delete _assignedJurors[disputeId];

        d.status = DisputeStatus.Escalated;
        d.outcome = Outcome.Pending;
        d.resolvedAt = 0;
        d.escalatedAt = block.timestamp;
        d.juryDeadlineAt = block.timestamp + DEFAULT_JURY_VOTING_PERIOD;
        d.jurorCount = DEFAULT_JURY_SIZE;
        d.votesForReporter = 0;
        d.votesForCreator = 0;

        _assignJurors(disputeId, DEFAULT_JURY_SIZE);

        emit DisputeEscalatedToJury(
            disputeId,
            DEFAULT_JURY_SIZE,
            d.juryDeadlineAt
        );
    }

    function castJuryVote(uint256 disputeId, JuryVote vote) external {
        Dispute storage d = disputes[disputeId];
        if (
            d.status != DisputeStatus.Escalated &&
            d.status != DisputeStatus.JuryVoting
        ) revert InvalidDisputeStatus();
        if (!isAssignedJuror[disputeId][msg.sender]) revert NotAssignedJuror();
        if (vote != JuryVote.Reporter && vote != JuryVote.Creator) {
            revert InvalidOutcome();
        }
        if (juryVotes[disputeId][msg.sender] != JuryVote.None) {
            revert AlreadyVoted();
        }

        if (d.status == DisputeStatus.Escalated) {
            d.status = DisputeStatus.JuryVoting;
        }

        juryVotes[disputeId][msg.sender] = vote;

        if (vote == JuryVote.Reporter) {
            d.votesForReporter++;
        } else {
            d.votesForCreator++;
        }

        emit JuryVoteCast(disputeId, msg.sender, vote);
    }

    function finalizeJuryDecision(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        if (
            d.status != DisputeStatus.Escalated &&
            d.status != DisputeStatus.JuryVoting
        ) revert InvalidDisputeStatus();

        uint8 majority = (d.jurorCount / 2) + 1;
        bool reporterWon = d.votesForReporter >= majority;
        bool creatorWon = d.votesForCreator >= majority;
        bool deadlinePassed = block.timestamp >= d.juryDeadlineAt;

        if (!reporterWon && !creatorWon && !deadlinePassed) {
            revert JuryVotePending();
        }

        if (reporterWon) {
            d.outcome = Outcome.Upheld;
        } else if (creatorWon) {
            d.outcome = Outcome.Rejected;
        } else {
            d.outcome = Outcome.Inconclusive;
        }

        d.status = DisputeStatus.Resolved;
        d.resolvedAt = block.timestamp;
        activeDisputeByToken[d.tokenId] = 0;

        emit JuryResolved(
            disputeId,
            d.outcome,
            d.votesForReporter,
            d.votesForCreator
        );
        emit DisputeResolved(disputeId, d.tokenId, d.outcome, msg.sender);
    }

    // ============ Appeals ============

    /**
     * @notice Appeal a resolved dispute. Only the losing party may appeal.
     *         Max 2 appeals per dispute (RFC §5.4).
     *         Reopens the dispute so new evidence can be submitted and
     *         the admin re-reviews.
     * @param disputeId The dispute to appeal
     * @param appealer The address appealing (validated as the losing party)
     */
    function appeal(uint256 disputeId, address appealer) external {
        Dispute storage d = disputes[disputeId];
        if (d.filedAt == 0) revert DisputeNotFound();
        if (d.status != DisputeStatus.Resolved) revert DisputeNotResolved();
        if (d.appealCount >= MAX_APPEALS) revert MaxAppealsReached();

        // Only the losing party can appeal
        address loser = d.outcome == Outcome.Upheld
            ? d.creator // dispute upheld = creator lost
            : d.reporter; // dispute rejected = reporter lost
        if (d.outcome == Outcome.Inconclusive) revert InvalidOutcome();
        if (appealer != loser) revert NotLosingParty();

        d.appealCount++;
        d.status = DisputeStatus.Appealed;
        d.outcome = Outcome.Pending;
        d.resolvedAt = 0;
        d.escalatedAt = 0;
        d.juryDeadlineAt = 0;
        d.jurorCount = 0;
        d.votesForReporter = 0;
        d.votesForCreator = 0;
        _clearAssignedJurors(disputeId);

        // Re-activate the dispute for this token
        activeDisputeByToken[d.tokenId] = disputeId;

        emit DisputeAppealed(disputeId, appealer, d.appealCount);
    }

    // ============ Views ============

    function getDispute(
        uint256 disputeId
    ) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function getAssignedJurors(
        uint256 disputeId
    ) external view returns (address[] memory) {
        return _assignedJurors[disputeId];
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

    function _assignJurors(uint256 disputeId, uint8 count) internal {
        uint256 poolSize = jurorPool.length;
        uint256 nonce = 0;

        while (_assignedJurors[disputeId].length < count) {
            uint256 index = uint256(
                keccak256(
                    abi.encodePacked(
                        block.prevrandao,
                        block.timestamp,
                        disputeId,
                        nonce
                    )
                )
            ) % poolSize;
            address juror = jurorPool[index];
            nonce++;

            if (
                juror == disputes[disputeId].reporter ||
                juror == disputes[disputeId].creator ||
                isAssignedJuror[disputeId][juror]
            ) {
                continue;
            }

            isAssignedJuror[disputeId][juror] = true;
            _assignedJurors[disputeId].push(juror);
        }
    }

    function _clearAssignedJurors(uint256 disputeId) internal {
        address[] storage assigned = _assignedJurors[disputeId];
        uint256 length = assigned.length;
        for (uint256 i = 0; i < length; i++) {
            address juror = assigned[i];
            isAssignedJuror[disputeId][juror] = false;
            juryVotes[disputeId][juror] = JuryVote.None;
        }
        delete _assignedJurors[disputeId];
    }
}
