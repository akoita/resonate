// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IContentProtectionEvents} from "./IContentProtectionEvents.sol";

/**
 * @title IContentProtection
 * @notice Consumer interface for the ContentProtection contract — used by StemNFT,
 * TransferValidator, RevenueEscrow, and CurationRewards. Extends
 * IContentProtectionEvents so callers can also reference its events and errors.
 */
interface IContentProtection is IContentProtectionEvents {
    struct Attestation {
        bytes32 contentHash;
        bytes32 fingerprintHash;
        string metadataURI;
        address attester;
        uint256 timestamp;
        bool valid;
    }

    function attestations(uint256 tokenId)
        external
        view
        returns (
            bytes32 contentHash,
            bytes32 fingerprintHash,
            string memory metadataURI,
            address attester,
            uint256 timestamp,
            bool valid
        );

    function isBlacklisted(address account) external view returns (bool);

    function stakes(uint256 tokenId) external view returns (uint256 amount, uint256 depositedAt, bool active);

    function stakeTokens(uint256 tokenId) external view returns (address token);

    function getStakeAsset(uint256 tokenId) external view returns (address token, uint256 amount, bool active);

    function attestRelease(
        uint256 releaseId,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string calldata metadataURI,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function getReleaseTracks(uint256 releaseId) external view returns (uint256[] memory);

    function getTrackStems(uint256 trackId) external view returns (uint256[] memory);

    function getTrackStemCount(uint256 trackId) external view returns (uint256);

    function getTrackStemsSlice(uint256 trackId, uint256 start, uint256 count)
        external
        view
        returns (uint256[] memory);

    function owner() external view returns (address);

    function pendingOwner() external view returns (address);

    function acceptOwnership() external;

    function isAttested(uint256 tokenId) external view returns (bool);

    function isReleaseVerified(uint256 releaseId) external view returns (bool);

    function isTrackVerified(uint256 trackId) external view returns (bool);

    function isStemVerified(uint256 stemTokenId) external view returns (bool);

    function isStaked(uint256 tokenId) external view returns (bool);

    function resolveCanonicalTrack(uint256 stemTokenId) external view returns (uint256);

    function resolveProtectionTarget(uint256 tokenId) external view returns (uint256);

    function resolveStakeRoot(uint256 tokenId) external view returns (uint256);

    function stakeAmount() external view returns (uint256);

    function maxPriceMultiplier() external view returns (uint256);

    function getMaxListingPrice(uint256 tokenId) external view returns (uint256);

    function stakeForRelease(uint256 releaseId) external payable;

    function stakeForReleaseWithAsset(uint256 releaseId, address token, uint256 amount) external;

    function registerStemProtectionRoot(uint256 releaseId, uint256 stemTokenId) external;

    function stemToCanonicalTrack(uint256 stemTokenId) external view returns (uint256);

    function trackToParentRelease(uint256 trackId) external view returns (uint256);
}
