// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IDisputeResolutionEvents
/// @notice Canonical shared surface (enums, events, custom errors) for
/// DisputeResolution. Kept separate from the consumer interface IDisputeResolution
/// (which adds the Dispute struct and the function signatures other contracts call):
/// this interface declares no functions, so the DisputeResolution contract, its
/// tests, and indexers can inherit it for `emit`/`expectEmit`/`selector` without
/// implementing the consumer surface. The enums live here (not in IDisputeResolution)
/// because the events reference them; IDisputeResolution extends this interface.
/// Reference the enums via IDisputeResolutionEvents (e.g. IDisputeResolutionEvents.Outcome) —
/// an inherited enum is not reachable through the derived interface's name.
interface IDisputeResolutionEvents {
    // ============ Enums ============

    enum DisputeStatus {
        Filed,
        Evidence,
        UnderReview,
        Escalated,
        JuryVoting,
        Resolved,
        Appealed
    }

    enum Outcome {
        Pending,
        Upheld,
        Rejected,
        Inconclusive
    }

    enum JuryVote {
        None,
        Reporter,
        Creator
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
        uint256 indexed disputeId, address indexed submitter, string evidenceURI, uint256 evidenceIndex
    );

    event DisputeStatusChanged(uint256 indexed disputeId, DisputeStatus oldStatus, DisputeStatus newStatus);

    event DisputeResolved(uint256 indexed disputeId, uint256 indexed tokenId, Outcome outcome, address resolver);

    event DisputeAppealed(uint256 indexed disputeId, address indexed appealer, uint8 appealNumber);

    event JurorRegistered(address indexed juror);
    event JurorRemoved(address indexed juror);
    event DisputeEscalatedToJury(uint256 indexed disputeId, uint8 jurySize, uint256 juryDeadlineAt);
    event JuryVoteCast(uint256 indexed disputeId, address indexed juror, JuryVote vote);
    event JuryResolved(uint256 indexed disputeId, Outcome outcome, uint8 votesForReporter, uint8 votesForCreator);

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
}
