// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {PaymentAssetRegistry} from "../payments/PaymentAssetRegistry.sol";
import {IContentProtectionEvents} from "../interfaces/IContentProtectionEvents.sol";

/**
 * @title ContentProtection
 * @notice On-chain attestation, staking, slashing, and blacklisting for content integrity.
 *
 * Design:
 *   - Creators attest ownership of protected content / release records
 *   - Stake is required per protected record — slashed on confirmed theft
 *   - Slash split: 60% reporter · 30% treasury · 10% burned
 *   - UUPS upgradeable for parameter tuning (stake amounts, escrow periods)
 *
 * Attestation authorization (CP-1, #1271):
 *   `attest` / `attestRelease` are open entrypoints, but the tokenIds they claim are
 *   predictable, so an attacker could otherwise front-run a creator and seize the
 *   attester slot (the slot is single-use — `AlreadyAttested`). To prevent squatting
 *   WITHOUT moving attestation server-side, each call must present an EIP-712
 *   authorization voucher signed by a registered `registrars[]` signer that binds the
 *   voucher to the exact `(attester = msg.sender, tokenId, deadline)`. The artist
 *   remains `msg.sender` = attester = staker, so `_recordStake`'s
 *   `attester == msg.sender` check is unchanged.
 *
 *   Replay / threat model:
 *     - The struct hashes `msg.sender`, so a voucher issued to artist A cannot be
 *       replayed by a different party B (B's structHash recovers a non-registrar).
 *     - The EIP-712 domain includes `chainId` + this contract's address, so a voucher
 *       cannot be replayed cross-chain or against a different contract.
 *     - A voucher is single-use in practice: once the slot is attested a second attest
 *       reverts `AlreadyAttested`, so re-presenting a still-valid voucher is a no-op.
 *     - A still-valid voucher after an admin `revoke`/blacklist only lets the SAME
 *       authorized artist re-attest — benign, because squatting requires a DIFFERENT
 *       party, who cannot forge the registrar's signature.
 *
 * Upgrade / migration:
 *   V5 (`reinitializeV5`) initializes the EIP-712 domain ("ContentProtection", "1") on
 *   already-deployed proxies so vouchers verify after upgrade. Fresh deploys also set
 *   the domain in `initialize`. (Versions 2–4 were already consumed by earlier
 *   reinitializers, so this migration uses reinitializer version 5.)
 *
 * @custom:version 1.1.0
 */
contract ContentProtection is
    IContentProtectionEvents,
    Initializable,
    EIP712Upgradeable,
    UUPSUpgradeable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    /// @dev EIP-712 typehash for the registrar-signed attestation authorization voucher.
    /// Binds a specific caller (`attester`), `tokenId`, and `deadline`; only a signature
    /// from a registered registrar authorizes the attestation.
    bytes32 private constant ATTESTATION_AUTHORIZATION_TYPEHASH =
        keccak256("AttestationAuthorization(address attester,uint256 tokenId,uint256 deadline)");

    // ============ Structs ============

    struct Attestation {
        bytes32 contentHash;
        bytes32 fingerprintHash;
        string metadataURI;
        address attester;
        uint256 timestamp;
        bool valid;
    }

    struct StakeInfo {
        uint256 amount;
        uint256 depositedAt;
        bool active;
    }

    struct TierPolicy {
        uint256 stakeAmountWei;
        uint256 escrowDays;
        bool configured;
    }

    // ============ State ============

    address public owner;
    address public treasury;

    uint256 public stakeAmount; // Default: 0.01 ETH (adjustable by owner)
    uint256 public maxPriceMultiplier; // Default: 10x stake per unit
    uint256 public nextTokenId; // Counter for attestation-assigned token IDs
    PaymentAssetRegistry public paymentAssetRegistry;

    mapping(uint256 => Attestation) public attestations;
    mapping(uint256 => StakeInfo) public stakes;
    mapping(uint256 => address) public stakeTokens;
    mapping(address => uint256) public stakeAmountsByToken;
    mapping(address => bool) internal _blacklisted;
    mapping(address => bool) public registrars;
    mapping(uint256 => uint256[]) private _releaseToTracks;
    mapping(uint256 => uint256[]) private _trackToStems;
    mapping(uint256 => uint256) public stemToCanonicalTrack;
    mapping(uint256 => uint256) public stemToProtectionRoot;
    mapping(uint256 => uint256) public trackToParentRelease;
    mapping(bytes32 => TierPolicy) private _tierPolicies;

    /// @notice token (address(0) = native) => recipient => amount escrowed after a
    /// failed slash payout. A reverting reporter/treasury cannot brick a slash: the
    /// funds are escrowed here and reclaimed via `claimFailedPayment`.
    /// @dev Appended after existing storage to preserve the UUPS storage layout.
    mapping(address => mapping(address => uint256)) public failedPayments;

    /// @notice token (address(0) = native) => accumulated slash remainder (the "burn")
    /// retained in the contract, sweepable to the treasury via `sweepBurned`. Tracked
    /// separately so a sweep never touches active stakes or escrowed failedPayments.
    mapping(address => uint256) public totalBurned;

    /// @notice Pending owner for the two-step ownership handoff (CP-3, #1271). Set by
    /// `transferOwnership`; promoted to `owner` when that address calls `acceptOwnership`.
    /// @dev Appended after existing storage (before the gap) to preserve the UUPS layout.
    address public pendingOwner;

    /// @dev Reserved storage slots so future upgrades can add state without shifting
    /// the existing layout. Must remain the last storage variable; shrink it by the
    /// number of slots any newly-added state occupies. Shrunk 50 -> 49 when
    /// `pendingOwner` was added (CP-3, #1271).
    uint256[49] private __gap;

    // Slash distribution (basis points, must sum to 10000)
    uint256 public constant SLASH_REPORTER_BPS = 6000; // 60%
    uint256 public constant SLASH_TREASURY_BPS = 3000; // 30%
    // Remaining 10% is burned (sent to address(0) equivalent — kept in contract then swept)
    uint256 public constant BPS = 10000;

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRegistrarOrOwner() {
        if (msg.sender != owner && !registrars[msg.sender]) {
            revert NotRegistrar();
        }
        _;
    }

    // ============ Initializer (UUPS) ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, address _treasury, uint256 _stakeAmount) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        // Fresh deploys get the EIP-712 domain here; already-deployed proxies get it via
        // reinitializeV5() (they never re-run this v1 initializer). See CP-1 (#1271).
        __EIP712_init("ContentProtection", "1");

        owner = _owner;
        treasury = _treasury;
        stakeAmount = _stakeAmount;
        maxPriceMultiplier = 10;
        _initializeTierPoliciesFromStakeAmount(_stakeAmount);
    }

    // ============ Attestation ============

    /**
     * @notice Attest ownership of protected content for staking / provenance.
     * @dev Requires a registrar-signed EIP-712 authorization voucher bound to
     *      `(msg.sender, tokenId, deadline)` to prevent attester-slot squatting on
     *      predictable tokenIds (CP-1, #1271). The caller (artist) stays the attester.
     * @param tokenId Identifier for the protected asset or release record
     * @param contentHash SHA-256 hash of the audio content
     * @param fingerprintHash Chromaprint fingerprint hash
     * @param metadataURI IPFS URI or URL pointing to attestation metadata
     * @param deadline Unix timestamp after which the authorization voucher is invalid
     * @param signature Registrar's EIP-712 signature over the authorization voucher
     */
    function attest(
        uint256 tokenId,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string calldata metadataURI,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _verifyAttestationAuthorization(tokenId, deadline, signature);
        _attest(tokenId, contentHash, fingerprintHash, metadataURI);
    }

    /**
     * @notice Canonical release-first attestation entrypoint.
     * @dev Wraps the generic attestation flow while making the protected root explicit.
     *      Requires the same registrar-signed authorization voucher as {attest}.
     */
    function attestRelease(
        uint256 releaseId,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string calldata metadataURI,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _verifyAttestationAuthorization(releaseId, deadline, signature);
        _attest(releaseId, contentHash, fingerprintHash, metadataURI);
    }

    /// @dev Verify the registrar-signed EIP-712 authorization voucher for this call.
    /// The struct binds `msg.sender` (the attester), so a voucher issued to one artist
    /// cannot be used by another party — the only way to seize a slot is a valid
    /// registrar signature for THIS caller. Any malformed/empty/wrong-signer signature
    /// reverts `InvalidAttestationSignature`.
    function _verifyAttestationAuthorization(uint256 tokenId, uint256 deadline, bytes calldata signature)
        internal
        view
    {
        if (block.timestamp > deadline) revert AttestationAuthorizationExpired(deadline, block.timestamp);

        bytes32 structHash = keccak256(abi.encode(ATTESTATION_AUTHORIZATION_TYPEHASH, msg.sender, tokenId, deadline));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), signature);
        if (err != ECDSA.RecoverError.NoError || !registrars[signer]) {
            revert InvalidAttestationSignature();
        }
    }

    function _attest(uint256 tokenId, bytes32 contentHash, bytes32 fingerprintHash, string calldata metadataURI)
        internal
    {
        if (_blacklisted[msg.sender]) revert IsBlacklisted();
        if (attestations[tokenId].valid) revert AlreadyAttested();

        attestations[tokenId] = Attestation({
            contentHash: contentHash,
            fingerprintHash: fingerprintHash,
            metadataURI: metadataURI,
            attester: msg.sender,
            timestamp: block.timestamp,
            valid: true
        });

        emit ContentAttested(tokenId, msg.sender, contentHash, fingerprintHash, metadataURI);
    }

    // ============ Staking ============

    /**
     * @notice Stake ETH when publishing protected content.
     * @param tokenId The attested content or release identifier to stake for
     */
    function stake(uint256 tokenId) external payable nonReentrant {
        _stakeNative(tokenId);
    }

    /**
     * @notice Canonical release-first staking entrypoint.
     * @dev Keeps the external API aligned with the hierarchical release-root model.
     */
    function stakeForRelease(uint256 releaseId) external payable nonReentrant {
        _stakeNative(releaseId);
    }

    function stakeWithAsset(uint256 tokenId, address token, uint256 amount) external nonReentrant {
        _stakeErc20(tokenId, token, amount);
    }

    function stakeForReleaseWithAsset(uint256 releaseId, address token, uint256 amount) external nonReentrant {
        _stakeErc20(releaseId, token, amount);
    }

    function _stakeNative(uint256 tokenId) internal {
        if (msg.value < stakeAmount) revert InsufficientStake();
        _validateStakeAsset(address(0));

        // Record the canonical stake, not msg.value: overpayment must not inflate
        // the slashable stake or the stake-backed price cap (getMaxListingPrice).
        // Effects before the surplus refund (CEI); reentry is blocked by the
        // nonReentrant entrypoint.
        uint256 required = stakeAmount;
        _recordStake(tokenId, address(0), required);

        uint256 surplus = msg.value - required;
        if (surplus != 0) {
            _pay(address(0), msg.sender, surplus);
        }
    }

    function _stakeErc20(uint256 tokenId, address token, uint256 amount) internal {
        if (msg.value != 0) revert UnexpectedETH();
        if (token == address(0)) revert UnsupportedStakeAsset();
        _validateStakeAsset(token);

        uint256 requiredAmount = stakeAmountsByToken[token];
        if (requiredAmount == 0) revert InvalidStakeAmount();
        if (amount < requiredAmount) revert InsufficientStake();

        // Record and pull exactly the required stake. `amount` is the caller's
        // max-willing amount and must cover the requirement, but staking more must
        // not inflate the slashable stake.
        _recordStake(tokenId, token, requiredAmount);

        // Reject fee-on-transfer / deflationary tokens: the stake is recorded as
        // `requiredAmount`, so the contract must actually receive exactly that.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), requiredAmount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != requiredAmount) revert FeeOnTransferNotSupported(requiredAmount, received);
    }

    function _recordStake(uint256 tokenId, address token, uint256 amount) internal {
        if (_blacklisted[msg.sender]) revert IsBlacklisted();
        if (!attestations[tokenId].valid) revert NotAttested();
        if (attestations[tokenId].attester != msg.sender) revert NotOwner();
        if (stakes[tokenId].active) revert AlreadyStaked();

        stakes[tokenId] = StakeInfo({amount: amount, depositedAt: block.timestamp, active: true});
        stakeTokens[tokenId] = token;

        emit StakeDeposited(tokenId, msg.sender, amount);
        emit StakeDepositedWithAsset(tokenId, msg.sender, token, amount);
    }

    /**
     * @notice Slash a creator's stake on confirmed content theft.
     *         60% to reporter, 30% to treasury, 10% burned.
     * @param tokenId The token ID to slash
     * @param reporter The address that reported the theft
     */
    function slash(uint256 tokenId, address reporter) external onlyOwner nonReentrant {
        if (!stakes[tokenId].active) revert NotStaked();
        if (reporter == address(0)) revert ZeroAddress();

        uint256 total = stakes[tokenId].amount;
        address token = stakeTokens[tokenId];
        address attester = attestations[tokenId].attester;

        // Invalidate
        stakes[tokenId].active = false;
        attestations[tokenId].valid = false;

        // Calculate split (Checks-Effects-Interactions)
        uint256 reporterAmount = (total * SLASH_REPORTER_BPS) / BPS;
        uint256 treasuryAmount = (total * SLASH_TREASURY_BPS) / BPS;
        uint256 burnedAmount = total - reporterAmount - treasuryAmount;

        // Retain the 10% remainder (it is retained, not destroyed) and track it so the
        // owner can sweep it to the treasury via sweepBurned. Effect before the
        // interactions below (CEI).
        totalBurned[token] += burnedAmount;

        // Auto-blacklist the attester (Effect). CP-2 (#1271): this state change must
        // complete BEFORE the payout interactions below, so a reentrant/observing
        // reporter or treasury contract already sees the attester blacklisted and can
        // never observe a window where the slashed attester is still un-blacklisted.
        if (!_blacklisted[attester]) {
            _blacklisted[attester] = true;
            emit Blacklisted(attester);
        }

        // Transfer (Interactions last — CEI pattern)
        _pay(token, reporter, reporterAmount);
        _pay(token, treasury, treasuryAmount);

        emit StakeSlashed(tokenId, reporter, reporterAmount, treasuryAmount, burnedAmount);
        emit StakeSlashedWithAsset(tokenId, reporter, token, reporterAmount, treasuryAmount, burnedAmount);
    }

    /**
     * @notice Refund stake to creator (admin action, e.g., after escrow period).
     * @param tokenId The token ID to refund stake for
     */
    function refundStake(uint256 tokenId) external onlyOwner nonReentrant {
        if (!stakes[tokenId].active) revert NotStaked();

        address attester = attestations[tokenId].attester;
        uint256 amount = stakes[tokenId].amount;
        address token = stakeTokens[tokenId];

        stakes[tokenId].active = false;

        _pay(token, attester, amount);

        emit StakeRefunded(tokenId, attester, amount);
        emit StakeRefundedWithAsset(tokenId, attester, token, amount);
    }

    /// @notice Sweep the accumulated slash remainder (the retained "burn") for an asset
    /// to the treasury. The remainder is retained — not destroyed — so this gives it a
    /// defined exit instead of leaving it permanently locked in the contract.
    /// @param token The asset to sweep (address(0) for native ETH).
    function sweepBurned(address token) external onlyOwner nonReentrant {
        uint256 amount = totalBurned[token];
        if (amount == 0) revert NothingToClaim();
        totalBurned[token] = 0;
        _pay(token, treasury, amount);
        emit BurnedSwept(token, treasury, amount);
    }

    // ============ Blacklist ============

    function blacklist(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function removeBlacklist(address account) external onlyOwner {
        if (!_blacklisted[account]) revert NotBlacklisted();
        _blacklisted[account] = false;
        emit BlacklistRemoved(account);
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    // ============ Admin ============

    function setRegistrar(address registrar, bool allowed) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        registrars[registrar] = allowed;
        emit RegistrarUpdated(registrar, allowed);
    }

    function setStakeAmount(uint256 newAmount) external onlyOwner {
        uint256 oldAmount = stakeAmount;
        emit StakeAmountUpdated(oldAmount, newAmount);
        stakeAmount = newAmount;
        _syncDefaultTierPolicies(oldAmount, newAmount);
    }

    function setPaymentAssetRegistry(address newRegistry) external onlyOwner {
        emit PaymentAssetRegistryUpdated(address(paymentAssetRegistry), newRegistry);
        paymentAssetRegistry = PaymentAssetRegistry(newRegistry);
    }

    function setStakeAmountForAsset(address token, uint256 newAmount) external onlyOwner {
        if (token == address(0)) revert UnsupportedStakeAsset();
        if (newAmount == 0) revert InvalidStakeAmount();
        uint256 oldAmount = stakeAmountsByToken[token];
        stakeAmountsByToken[token] = newAmount;
        emit StakeAssetAmountUpdated(token, oldAmount, newAmount);
    }

    function setTierPolicy(string calldata tierName, uint256 newStakeAmountWei, uint256 newEscrowDays)
        external
        onlyOwner
    {
        bytes32 tierKey = _resolveTierKey(tierName);
        TierPolicy storage currentPolicy = _tierPolicies[tierKey];
        emit TierPolicyUpdated(
            tierName, currentPolicy.stakeAmountWei, currentPolicy.escrowDays, newStakeAmountWei, newEscrowDays
        );
        _setTierPolicy(tierKey, newStakeAmountWei, newEscrowDays);
    }

    function setMaxPriceMultiplier(uint256 newMultiplier) external onlyOwner {
        if (newMultiplier == 0) revert InvalidMultiplier();
        uint256 oldMultiplier = maxPriceMultiplier;
        maxPriceMultiplier = newMultiplier;
        emit MaxPriceMultiplierUpdated(oldMultiplier, newMultiplier);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Start a two-step ownership handoff (CP-3, #1271). Records `newOwner` as
    /// the pending owner; the current owner keeps full authority (including
    /// `_authorizeUpgrade`) until `newOwner` calls {acceptOwnership}. This prevents an
    /// accidental one-step transfer to an unusable or mistyped address from bricking
    /// upgrade and admin control. Re-calling replaces any prior pending owner.
    /// @param newOwner The address that must call {acceptOwnership} to complete the handoff.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Complete a two-step ownership handoff (CP-3, #1271). Only the address
    /// staged by {transferOwnership} may promote itself to owner. Clears the pending
    /// slot and emits {OwnershipTransferred}.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        address previousOwner = owner;
        owner = pendingOwner;
        delete pendingOwner;
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function reinitializeV2() external reinitializer(2) {
        if (maxPriceMultiplier == 0) {
            maxPriceMultiplier = 10;
        }
    }

    function reinitializeV3() external reinitializer(3) {
        if (!_tierPolicies[_tierKey("new")].configured) {
            _initializeTierPoliciesFromStakeAmount(stakeAmount);
        }
    }

    function reinitializeV4() external reinitializer(4) {}

    /// @notice V5 migration (CP-1, #1271): initialize the EIP-712 domain on an
    /// already-deployed proxy so registrar-signed attestation vouchers verify after the
    /// upgrade. Fresh deploys already set the domain in `initialize`; this runs once per
    /// existing proxy. Versions 2–4 were consumed by earlier reinitializers.
    function reinitializeV5() external reinitializer(5) {
        __EIP712_init("ContentProtection", "1");
    }

    // ============ Views ============

    function registerTrack(uint256 releaseId, uint256 trackId) external onlyRegistrarOrOwner {
        if (!_hasAttestation(releaseId) || !_hasAttestation(trackId)) {
            revert NotAttested();
        }
        if (releaseId == trackId) revert InvalidParent();

        uint256 currentReleaseId = trackToParentRelease[trackId];
        if (currentReleaseId == releaseId) return;
        if (currentReleaseId != 0) revert RegistrationConflict();

        trackToParentRelease[trackId] = releaseId;
        _releaseToTracks[releaseId].push(trackId);

        emit TrackRegistered(releaseId, trackId);
    }

    function registerStem(uint256 trackId, uint256 stemTokenId) external onlyRegistrarOrOwner {
        if (!_hasAttestation(trackId)) revert NotAttested();
        if (trackId == stemTokenId) revert InvalidParent();

        uint256 currentTrackId = stemToCanonicalTrack[stemTokenId];
        if (currentTrackId == trackId) return;
        if (currentTrackId != 0) revert RegistrationConflict();

        stemToCanonicalTrack[stemTokenId] = trackId;
        _trackToStems[trackId].push(stemTokenId);

        emit StemRegistered(trackId, stemTokenId);
    }

    function registerStemProtectionRoot(uint256 releaseId, uint256 stemTokenId) external onlyRegistrarOrOwner {
        if (!_hasAttestation(releaseId)) revert NotAttested();
        if (releaseId == stemTokenId) revert InvalidParent();

        uint256 currentReleaseId = stemToProtectionRoot[stemTokenId];
        if (currentReleaseId == releaseId) return;
        if (currentReleaseId != 0) revert RegistrationConflict();

        stemToProtectionRoot[stemTokenId] = releaseId;

        emit StemProtectionRootRegistered(releaseId, stemTokenId);
    }

    function revokeTrack(uint256 trackId) external onlyOwner {
        attestations[trackId].valid = false;
        emit TrackRevoked(trackId);
    }

    /// @notice Revoke a release and all its registered tracks.
    ///         Reverts if > 50 tracks — use revokeReleaseBatch() instead.
    function revokeRelease(uint256 releaseId) external onlyOwner {
        uint256[] storage trackIds = _releaseToTracks[releaseId];
        if (trackIds.length > 50) revert InvalidParent(); // too many tracks — use batch

        attestations[releaseId].valid = false;

        for (uint256 i; i < trackIds.length; ++i) {
            uint256 trackId = trackIds[i];
            attestations[trackId].valid = false;
            emit TrackRevoked(trackId);
        }

        emit ReleaseRevoked(releaseId);
    }

    /// @notice Paginated release revocation for releases with many tracks.
    /// @param offset Start index in the release's track array
    /// @param limit  Max tracks to process in this call
    function revokeReleaseBatch(uint256 releaseId, uint256 offset, uint256 limit) external onlyOwner {
        attestations[releaseId].valid = false;

        uint256[] storage trackIds = _releaseToTracks[releaseId];
        uint256 end = offset + limit;
        if (end > trackIds.length) end = trackIds.length;

        for (uint256 i = offset; i < end; ++i) {
            uint256 trackId = trackIds[i];
            attestations[trackId].valid = false;
            emit TrackRevoked(trackId);
        }

        emit ReleaseRevoked(releaseId);
    }

    function getReleaseTracks(uint256 releaseId) external view returns (uint256[] memory) {
        return _releaseToTracks[releaseId];
    }

    function getTrackStems(uint256 trackId) external view returns (uint256[] memory) {
        return _trackToStems[trackId];
    }

    /// @notice Number of stems registered under a track (RE-1, #1271). Lets callers
    /// paginate over a track's stems without materializing the whole array.
    function getTrackStemCount(uint256 trackId) external view returns (uint256) {
        return _trackToStems[trackId].length;
    }

    /// @notice A bounded slice of a track's stem ids (RE-1, #1271). Enables paginated
    /// consumers (e.g. RevenueEscrow.freezeByTrackRange) to process very large tracks
    /// without an unbounded single-call copy that could exceed the block gas limit.
    /// @param trackId The track whose stems to slice.
    /// @param start Index of the first stem to return; `start >= length` yields an empty array.
    /// @param count Max number of stems to return; the slice is clamped to the array end.
    /// @return slice Stem ids in `[start, min(start + count, length))`.
    function getTrackStemsSlice(uint256 trackId, uint256 start, uint256 count)
        external
        view
        returns (uint256[] memory slice)
    {
        uint256[] storage stems = _trackToStems[trackId];
        uint256 length = stems.length;
        if (start >= length || count == 0) {
            return new uint256[](0);
        }
        // Overflow-safe clamp: `start + count` could overflow for a natural
        // "everything from start" input like count = type(uint256).max.
        uint256 remaining = length - start; // safe: start < length checked above
        uint256 take = count < remaining ? count : remaining;
        uint256 end = start + take;
        slice = new uint256[](take);
        for (uint256 i = start; i < end; ++i) {
            slice[i - start] = stems[i];
        }
    }

    function isAttested(uint256 tokenId) external view returns (bool) {
        return attestations[tokenId].valid;
    }

    function isReleaseVerified(uint256 releaseId) external view returns (bool) {
        return attestations[releaseId].valid;
    }

    function isTrackVerified(uint256 trackId) external view returns (bool) {
        return _isTrackVerified(trackId);
    }

    function isStemVerified(uint256 stemTokenId) external view returns (bool) {
        uint256 canonicalTrackId = stemToCanonicalTrack[stemTokenId];
        if (canonicalTrackId == 0) return false;

        return _isTrackVerified(canonicalTrackId);
    }

    function isStaked(uint256 tokenId) external view returns (bool) {
        return stakes[tokenId].active;
    }

    function resolveCanonicalTrack(uint256 stemTokenId) external view returns (uint256) {
        return stemToCanonicalTrack[stemTokenId];
    }

    function resolveProtectionTarget(uint256 tokenId) external view returns (uint256) {
        uint256 canonicalTrackId = stemToCanonicalTrack[tokenId];
        return canonicalTrackId == 0 ? tokenId : canonicalTrackId;
    }

    function resolveStakeRoot(uint256 tokenId) public view returns (uint256) {
        uint256 directReleaseId = stemToProtectionRoot[tokenId];
        if (directReleaseId != 0) return directReleaseId;

        uint256 canonicalTrackId = stemToCanonicalTrack[tokenId];
        if (canonicalTrackId != 0) {
            uint256 parentReleaseId = trackToParentRelease[canonicalTrackId];
            return parentReleaseId != 0 ? parentReleaseId : canonicalTrackId;
        }

        uint256 releaseId = trackToParentRelease[tokenId];
        return releaseId != 0 ? releaseId : tokenId;
    }

    function getMaxListingPrice(uint256 tokenId) external view returns (uint256) {
        uint256 stakeRoot = resolveStakeRoot(tokenId);
        if (!stakes[stakeRoot].active) return type(uint256).max;

        return stakes[stakeRoot].amount * maxPriceMultiplier;
    }

    function getStakeAsset(uint256 tokenId) external view returns (address token, uint256 amount, bool active) {
        StakeInfo storage currentStake = stakes[tokenId];
        return (stakeTokens[tokenId], currentStake.amount, currentStake.active);
    }

    function getTierPolicy(string calldata tierName)
        external
        view
        returns (uint256 requiredStakeWei, uint256 escrowDays)
    {
        TierPolicy storage policy = _tierPolicies[_resolveTierKey(tierName)];
        return (policy.stakeAmountWei, policy.escrowDays);
    }

    function _hasAttestation(uint256 tokenId) internal view returns (bool) {
        return attestations[tokenId].attester != address(0);
    }

    function _validateStakeAsset(address token) internal view {
        if (address(paymentAssetRegistry) == address(0)) {
            if (token != address(0)) revert UnsupportedStakeAsset();
            return;
        }
        if (!paymentAssetRegistry.isTokenEnabled(token)) {
            revert UnsupportedStakeAsset();
        }
    }

    /// @dev Push-then-escrow: attempt the payout, but if the recipient reverts (a
    /// contract that rejects ETH, or a token that blocklists the address) escrow the
    /// funds for the recipient to reclaim instead of bricking the slash.
    function _pay(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) _escrowFailedPayment(token, to, amount);
        } else {
            try this.safeTransferSelf(token, to, amount) {
            // delivered
            }
            catch {
                _escrowFailedPayment(token, to, amount);
            }
        }
    }

    function _escrowFailedPayment(address token, address to, uint256 amount) private {
        failedPayments[token][to] += amount;
        emit PaymentEscrowed(token, to, amount);
    }

    /// @dev External self-call wrapper so a reverting SafeERC20 transfer can be caught
    /// with try/catch. Restricted to self.
    function safeTransferSelf(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Reclaim funds escrowed for `msg.sender` after a failed slash payout.
    /// @param token The asset to claim (address(0) for native ETH).
    function claimFailedPayment(address token) external nonReentrant {
        uint256 amount = failedPayments[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        failedPayments[token][msg.sender] = 0;
        if (token == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit FailedPaymentClaimed(token, msg.sender, amount);
    }

    function _isTrackVerified(uint256 trackId) internal view returns (bool) {
        uint256 releaseId = trackToParentRelease[trackId];
        return releaseId != 0 && attestations[trackId].valid && attestations[releaseId].valid;
    }

    function _initializeTierPoliciesFromStakeAmount(uint256 baseStakeAmount) internal {
        _setTierPolicy(_tierKey("verified"), 0, 3);
        _setTierPolicy(_tierKey("trusted"), baseStakeAmount / 10, 7);
        _setTierPolicy(_tierKey("established"), baseStakeAmount / 2, 14);
        _setTierPolicy(_tierKey("new"), baseStakeAmount, 30);
    }

    function _syncDefaultTierPolicies(uint256 oldBaseStakeAmount, uint256 newBaseStakeAmount) internal {
        _syncTierPolicyIfStillDefault(_tierKey("verified"), 0, 3, 0, 3);
        _syncTierPolicyIfStillDefault(_tierKey("trusted"), oldBaseStakeAmount / 10, 7, newBaseStakeAmount / 10, 7);
        _syncTierPolicyIfStillDefault(_tierKey("established"), oldBaseStakeAmount / 2, 14, newBaseStakeAmount / 2, 14);
        _syncTierPolicyIfStillDefault(_tierKey("new"), oldBaseStakeAmount, 30, newBaseStakeAmount, 30);
    }

    function _syncTierPolicyIfStillDefault(
        bytes32 tierKey,
        uint256 expectedOldStakeAmountWei,
        uint256 expectedOldEscrowDays,
        uint256 newStakeAmountWei,
        uint256 newEscrowDays
    ) internal {
        TierPolicy storage currentPolicy = _tierPolicies[tierKey];
        if (
            !currentPolicy.configured
                || (currentPolicy.stakeAmountWei == expectedOldStakeAmountWei
                    && currentPolicy.escrowDays == expectedOldEscrowDays)
        ) {
            _setTierPolicy(tierKey, newStakeAmountWei, newEscrowDays);
        }
    }

    function _setTierPolicy(bytes32 tierKey, uint256 newStakeAmountWei, uint256 newEscrowDays) internal {
        _tierPolicies[tierKey] =
            TierPolicy({stakeAmountWei: newStakeAmountWei, escrowDays: newEscrowDays, configured: true});
    }

    function _resolveTierKey(string calldata tierName) internal pure returns (bytes32) {
        bytes32 tierKey = keccak256(bytes(tierName));
        if (
            tierKey != _tierKey("verified") && tierKey != _tierKey("trusted") && tierKey != _tierKey("established")
                && tierKey != _tierKey("new")
        ) {
            revert InvalidTier();
        }
        return tierKey;
    }

    function _tierKey(string memory tierName) internal pure returns (bytes32) {
        return keccak256(bytes(tierName));
    }
}
