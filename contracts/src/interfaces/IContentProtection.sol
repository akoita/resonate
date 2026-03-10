// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IContentProtection
 * @notice Interface for the ContentProtection contract — used by StemNFT and TransferValidator.
 */
interface IContentProtection {
    struct Attestation {
        bytes32 contentHash;
        bytes32 fingerprintHash;
        string metadataURI;
        address attester;
        uint256 timestamp;
        bool valid;
    }

    function attestations(
        uint256 tokenId
    )
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

    function stakes(
        uint256 tokenId
    ) external view returns (uint256 amount, uint256 depositedAt, bool active);

    function isAttested(uint256 tokenId) external view returns (bool);

    function isStaked(uint256 tokenId) external view returns (bool);

    function stakeAmount() external view returns (uint256);
}
