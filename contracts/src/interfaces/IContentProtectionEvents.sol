// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAddressGuard} from "../common/IAddressGuard.sol";
import {IFailedPaymentRecovery} from "../common/IFailedPaymentRecovery.sol";
import {IFeeOnTransferGuard} from "../common/IFeeOnTransferGuard.sol";
import {INativePayment} from "../common/INativePayment.sol";
import {IOwnershipTransfer} from "../common/IOwnershipTransfer.sol";
import {IPaymentAssetRegistryConsumer} from "../common/IPaymentAssetRegistryConsumer.sol";
import {IPausableGuard} from "../common/IPausableGuard.sol";
import {IStakeGuards} from "../common/IStakeGuards.sol";
import {IUpgradeAuthority} from "../common/IUpgradeAuthority.sol";

/// @title IContentProtectionEvents
/// @notice Canonical shared surface (events + custom errors) for ContentProtection.
/// Kept separate from the consumer interface IContentProtection (which carries the
/// Attestation struct and the function signatures other contracts call): this
/// interface declares no functions, so the ContentProtection contract, its tests,
/// and indexers can all inherit it for `emit`/`expectEmit`/`selector` without
/// having to implement the consumer surface. IContentProtection extends this so
/// callers that catch ContentProtection reverts can reference the errors too.
interface IContentProtectionEvents is
    IAddressGuard,
    IFailedPaymentRecovery,
    IFeeOnTransferGuard,
    INativePayment,
    IOwnershipTransfer,
    IPaymentAssetRegistryConsumer,
    IPausableGuard,
    IStakeGuards,
    IUpgradeAuthority
{
    // ============ Events ============

    event ContentAttested(
        uint256 indexed tokenId,
        address indexed attester,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string metadataURI
    );

    event StakeDeposited(uint256 indexed tokenId, address indexed staker, uint256 amount);

    event StakeDepositedWithAsset(
        uint256 indexed tokenId, address indexed staker, address indexed token, uint256 amount
    );

    event StakeSlashed(
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 reporterAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );

    event StakeSlashedWithAsset(
        uint256 indexed tokenId,
        address indexed reporter,
        address indexed token,
        uint256 reporterAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );

    event StakeRefunded(uint256 indexed tokenId, address indexed staker, uint256 amount);

    event StakeRefundedWithAsset(
        uint256 indexed tokenId, address indexed staker, address indexed token, uint256 amount
    );

    event Blacklisted(address indexed account);
    event BlacklistRemoved(address indexed account);
    event StakeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event TierPolicyUpdated(
        string tierName,
        uint256 oldStakeAmountWei,
        uint256 oldEscrowDays,
        uint256 newStakeAmountWei,
        uint256 newEscrowDays
    );
    event MaxPriceMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event StakeAssetAmountUpdated(address indexed token, uint256 oldAmount, uint256 newAmount);
    event RegistrarUpdated(address indexed registrar, bool allowed);
    event TrackRegistered(uint256 indexed releaseId, uint256 indexed trackId);
    event StemRegistered(uint256 indexed trackId, uint256 indexed stemTokenId);
    event StemProtectionRootRegistered(uint256 indexed releaseId, uint256 indexed stemTokenId);
    event TrackRevoked(uint256 indexed trackId);
    event ReleaseRevoked(uint256 indexed releaseId);
    /// @notice A two-step ownership handoff was started: `newOwner` must call
    /// `acceptOwnership` to complete it (CP-3, #1271). `OwnershipTransferred` is emitted
    /// on acceptance.
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event BurnedSwept(address indexed token, address indexed treasury, uint256 amount);
    event ContentProtectionPaused(bool paused);

    /// @notice The attester withdrew their own stake through `claimStakeRefund` (#1759).
    /// Emitted instead of `StakeRefunded`, which stays the owner-issued refund event.
    event StakeRefundClaimed(
        uint256 indexed tokenId, address indexed attester, address indexed token, uint256 amount
    );

    /// @notice The self-claim deadline of a stake was recorded, at stake time or by
    /// the owner backfill for stakes deposited before V7 (#1759).
    event StakeEscrowRecorded(uint256 indexed tokenId, uint256 claimableAt);

    /// @notice A stake's dispute hold was set or cleared by the owner or the
    /// authorised stake-lock authority (DisputeResolution) (#1759).
    event StakeLockUpdated(uint256 indexed tokenId, bool locked, address indexed updatedBy);

    /// @notice The address allowed to set and clear stake locks besides the owner changed.
    event StakeLockAuthorityUpdated(address indexed previousAuthority, address indexed newAuthority);

    // ============ Errors ============

    error NotOwner();
    error AlreadyAttested();
    error NotAttested();
    error AlreadyStaked();
    error InsufficientStake();
    error IsBlacklisted();
    error NotBlacklisted();
    error NotRegistrar();
    error InvalidParent();
    error RegistrationConflict();
    error InvalidMultiplier();
    error InvalidTier();
    error InvalidStakeAmount();
    error FreshInitializationOnly();

    /// @notice `acceptOwnership` was called by an address that is not the staged
    /// pending owner (CP-3, #1271).
    error NotPendingOwner(address caller);

    /// @notice The attestation authorization voucher was not signed by a registered
    /// registrar for this exact caller and tokenId (CP-1, #1271).
    error InvalidAttestationSignature();

    /// @notice The attestation authorization voucher deadline has passed (CP-1, #1271).
    error AttestationAuthorizationExpired(uint256 deadline, uint256 currentTime);

    /// @notice `claimStakeRefund` was called by someone other than the stake's attester.
    error NotStakeAttester(uint256 tokenId, address caller);

    /// @notice The stake predates V7 and its claim deadline has not been backfilled yet.
    error StakeEscrowNotRecorded(uint256 tokenId);

    /// @notice The stake's escrow has not elapsed; it becomes claimable at `claimableAt`.
    error StakeEscrowActive(uint256 tokenId, uint256 claimableAt);

    /// @notice The stake is held by a dispute; the fail-safe opens the claim at `failSafeAt`.
    error StakeLockActive(uint256 tokenId, uint256 failSafeAt);

    /// @notice `setStakeLock` was called by neither the owner nor the stake-lock authority.
    error NotStakeLockAuthority(address caller);
}
