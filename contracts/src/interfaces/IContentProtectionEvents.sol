// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IContentProtectionEvents
/// @notice Canonical shared surface (events + custom errors) for ContentProtection.
/// Kept separate from the consumer interface IContentProtection (which carries the
/// Attestation struct and the function signatures other contracts call): this
/// interface declares no functions, so the ContentProtection contract, its tests,
/// and indexers can all inherit it for `emit`/`expectEmit`/`selector` without
/// having to implement the consumer surface. IContentProtection extends this so
/// callers that catch ContentProtection reverts can reference the errors too.
interface IContentProtectionEvents {
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
    event PaymentAssetRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event StakeAssetAmountUpdated(address indexed token, uint256 oldAmount, uint256 newAmount);
    event RegistrarUpdated(address indexed registrar, bool allowed);
    event TrackRegistered(uint256 indexed releaseId, uint256 indexed trackId);
    event StemRegistered(uint256 indexed trackId, uint256 indexed stemTokenId);
    event StemProtectionRootRegistered(uint256 indexed releaseId, uint256 indexed stemTokenId);
    event TrackRevoked(uint256 indexed trackId);
    event ReleaseRevoked(uint256 indexed releaseId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice A two-step ownership handoff was started: `newOwner` must call
    /// `acceptOwnership` to complete it (CP-3, #1271). `OwnershipTransferred` is emitted
    /// on acceptance.
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event PaymentEscrowed(address indexed token, address indexed recipient, uint256 amount);
    event FailedPaymentClaimed(address indexed token, address indexed recipient, uint256 amount);
    event BurnedSwept(address indexed token, address indexed treasury, uint256 amount);

    // ============ Errors ============

    error NotOwner();
    error AlreadyAttested();
    error NotAttested();
    error AlreadyStaked();
    error NotStaked();
    error InsufficientStake();
    error IsBlacklisted();
    error NotBlacklisted();
    error NotRegistrar();
    error InvalidParent();
    error RegistrationConflict();
    error TransferFailed();
    error ZeroAddress();
    error InvalidMultiplier();
    error InvalidTier();
    error UnsupportedStakeAsset();
    error UnexpectedETH();
    error InvalidStakeAmount();
    error FeeOnTransferNotSupported(uint256 expected, uint256 received);
    error NothingToClaim();
    error OnlySelf();

    /// @notice `acceptOwnership` was called by an address that is not the staged
    /// pending owner (CP-3, #1271).
    error NotPendingOwner(address caller);

    /// @notice The attestation authorization voucher was not signed by a registered
    /// registrar for this exact caller and tokenId (CP-1, #1271).
    error InvalidAttestationSignature();

    /// @notice The attestation authorization voucher deadline has passed (CP-1, #1271).
    error AttestationAuthorizationExpired(uint256 deadline, uint256 currentTime);
}
