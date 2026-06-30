// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IStemNFT
/// @notice Canonical shared surface (events, errors) for StemNFT. Production code,
/// tests, and indexers import this so the event/error contract cannot silently
/// drift. The MintAuthorization/StemData/RemixInfo structs stay local to StemNFT:
/// they are internal storage and EIP-712 signing types, not consumed by tests or
/// indexers as named types.
interface IStemNFT {
    // ============ Events ============

    event StemMinted(uint256 indexed tokenId, address indexed creator, uint256[] parentIds, string tokenURI);

    event TransferValidatorSet(address indexed validator);
    event ContentProtectionSet(address indexed protection);
    event RoyaltyUpdated(uint256 indexed tokenId, address receiver, uint96 bps);

    // ============ Errors ============

    error StemNotFound(uint256 tokenId);
    error NotStemCreator(uint256 tokenId);
    error InvalidRoyalty(uint96 bps);
    error TransferNotAllowed();
    error ParentNotRemixable(uint256 parentId);
    error NotAttested(uint256 tokenId);
    error MintAuthorizationExpired(uint256 deadline);
    error MintAuthorizationAlreadyUsed(address minter, bytes32 nonce);
    error InvalidMintAuthorization();
}
