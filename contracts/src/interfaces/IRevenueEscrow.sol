// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAddressGuard} from "../common/IAddressGuard.sol";
import {IAmountGuard} from "../common/IAmountGuard.sol";
import {IFailedPaymentRecovery} from "../common/IFailedPaymentRecovery.sol";
import {IFeeOnTransferGuard} from "../common/IFeeOnTransferGuard.sol";
import {INativePayment} from "../common/INativePayment.sol";
import {IPausableGuard} from "../common/IPausableGuard.sol";
import {IUpgradeAuthority} from "../common/IUpgradeAuthority.sol";

/// @title IRevenueEscrow
/// @notice Canonical shared surface (struct, events, errors) for RevenueEscrow.
/// Production code, tests, and indexers import this so the event/error contract
/// cannot silently drift.
interface IRevenueEscrow is
    IAddressGuard,
    IAmountGuard,
    IFailedPaymentRecovery,
    IFeeOnTransferGuard,
    INativePayment,
    IPausableGuard,
    IUpgradeAuthority
{
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

    event RevenueEscrowPaused(bool paused);

    // ============ Errors ============

    error NoEscrow();
    error EscrowIsFrozen();
    error EscrowNotFrozen();
    error EscrowNotExpired();
    error ContentProtectionNotSet();
    error UnsupportedAsset();
    error UnauthorizedDepositor(address caller);
    error BeneficiaryMismatch(uint256 tokenId, address expected, address provided);
    error TooManyEscrowAssets(uint256 tokenId);

    /// @notice `freezeByTrackRange` was called with a zero page size (RE-1, #1271); a
    /// zero-length page would make no progress and could loop forever.
    error ZeroMaxStems();
}
