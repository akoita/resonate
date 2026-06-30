// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ICurationRewards
/// @notice Canonical shared surface (events, errors) for CurationRewards.
/// Production code, tests, and indexers import this so the event/error contract
/// cannot silently drift.
interface ICurationRewards {
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
}
