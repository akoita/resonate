// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IERC8004IdentityRegistry
 * @notice Minimal official ERC-8004 Identity Registry surface used by Resonate agents.
 */
interface IERC8004IdentityRegistry {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event MetadataDeleted(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey);
    event AgentWalletSet(uint256 indexed agentId, address indexed walletAddress);

    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external
        returns (uint256 agentId);

    function register(string calldata agentURI) external returns (uint256 agentId);

    function register() external returns (uint256 agentId);

    function setAgentURI(uint256 agentId, string calldata newURI) external;

    function tokenURI(uint256 tokenId) external view returns (string memory);

    function ownerOf(uint256 tokenId) external view returns (address);

    function getAgentWallet(uint256 agentId) external view returns (address);

    function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (bytes memory);

    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external;

    function deleteMetadata(uint256 agentId, string calldata metadataKey) external;
}
