// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    UUPSUpgradeable
} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {
    Initializable
} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
 * @custom:version 1.0.0
 */
contract ContentProtection is Initializable, UUPSUpgradeable, ReentrancyGuard {
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

    // ============ State ============

    address public owner;
    address public treasury;

    uint256 public stakeAmount; // Default: 0.01 ETH (adjustable by owner)
    uint256 public nextTokenId; // Counter for attestation-assigned token IDs

    mapping(uint256 => Attestation) public attestations;
    mapping(uint256 => StakeInfo) public stakes;
    mapping(address => bool) internal _blacklisted;
    mapping(address => bool) public registrars;
    mapping(uint256 => uint256[]) private _releaseToTracks;
    mapping(uint256 => uint256[]) private _trackToStems;
    mapping(uint256 => uint256) public stemToCanonicalTrack;
    mapping(uint256 => uint256) public trackToParentRelease;

    // Slash distribution (basis points, must sum to 10000)
    uint256 public constant SLASH_REPORTER_BPS = 6000; // 60%
    uint256 public constant SLASH_TREASURY_BPS = 3000; // 30%
    // Remaining 10% is burned (sent to address(0) equivalent — kept in contract then swept)
    uint256 public constant BPS = 10000;

    // ============ Events ============

    event ContentAttested(
        uint256 indexed tokenId,
        address indexed attester,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string metadataURI
    );

    event StakeDeposited(
        uint256 indexed tokenId,
        address indexed staker,
        uint256 amount
    );

    event StakeSlashed(
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 reporterAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );

    event StakeRefunded(
        uint256 indexed tokenId,
        address indexed staker,
        uint256 amount
    );

    event Blacklisted(address indexed account);
    event BlacklistRemoved(address indexed account);
    event StakeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event RegistrarUpdated(address indexed registrar, bool allowed);
    event TrackRegistered(uint256 indexed releaseId, uint256 indexed trackId);
    event StemRegistered(uint256 indexed trackId, uint256 indexed stemTokenId);
    event TrackRevoked(uint256 indexed trackId);
    event ReleaseRevoked(uint256 indexed releaseId);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

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

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRegistrarOrOwner() {
        if (msg.sender != owner && !registrars[msg.sender])
            revert NotRegistrar();
        _;
    }

    // ============ Initializer (UUPS) ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _treasury,
        uint256 _stakeAmount
    ) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        owner = _owner;
        treasury = _treasury;
        stakeAmount = _stakeAmount;
    }

    // ============ Attestation ============

    /**
     * @notice Attest ownership of protected content for staking / provenance.
     * @param tokenId Identifier for the protected asset or release record
     * @param contentHash SHA-256 hash of the audio content
     * @param fingerprintHash Chromaprint fingerprint hash
     * @param metadataURI IPFS URI or URL pointing to attestation metadata
     */
    function attest(
        uint256 tokenId,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string calldata metadataURI
    ) external {
        _attest(tokenId, contentHash, fingerprintHash, metadataURI);
    }

    /**
     * @notice Canonical release-first attestation entrypoint.
     * @dev Wraps the generic attestation flow while making the protected root explicit.
     */
    function attestRelease(
        uint256 releaseId,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string calldata metadataURI
    ) external {
        _attest(releaseId, contentHash, fingerprintHash, metadataURI);
    }

    function _attest(
        uint256 tokenId,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string calldata metadataURI
    ) internal {
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

        emit ContentAttested(
            tokenId,
            msg.sender,
            contentHash,
            fingerprintHash,
            metadataURI
        );
    }

    // ============ Staking ============

    /**
     * @notice Stake ETH when publishing protected content.
     * @param tokenId The attested content or release identifier to stake for
     */
    function stake(uint256 tokenId) external payable nonReentrant {
        _stake(tokenId);
    }

    /**
     * @notice Canonical release-first staking entrypoint.
     * @dev Keeps the external API aligned with the hierarchical release-root model.
     */
    function stakeForRelease(uint256 releaseId) external payable nonReentrant {
        _stake(releaseId);
    }

    function _stake(uint256 tokenId) internal {
        if (_blacklisted[msg.sender]) revert IsBlacklisted();
        if (!attestations[tokenId].valid) revert NotAttested();
        if (attestations[tokenId].attester != msg.sender) revert NotOwner();
        if (stakes[tokenId].active) revert AlreadyStaked();
        if (msg.value < stakeAmount) revert InsufficientStake();

        stakes[tokenId] = StakeInfo({
            amount: msg.value,
            depositedAt: block.timestamp,
            active: true
        });

        emit StakeDeposited(tokenId, msg.sender, msg.value);
    }

    /**
     * @notice Slash a creator's stake on confirmed content theft.
     *         60% to reporter, 30% to treasury, 10% burned.
     * @param tokenId The token ID to slash
     * @param reporter The address that reported the theft
     */
    function slash(
        uint256 tokenId,
        address reporter
    ) external onlyOwner nonReentrant {
        if (!stakes[tokenId].active) revert NotStaked();
        if (reporter == address(0)) revert ZeroAddress();

        uint256 total = stakes[tokenId].amount;
        address attester = attestations[tokenId].attester;

        // Invalidate
        stakes[tokenId].active = false;
        attestations[tokenId].valid = false;

        // Calculate split (Checks-Effects-Interactions)
        uint256 reporterAmount = (total * SLASH_REPORTER_BPS) / BPS;
        uint256 treasuryAmount = (total * SLASH_TREASURY_BPS) / BPS;
        uint256 burnedAmount = total - reporterAmount - treasuryAmount;

        // Transfer (Interactions last — CEI pattern)
        (bool ok1, ) = payable(reporter).call{value: reporterAmount}("");
        if (!ok1) revert TransferFailed();

        (bool ok2, ) = payable(treasury).call{value: treasuryAmount}("");
        if (!ok2) revert TransferFailed();

        // Burned amount stays in contract (can be swept to treasury later)

        // Auto-blacklist the attester
        if (!_blacklisted[attester]) {
            _blacklisted[attester] = true;
            emit Blacklisted(attester);
        }

        emit StakeSlashed(
            tokenId,
            reporter,
            reporterAmount,
            treasuryAmount,
            burnedAmount
        );
    }

    /**
     * @notice Refund stake to creator (admin action, e.g., after escrow period).
     * @param tokenId The token ID to refund stake for
     */
    function refundStake(uint256 tokenId) external onlyOwner nonReentrant {
        if (!stakes[tokenId].active) revert NotStaked();

        address attester = attestations[tokenId].attester;
        uint256 amount = stakes[tokenId].amount;

        stakes[tokenId].active = false;

        (bool ok, ) = payable(attester).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit StakeRefunded(tokenId, attester, amount);
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
        emit StakeAmountUpdated(stakeAmount, newAmount);
        stakeAmount = newAmount;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Views ============

    function registerTrack(
        uint256 releaseId,
        uint256 trackId
    ) external onlyRegistrarOrOwner {
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

    function registerStem(
        uint256 trackId,
        uint256 stemTokenId
    ) external onlyRegistrarOrOwner {
        if (!_hasAttestation(trackId)) revert NotAttested();
        if (trackId == stemTokenId) revert InvalidParent();

        uint256 currentTrackId = stemToCanonicalTrack[stemTokenId];
        if (currentTrackId == trackId) return;
        if (currentTrackId != 0) revert RegistrationConflict();

        stemToCanonicalTrack[stemTokenId] = trackId;
        _trackToStems[trackId].push(stemTokenId);

        emit StemRegistered(trackId, stemTokenId);
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
    function revokeReleaseBatch(
        uint256 releaseId,
        uint256 offset,
        uint256 limit
    ) external onlyOwner {
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

    function getReleaseTracks(
        uint256 releaseId
    ) external view returns (uint256[] memory) {
        return _releaseToTracks[releaseId];
    }

    function getTrackStems(
        uint256 trackId
    ) external view returns (uint256[] memory) {
        return _trackToStems[trackId];
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

    function resolveCanonicalTrack(
        uint256 stemTokenId
    ) external view returns (uint256) {
        return stemToCanonicalTrack[stemTokenId];
    }

    function resolveProtectionTarget(
        uint256 tokenId
    ) external view returns (uint256) {
        uint256 canonicalTrackId = stemToCanonicalTrack[tokenId];
        return canonicalTrackId == 0 ? tokenId : canonicalTrackId;
    }

    function _hasAttestation(uint256 tokenId) internal view returns (bool) {
        return attestations[tokenId].attester != address(0);
    }

    function _isTrackVerified(uint256 trackId) internal view returns (bool) {
        uint256 releaseId = trackToParentRelease[trackId];
        return
            releaseId != 0 &&
            attestations[trackId].valid &&
            attestations[releaseId].valid;
    }
}
