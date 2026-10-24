// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAddressGuard} from "../common/IAddressGuard.sol";
import {IDisputeGuards} from "../common/IDisputeGuards.sol";

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
interface IDisputeResolutionEvents is IAddressGuard, IDisputeGuards {
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

    /// @notice Stake locking was enabled (both non-zero) or disabled (both zero) (#1759).
    event StakeLockingConfigured(address indexed contentProtection, address indexed disputeFiler);

    /// @notice A dispute started or stopped holding the Content Protection stake of
    /// `stakeRoot` (#1759). The stake stays locked while any dispute holds it.
    event StakeHoldUpdated(uint256 indexed disputeId, uint256 indexed stakeRoot, bool held);

    // ============ Errors ============

    error DisputeNotFound();
    error MaxEvidenceReached();
    error DisputeAlreadyResolved();
    error InvalidOutcome();
    error DisputeNotUnderReview();
    error ActiveDisputeExists();
    error AlreadyReported();
    error MaxAppealsReached();
    error NotLosingParty();
    error InvalidDisputeStatus();
    error JurorAlreadyRegistered();
    error JurorNotRegistered();
    error InsufficientJurors();
    error NotAssignedJuror();
    error AlreadyVoted();
    error JuryVotePending();

    /// @notice Stake locking is on and the caller is not the configured dispute filer.
    error UnauthorizedDisputeFiler(address caller);

    /// @notice Stake locking needs both addresses set, or both cleared.
    error InvalidStakeLockConfig();

    /// @notice The dispute holds no stake lock to release.
    error NoStakeHold(uint256 disputeId);
}
