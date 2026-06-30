// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IRevenueEscrow
/// @notice Canonical shared surface (struct, events, errors) for RevenueEscrow.
/// Production code, tests, and indexers import this so the event/error contract
/// cannot silently drift.
interface IRevenueEscrow {
    // ============ Structs ============

    struct EscrowInfo {
        address beneficiary;
        uint256 balance;
        uint256 escrowEndTime;
        bool frozen;
    }

    // ============ Events ============

    event RevenueDeposited(uint256 indexed tokenId, address indexed depositor, uint256 amount, uint256 newBalance);
    event RevenueDepositedWithAsset(
        uint256 indexed tokenId, address indexed depositor, address indexed token, uint256 amount, uint256 newBalance
    );

    event EscrowFrozen(uint256 indexed tokenId);
    event EscrowUnfrozen(uint256 indexed tokenId);

    event EscrowFrozenWithAsset(uint256 indexed tokenId, address indexed token);
    event EscrowUnfrozenWithAsset(uint256 indexed tokenId, address indexed token);

    event EscrowReleased(uint256 indexed tokenId, address indexed beneficiary, uint256 amount);
    event EscrowReleasedWithAsset(
        uint256 indexed tokenId, address indexed beneficiary, address indexed token, uint256 amount
    );

    event EscrowRedirected(uint256 indexed tokenId, address indexed newRecipient, uint256 amount);
    event EscrowRedirectedWithAsset(
        uint256 indexed tokenId, address indexed newRecipient, address indexed token, uint256 amount
    );

    event EscrowPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);

    event DepositorUpdated(address indexed depositor, bool allowed);

    event PaymentEscrowed(address indexed token, address indexed recipient, uint256 amount);
    event FailedPaymentClaimed(address indexed token, address indexed recipient, uint256 amount);

    // ============ Errors ============

    error NoEscrow();
    error EscrowIsFrozen();
    error EscrowNotFrozen();
    error EscrowNotExpired();
    error ZeroAmount();
    error ZeroAddress();
    error ContentProtectionNotSet();
    error TransferFailed();
    error UnexpectedETH();
    error UnsupportedAsset();
    error UnauthorizedDepositor(address caller);
    error BeneficiaryMismatch(uint256 tokenId, address expected, address provided);
    error FeeOnTransferNotSupported(uint256 expected, uint256 received);
    error TooManyEscrowAssets(uint256 tokenId);
    error NothingToClaim();
    error OnlySelf();
}
